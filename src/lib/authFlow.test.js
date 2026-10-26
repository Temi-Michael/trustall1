import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAuthCallbackUrl,
  clearAuthIntent,
  getAuthIntent,
  getEmailSignupOutcome,
  saveAuthIntent,
  shouldCompleteGoogleSignup,
} from './authFlow.js'

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
  })

  clearAuthIntent(storage)
  assert.deepEqual(getAuthIntent(new URLSearchParams(), storage), {
    flow: 'signin',
    redirectTo: '/',
  })
})

test('callback URL intent takes precedence over stored OAuth intent', () => {
  const storage = createMemoryStorage()
  saveAuthIntent(storage, 'signup', '/seller/old')

  assert.deepEqual(getAuthIntent(new URLSearchParams('authFlow=signin&redirectTo=%2Forders'), storage), {
    flow: 'signin',
    redirectTo: '/orders',
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
