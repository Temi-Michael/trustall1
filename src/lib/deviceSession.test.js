import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADMIN_IDLE_MS,
  IDLE_WARNING_MS,
  MAIN_DEVICE_IDLE_MS,
  OTHER_DEVICE_IDLE_MS,
  describeDevice,
  getDeviceId,
  holdInactivity,
  idleLimitMs,
  idleState,
  isInactivityHeld,
  readLastActivity,
  sessionSignedInAt,
  writeLastActivity,
} from './deviceSession.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('main device gets 3 hours, other devices and the admin page 15 minutes', () => {
  assert.equal(MAIN_DEVICE_IDLE_MS, 3 * 60 * 60 * 1000)
  assert.equal(OTHER_DEVICE_IDLE_MS, 15 * 60 * 1000)
  assert.equal(idleLimitMs({ isMain: true }), MAIN_DEVICE_IDLE_MS)
  assert.equal(idleLimitMs({ isMain: false }), OTHER_DEVICE_IDLE_MS)
  assert.equal(idleLimitMs({ isMain: true, isAdminRoute: true }), ADMIN_IDLE_MS)
  assert.equal(idleLimitMs(), OTHER_DEVICE_IDLE_MS)
})

test('the countdown warns a minute before sign-out, then expires', () => {
  const now = 1_000_000_000
  const limit = OTHER_DEVICE_IDLE_MS
  assert.equal(idleState(now, limit, now).status, 'active')
  assert.equal(idleState(now - limit + IDLE_WARNING_MS + 1, limit, now).status, 'active')
  assert.equal(idleState(now - limit + IDLE_WARNING_MS, limit, now).status, 'warning')
  assert.deepEqual(idleState(now - limit, limit, now), { status: 'expired', remainingMs: 0 })
  assert.equal(idleState(null, limit, now).status, 'active', 'no recorded activity counts as now')
})

test('each browser keeps one device ID', () => {
  const storage = createMemoryStorage()
  const id = getDeviceId(storage, () => '11111111-2222-4333-8444-555555555555')
  assert.equal(id, '11111111-2222-4333-8444-555555555555')
  assert.equal(getDeviceId(storage, () => 'should-not-be-used'), id)
  storage.setItem('trustall.device-id', 'tampered')
  assert.equal(getDeviceId(storage, () => '99999999-2222-4333-8444-555555555555'), '99999999-2222-4333-8444-555555555555')
})

test('last activity is shared through storage and survives broken storage', () => {
  const storage = createMemoryStorage()
  assert.equal(readLastActivity(storage), null)
  writeLastActivity(storage, 1234)
  assert.equal(readLastActivity(storage), 1234)
  writeLastActivity(storage, null)
  assert.equal(readLastActivity(storage), null)
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  assert.equal(readLastActivity(broken), null)
  assert.doesNotThrow(() => writeLastActivity(broken, 1))
})

test('device labels name the browser and system', () => {
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'), 'Chrome on Android')
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone or iPad')
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36 Edg/131.0'), 'Edge on Windows')
  assert.equal(describeDevice(''), 'Browser on unknown system')
})

test('the countdown can be paused for a reason and resumed', () => {
  assert.equal(isInactivityHeld(), false)
  holdInactivity('checkout', true)
  assert.equal(isInactivityHeld(), true)
  holdInactivity('checkout', false)
  assert.equal(isInactivityHeld(), false)
})

test('the sign-in time is read from the access token', () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = (payload) => `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`
  assert.equal(sessionSignedInAt(token({ amr: [{ method: 'password', timestamp: 1_700_000_000 }] })), 1_700_000_000_000)
  assert.equal(sessionSignedInAt(token({ amr: [{ method: 'oauth', timestamp: 10 }, { method: 'otp', timestamp: 20 }] })), 20_000)
  assert.equal(sessionSignedInAt(token({ sub: 'user' })), null)
  assert.equal(sessionSignedInAt('not-a-token'), null)
  assert.equal(sessionSignedInAt(null), null)
})

