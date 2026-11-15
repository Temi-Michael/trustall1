import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAuthCallbackUrl,
  buildGoogleOAuthOptions,
  clearAuthIntent,
  getAuthIntent,
  getEmailSignupOutcome,
  needsProfileSetup,
  readEmailLinkParams,
  recoveryLinkStatus,
  safeRedirectPath,
  safeReferralCode,
  saveAuthIntent,
  shouldCompleteGoogleSignup,
} from './authFlow.js'

test('sign-in redirects stay on this site', () => {
  assert.equal(safeRedirectPath('/listing/phone?promotion=featured#reviews'), '/listing/phone?promotion=featured#reviews')
  assert.equal(safeRedirectPath('/orders'), '/orders')
  for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example',
    'javascript:alert(1)', 'evil.example', '/\tevil', '', null, undefined]) {
    assert.equal(safeRedirectPath(unsafe), '/', `expected ${JSON.stringify(unsafe)} to be rejected`)
  }
})

test('unsafe redirects from the URL or storage are replaced with the home page', () => {
  const storage = createMemoryStorage()
  storage.setItem('trustall.auth-redirect', '//evil.example/steal')
  assert.equal(getAuthIntent(new URLSearchParams(), storage).redirectTo, '/')
  assert.equal(getAuthIntent(new URLSearchParams('redirectTo=/%5Cevil.example'), storage).redirectTo, '/')
  assert.match(buildAuthCallbackUrl('https://trustall.online', 'https://evil.example'), /redirectTo=%2F$/)
})

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('auth callback preserves application deep links and nested query strings', () => {
  const callback = new URL(buildAuthCallbackUrl(
    'https://trustall.online',
    '/listing/phone?promotion=featured&ref=invite'
  ))

  assert.equal(callback.origin, 'https://trustall.online')
  assert.equal(callback.pathname, '/auth')
  assert.equal(callback.searchParams.get('redirectTo'), '/listing/phone?promotion=featured&ref=invite')
  assert.equal(callback.searchParams.has('authFlow'), false)
})

test('Google signup callback preserves explicit signup intent and redirect destination', () => {
  const callback = new URL(buildAuthCallbackUrl(
    'https://preview.trustall.example',
    '/seller/ada',
    'signup'
  ))

  assert.equal(callback.searchParams.get('authFlow'), 'signup')
  assert.equal(callback.searchParams.get('redirectTo'), '/seller/ada')
})

test('OAuth intent survives a callback that drops query parameters', () => {
  const storage = createMemoryStorage()
  saveAuthIntent(storage, 'signup', '/listing/phone?promotion=featured')

  assert.deepEqual(getAuthIntent(new URLSearchParams(), storage), {
    flow: 'signup',
    redirectTo: '/listing/phone?promotion=featured',
    refCode: null,
  })

  clearAuthIntent(storage)
  assert.deepEqual(getAuthIntent(new URLSearchParams(), storage), {
    flow: 'signin',
    redirectTo: '/',
    refCode: null,
  })
})

test('callback URL intent takes precedence over stored OAuth intent', () => {
  const storage = createMemoryStorage()
  saveAuthIntent(storage, 'signup', '/seller/old')

  assert.deepEqual(getAuthIntent(new URLSearchParams('authFlow=signin&redirectTo=%2Forders'), storage), {
    flow: 'signin',
    redirectTo: '/orders',
    refCode: null,
  })
})

test('email signup results distinguish errors, existing accounts, confirmation, and session', () => {
  assert.equal(getEmailSignupOutcome(null, new Error('Signup failed')), 'error')
  assert.equal(getEmailSignupOutcome({ user: { id: 'existing', identities: [] }, session: null }), 'existing-account')
  assert.equal(getEmailSignupOutcome({ user: { id: 'new', identities: [{ provider: 'email' }] }, session: null }), 'confirmation-required')
  assert.equal(getEmailSignupOutcome({ user: { id: 'new' }, session: { access_token: 'session' } }), 'authenticated')
  assert.equal(getEmailSignupOutcome(null, null), 'unexpected')
})

test('Google registration completion is limited to explicit signup callbacks with a session', () => {
  const session = { user: { id: 'user-1' } }

  assert.equal(shouldCompleteGoogleSignup('signup', session), true)
  assert.equal(shouldCompleteGoogleSignup('signin', session), false)
  assert.equal(shouldCompleteGoogleSignup('signup', null), false)
})

