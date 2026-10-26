const AUTH_FLOW_STORAGE_KEY = 'trustall.auth-flow'
const AUTH_REDIRECT_STORAGE_KEY = 'trustall.auth-redirect'

export function buildAuthCallbackUrl(siteUrl, redirectTo = '/', flow = 'signin') {
  const callbackUrl = new URL('/auth', siteUrl)
  callbackUrl.searchParams.set('redirectTo', redirectTo)
  if (flow === 'signup') callbackUrl.searchParams.set('authFlow', 'signup')
  return callbackUrl.toString()
}

export function saveAuthIntent(storage, flow, redirectTo = '/') {
  storage?.setItem(AUTH_FLOW_STORAGE_KEY, flow === 'signup' ? 'signup' : 'signin')
  storage?.setItem(AUTH_REDIRECT_STORAGE_KEY, redirectTo)
}

export function getAuthIntent(searchParams, storage) {
  const callbackFlow = searchParams.get('authFlow')
  const storedFlow = storage?.getItem(AUTH_FLOW_STORAGE_KEY)
  const flow = callbackFlow === 'signup' || callbackFlow === 'signin'
    ? callbackFlow
    : storedFlow === 'signup' || storedFlow === 'signin'
      ? storedFlow
      : 'signin'
  const redirectTo = searchParams.get('redirectTo') || storage?.getItem(AUTH_REDIRECT_STORAGE_KEY) || '/'

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
