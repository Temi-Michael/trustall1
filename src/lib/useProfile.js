import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

export function useSession() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

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

  return { session, loading }
}

export function useProfile() {
  const { session, loading: sessionLoading } = useSession()
  const [profile, setProfile] = useState(null)
  const [profileUserId, setProfileUserId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (sessionLoading) return
    if (!session) {
      setProfile(null)
      setProfileUserId(null)
      setLoading(false)
      return
    }

    let isMounted = true
    setProfile(null)
    setLoading(true)

    // Phone numbers live in profile_contacts, which only the owner and admins can read.
    Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle(),
      supabase
        .from('profile_contacts')
        .select('phone')
        .eq('id', session.user.id)
        .maybeSingle(),
    ])
      .then(([{ data, error }, { data: contact, error: contactError }]) => {
        if (!isMounted) return

        if (error && error.code !== 'PGRST116') {
          console.warn('Profile lookup failed:', error)
        }
        if (contactError && contactError.code !== 'PGRST116') {
          console.warn('Contact details lookup failed:', contactError)
        }

        setProfile(data ? { ...data, phone: contact?.phone ?? null } : null)
        setProfileUserId(session.user.id)
      })
      .catch((error) => {
        if (!isMounted) return
        console.error('Profile load failed:', error)
        setProfile(null)
        setProfileUserId(session.user.id)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [session?.user?.id, sessionLoading])

  const profileMatchesSession = Boolean(session?.user?.id) && profileUserId === session.user.id

  return {
    session,
    profile: profileMatchesSession ? profile : null,
    setProfile,
    loading: sessionLoading || loading || Boolean(session?.user?.id && !profileMatchesSession),
  }
}
