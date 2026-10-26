export function buildAuthCallbackUrl(siteUrl, redirectTo = '/', flow = 'signin') {
  const callbackUrl = new URL('/auth', siteUrl)
  callbackUrl.searchParams.set('redirectTo', redirectTo)
  if (flow === 'signup') callbackUrl.searchParams.set('authFlow', 'signup')
  return callbackUrl.toString()
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
