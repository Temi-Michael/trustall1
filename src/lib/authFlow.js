const AUTH_FLOW_STORAGE_KEY = 'trustall.auth-flow'
const AUTH_REDIRECT_STORAGE_KEY = 'trustall.auth-redirect'
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

export function saveAuthIntent(storage, flow, redirectTo = '/') {
  storage?.setItem(AUTH_FLOW_STORAGE_KEY, flow === 'signup' ? 'signup' : 'signin')
  storage?.setItem(AUTH_REDIRECT_STORAGE_KEY, safeRedirectPath(redirectTo))
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

  return { flow, redirectTo }
}

export function clearAuthIntent(storage) {
  storage?.removeItem(AUTH_FLOW_STORAGE_KEY)
  storage?.removeItem(AUTH_REDIRECT_STORAGE_KEY)
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