test('Google sign-in always asks which account to use', () => {
  const options = buildGoogleOAuthOptions('https://trustall.online', '/orders', 'signup')
  assert.deepEqual(options.queryParams, { prompt: 'select_account' })
  assert.equal(options.redirectTo, buildAuthCallbackUrl('https://trustall.online', '/orders', 'signup'))
})

test('referral codes survive the Google redirect and are cleared with the intent', () => {
  const storage = createMemoryStorage()
  saveAuthIntent(storage, 'signup', '/', 'a1b2c3d4')
  assert.equal(getAuthIntent(new URLSearchParams(), storage).refCode, 'a1b2c3d4')
  assert.equal(getAuthIntent(new URLSearchParams('ref=fromurl'), storage).refCode, 'fromurl')

  saveAuthIntent(storage, 'signup', '/')
  assert.equal(getAuthIntent(new URLSearchParams(), storage).refCode, null, 'a new attempt without a code drops the old one')

  saveAuthIntent(storage, 'signup', '/', 'a1b2c3d4')
  clearAuthIntent(storage)
  assert.equal(getAuthIntent(new URLSearchParams(), storage).refCode, null)
})

test('only plain referral tokens are accepted', () => {
  assert.equal(safeReferralCode(' a1b2c3d4 '), 'a1b2c3d4')
  for (const bad of ['', 'has space', '<script>', 'a'.repeat(65), null, undefined, 42]) {
    assert.equal(safeReferralCode(bad), null, `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('profile setup follows the profile flag, with the old rule as fallback', () => {
  const session = { user: { id: 'user-1' } }
  // Migration 0038 applied: the flag decides, whichever button was used.
  assert.equal(needsProfileSetup('signin', session, { setup_completed_at: null }), true)
  assert.equal(needsProfileSetup('signup', session, { setup_completed_at: '2026-11-08T00:00:00Z' }), false)
  // Without 0038 (no column) or no profile yet: only after "Sign up with Google".
  assert.equal(needsProfileSetup('signup', session, { full_name: 'Ada' }), true)
  assert.equal(needsProfileSetup('signin', session, { full_name: 'Ada' }), false)
  assert.equal(needsProfileSetup('signup', session, null), true)
  assert.equal(needsProfileSetup('signup', null, { setup_completed_at: null }), false)
})

test('email links with a token hash are read and stripped from the address', () => {
  const link = readEmailLinkParams('https://trustall.online/reset-password?token_hash=abc123&type=recovery')
  assert.equal(link.kind, 'token_hash')
  assert.equal(link.tokenHash, 'abc123')
  assert.equal(link.type, 'recovery')
  assert.equal(link.cleanUrl, 'https://trustall.online/reset-password')

  const confirm = readEmailLinkParams('https://trustall.online/auth?redirectTo=%2Forders&token_hash=xyz&type=email')
  assert.equal(confirm.cleanUrl, 'https://trustall.online/auth?redirectTo=%2Forders', 'other query parameters are kept')
})

test('email links sent before the PKCE switch still sign in', () => {
  const link = readEmailLinkParams('https://trustall.online/reset-password#access_token=a&refresh_token=r&type=recovery')
  assert.deepEqual(
    { kind: link.kind, accessToken: link.accessToken, refreshToken: link.refreshToken, type: link.type },
    { kind: 'session_tokens', accessToken: 'a', refreshToken: 'r', type: 'recovery' },
  )
  assert.equal(link.cleanUrl, 'https://trustall.online/reset-password')
})

test('addresses that are not email links are ignored', () => {
  for (const href of [
    'https://trustall.online/auth?code=pkce-code',
    'https://trustall.online/auth?token_hash=abc&type=unknown',
    'https://trustall.online/#access_token=a&refresh_token=r',
    'https://trustall.online/listing/phone',
    'not a url',
  ]) {
    assert.equal(readEmailLinkParams(href), null, `expected ${href} to be ignored`)
  }
})

test('a used or expired reset link never counts as valid', () => {
  assert.equal(recoveryLinkStatus({ type: 'recovery', error: null }), 'valid')
  assert.equal(recoveryLinkStatus({ type: 'recovery', error: { message: 'Email link is invalid or has expired' } }), 'used')
  assert.equal(recoveryLinkStatus({ type: 'email', error: null }), 'none')
  assert.equal(recoveryLinkStatus({ type: null, error: null }), 'none')
  assert.equal(recoveryLinkStatus(undefined), 'none')
})

