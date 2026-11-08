const AUTH_FLOW_STORAGE_KEY = 'trustall.auth-flow'
const AUTH_REDIRECT_STORAGE_KEY = 'trustall.auth-redirect'
const AUTH_REFERRAL_STORAGE_KEY = 'trustall.auth-ref'
const SAME_SITE_BASE = 'https://trustall.invalid'

// Where to go after signing in. Only a path on this site is allowed: anything
// that would leave it ("https://…", "//evil.com", "/\evil.com", "javascript:")
// becomes "/". The URL parser normalises backslashes the way browsers do.
export function safeRedirectPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f]/.test(value)) return '/'
  try {
    const url = new URL(value, SAME_SITE_BASE)
    if (url.origin !== SAME_SITE_BASE) return '/'
    return `${url.pathname}${url.search}${url.hash}` || '/'
  } catch {
    return '/'
  }
}

export function buildAuthCallbackUrl(siteUrl, redirectTo = '/', flow = 'signin') {
  const callbackUrl = new URL('/auth', siteUrl)
  callbackUrl.searchParams.set('redirectTo', safeRedirectPath(redirectTo))
  if (flow === 'signup') callbackUrl.searchParams.set('authFlow', 'signup')
  return callbackUrl.toString()
}

// Options for supabase.auth.signInWithOAuth({ provider: 'google' }).
// prompt=select_account makes Google show its account picker every time.
// Without it, Google silently reuses the account the browser is already signed
// in to, so after logging out of Trustall the next "Continue with Google" skips
// straight back in. Google's consent screen still only appears the first time.
export function buildGoogleOAuthOptions(siteUrl, redirectTo = '/', flow = 'signin') {
  return {
    redirectTo: buildAuthCallbackUrl(siteUrl, redirectTo, flow),
    queryParams: { prompt: 'select_account' },
  }
}

// Referral codes are 8 hex characters today (0003). Accept a slightly wider
// shape so custom codes keep working, but nothing that isn't a plain token.
export function safeReferralCode(value) {
  if (typeof value !== 'string') return null
  const code = value.trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null
}

// Saved before the Google redirect, which can't carry them, and read back on
// return. The referral code is optional and only kept when it looks valid.
export function saveAuthIntent(storage, flow, redirectTo = '/', refCode = null) {
  storage?.setItem(AUTH_FLOW_STORAGE_KEY, flow === 'signup' ? 'signup' : 'signin')
  storage?.setItem(AUTH_REDIRECT_STORAGE_KEY, safeRedirectPath(redirectTo))
  const safeCode = safeReferralCode(refCode)
  if (safeCode) storage?.setItem(AUTH_REFERRAL_STORAGE_KEY, safeCode)
  else storage?.removeItem(AUTH_REFERRAL_STORAGE_KEY)
}

export function getAuthIntent(searchParams, storage) {
  const callbackFlow = searchParams.get('authFlow')
  const storedFlow = storage?.getItem(AUTH_FLOW_STORAGE_KEY)
  const flow = callbackFlow === 'signup' || callbackFlow === 'signin'
    ? callbackFlow
    : storedFlow === 'signup' || storedFlow === 'signin'
      ? storedFlow
      : 'signin'
  const redirectTo = safeRedirectPath(searchParams.get('redirectTo') || storage?.getItem(AUTH_REDIRECT_STORAGE_KEY) || '/')
  const refCode = safeReferralCode(searchParams.get('ref')) || safeReferralCode(storage?.getItem(AUTH_REFERRAL_STORAGE_KEY))

  return { flow, redirectTo, refCode }
}

export function clearAuthIntent(storage) {
  storage?.removeItem(AUTH_FLOW_STORAGE_KEY)
  storage?.removeItem(AUTH_REDIRECT_STORAGE_KEY)
  storage?.removeItem(AUTH_REFERRAL_STORAGE_KEY)
}

export function getEmailSignupOutcome(data, error) {
  if (error) return 'error'
  if (!data?.user) return 'unexpected'
  if (data.session) return 'authenticated'
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'existing-account'
  return 'confirmation-required'
}

export function shouldCompleteGoogleSignup(authFlow, session) {
  return authFlow === 'signup' && Boolean(session?.user?.id)
}

// Whether to show "Complete your registration" to a signed-in user.
// With migration 0038 the profile decides: setup_completed_at is null only for
// a new Google account that hasn't finished setup, whichever Google button was
// used, and an existing user who clicks "Sign up with Google" isn't asked to
// re-enter (and overwrite) their name. Without 0038 the column is absent, and
// the old rule applies: only after "Sign up with Google".
export function needsProfileSetup(authFlow, session, profile) {
  if (!session?.user?.id) return false
  if (profile && 'setup_completed_at' in profile) return profile.setup_completed_at === null
  return shouldCompleteGoogleSignup(authFlow, session)
}

// Types Supabase puts in email links (verifyOtp's EmailOtpType).
const EMAIL_LINK_TYPES = new Set(['email', 'signup', 'recovery', 'invite', 'magiclink', 'email_change'])

// Reads the sign-in secrets from a link in a Supabase email, if the address
// has any, and returns the address without them (so they can be removed from
// the address bar and history). Two shapes:
// - ?token_hash=…&type=… : the current email templates. Verified with
//   verifyOtp, which works in any browser, unlike a PKCE ?code=.
// - #access_token=…&refresh_token=… : emails sent before the switch to PKCE,
//   which the PKCE client refuses. Accepted only for the email link types.
// Returns null when the address is not an email link.
export function readEmailLinkParams(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }

  const tokenHash = url.searchParams.get('token_hash')
  const queryType = url.searchParams.get('type')
  if (tokenHash && EMAIL_LINK_TYPES.has(queryType)) {
    url.searchParams.delete('token_hash')
    url.searchParams.delete('type')
    return { kind: 'token_hash', tokenHash, type: queryType, cleanUrl: url.toString() }
  }

  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  const hashType = hash.get('type')
  if (accessToken && refreshToken && EMAIL_LINK_TYPES.has(hashType)) {
    url.hash = ''
    return { kind: 'session_tokens', accessToken, refreshToken, type: hashType, cleanUrl: url.toString() }
  }

  return null
}
