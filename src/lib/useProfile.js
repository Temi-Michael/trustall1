import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { fetchOwnProfile } from './profileFields.js'
import { readEmailLinkParams } from './authFlow.js'
import { completeEmailLinkSignIn } from './emailLinkSession.js'

// The session and the signed-in user's profile are loaded once, by
// useAuthStateSource() inside RoleProvider (RoleContext.jsx, mounted in
// App.jsx), and shared through these two contexts. Two contexts, so components
// that only need the session don't re-render when the profile changes.
export const SessionContext = createContext(null)
export const ProfileContext = createContext(null)

// Pages that mount ask for a fresh profile (wallet, seller status and so on
// change elsewhere), but repeat requests within this window reuse the last load.
const PROFILE_REFRESH_INTERVAL_MS = 5000

const MISSING_PROVIDER_MESSAGE = 'must be used inside RoleProvider (src/lib/RoleContext.jsx)'

async function loadOwnProfile(userId) {
  const [ownProfile, { data: contact, error: contactError }] = await Promise.all([
    fetchOwnProfile(supabase, userId),
    supabase
      .from('profile_contacts')
      .select('phone')
      .eq('id', userId)
      .maybeSingle(),
  ])

  if (contactError && contactError.code !== 'PGRST116') {
    console.warn('Contact details lookup failed:', contactError)
  }

  // Before migration 0028 the phone number is still on the profile row.
  const phone = contact?.phone ?? ownProfile?.phone ?? null
  return ownProfile ? { ...ownProfile, phone } : null
}

// One auth subscription for the whole app.
function useSessionSource() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  // Opened from an email link: stay "loading" until it has signed the user in,
  // so pages that need a session don't redirect to the log-in page meanwhile.
  const [emailLinkPending, setEmailLinkPending] = useState(
    () => typeof window !== 'undefined' && Boolean(readEmailLinkParams(window.location.href)),
  )

  useEffect(() => {
    if (!emailLinkPending) return
    completeEmailLinkSignIn().finally(() => setEmailLinkPending(false))
  }, [emailLinkPending])

  useEffect(() => {
    let isMounted = true
    let receivedAuthEvent = false
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      receivedAuthEvent = true
      setSession(s)
      setLoading(false)
    })

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!isMounted || receivedAuthEvent) return
        if (error) {
          console.warn('Session lookup failed:', error)
          setSession(null)
        } else {
          setSession(data.session)
        }
      })
      .catch((error) => {
        if (!isMounted || receivedAuthEvent) return
        console.warn('Session lookup failed:', error)
        setSession(null)
      })
      .finally(() => {
        if (isMounted && !receivedAuthEvent) setLoading(false)
      })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return { session, loading: loading || emailLinkPending }
}

/**
 * The single source of auth state. Call it once, in RoleProvider; everything
 * else reads it through useSession() / useProfile() / useRole().
 *
 * @returns {{ sessionValue: object, profileValue: object }} context values
 */
export function useAuthStateSource() {
  const { session, loading: sessionLoading } = useSessionSource()
  const [profile, setProfile] = useState(null)
  const [profileUserId, setProfileUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  const userId = session?.user?.id || null

  // The user whose profile we want right now; late results for anyone else are
  // dropped. Set during render so child effects (which run before this
  // component's effects) never see the previous user.
  const currentUserIdRef = useRef(userId)
  currentUserIdRef.current = userId

  // The latest profile request: shared while in flight, timestamped when done.
  const requestRef = useRef({ userId: null, promise: null, loadedAt: 0 })

  const requestProfile = useCallback((targetUserId) => {
    const previous = requestRef.current
    if (previous.userId === targetUserId && previous.promise) return previous.promise

    const promise = loadOwnProfile(targetUserId).finally(() => {
      if (requestRef.current.promise === promise) {
        requestRef.current = { userId: targetUserId, promise: null, loadedAt: Date.now() }
      }
    })
    requestRef.current = { userId: targetUserId, promise, loadedAt: previous.loadedAt }
    return promise
  }, [])

  // First load for each signed-in user. Shows loading until it finishes.
  useEffect(() => {
    if (sessionLoading) return
    if (!userId) {
      setProfile(null)
      setProfileUserId(null)
      setProfileError(null)
      setLoading(false)
      return
    }

    let isMounted = true
    setProfile(null)
    setProfileError(null)
    setLoading(true)

    requestProfile(userId)
      .then((loadedProfile) => {
        if (!isMounted) return
        setProfile(loadedProfile)
        setProfileUserId(userId)
      })
      .catch((error) => {
        if (!isMounted) return
        console.error('Profile load failed:', error)
        setProfile(null)
        setProfileUserId(userId)
        setProfileError(error)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [userId, sessionLoading, requestProfile])

  // Background reload: keeps showing the current profile, never sets loading,
  // and on failure keeps the last good copy.
  const refreshProfile = useCallback(async () => {
    const targetUserId = currentUserIdRef.current
    if (!targetUserId) return

    const { userId: lastUserId, promise, loadedAt } = requestRef.current
    if (promise) return // A load is already running and will update the state.
    if (lastUserId === targetUserId && Date.now() - loadedAt < PROFILE_REFRESH_INTERVAL_MS) return

    try {
      const loadedProfile = await requestProfile(targetUserId)
      if (currentUserIdRef.current !== targetUserId) return
      setProfile(loadedProfile)
      setProfileUserId(targetUserId)
      setProfileError(null)
    } catch (error) {
      console.warn('Profile refresh failed; keeping the last loaded profile:', error)
    }
  }, [requestProfile])

  const profileMatchesSession = Boolean(userId) && profileUserId === userId
  const visibleProfile = profileMatchesSession ? profile : null
  const profileLoading = sessionLoading || loading || Boolean(userId && !profileMatchesSession)

  const sessionValue = useMemo(
    () => ({ session, loading: sessionLoading }),
    [session, sessionLoading],
  )

  const profileValue = useMemo(() => ({
    session,
    profile: visibleProfile,
    setProfile,
    refreshProfile,
    error: profileError,
    loading: profileLoading,
  }), [session, visibleProfile, refreshProfile, profileError, profileLoading])

  return { sessionValue, profileValue }
}

/**
 * The current session only. Does not wait for, or re-render on, the profile.
 * @returns {{ session: object | null, loading: boolean }}
 */
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error(`useSession ${MISSING_PROVIDER_MESSAGE}`)
  return value
}

/**
 * The session plus the signed-in user's own profile (private fields included).
 * Mounting a component that calls this refreshes the profile in the
 * background, as when every page loaded its own copy, but now repeated or
 * simultaneous calls share one request.
 *
 * @returns {{ session, profile, setProfile, refreshProfile, error, loading }}
 */
export function useProfile() {
  const value = useContext(ProfileContext)
  if (!value) throw new Error(`useProfile ${MISSING_PROVIDER_MESSAGE}`)

  const { refreshProfile } = value
  useEffect(() => { refreshProfile() }, [refreshProfile])

  return value
}
