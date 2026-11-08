import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAYMENT_REQUIREMENTS,
  fetchPaymentReadiness,
  isPaymentVerificationError,
  normalizePaymentReadiness,
} from './paymentReadiness.js'
import { withProfileSetupApplied } from './profileSetup.js'
import { isValidPhone } from './inputSafety.js'

const fakeClient = (result) => ({ rpc: async () => result })

test('readiness is normalised and only "ready" with nothing missing', () => {
  assert.deepEqual(normalizePaymentReadiness({ ready: true, missing: [] }), { ready: true, missing: [], checked: true })
  assert.deepEqual(
    normalizePaymentReadiness({ ready: false, missing: ['phone_missing', 42] }),
    { ready: false, missing: ['phone_missing'], checked: true },
  )
  assert.equal(normalizePaymentReadiness({ ready: true, missing: ['phone_missing'] }).ready, false)
  assert.equal(normalizePaymentReadiness(null).ready, false)
})

test('without migration 0040 the app behaves as before', async () => {
  const readiness = await fetchPaymentReadiness(fakeClient({ data: null, error: { code: 'PGRST202' } }))
  assert.deepEqual(readiness, { ready: true, missing: [], checked: false })
  await assert.rejects(fetchPaymentReadiness(fakeClient({ data: null, error: { code: '500', message: 'boom' } })))
})

test('the checkout refusal is recognised by its hint', () => {
  assert.equal(isPaymentVerificationError({ hint: 'payment_verification_required' }), true)
  assert.equal(isPaymentVerificationError({ message: 'This offer is no longer payable' }), false)
  assert.equal(isPaymentVerificationError(null), false)
})

test('every database requirement code has a description', () => {
  const codes = PAYMENT_REQUIREMENTS.map((requirement) => requirement.code)
  assert.deepEqual(codes, ['email_unconfirmed', 'profile_setup', 'phone_missing', 'account_suspended'])
})

test('finishing setup updates the shared profile only where the flag exists', () => {
  const now = new Date('2026-11-08T10:00:00Z')
  assert.deepEqual(
    withProfileSetupApplied({ id: 'u', full_name: '', setup_completed_at: null }, { full_name: 'Ada' }, now),
    { id: 'u', full_name: 'Ada', setup_completed_at: '2026-11-08T10:00:00.000Z' },
  )
  assert.deepEqual(withProfileSetupApplied({ id: 'u' }, { full_name: 'Ada' }, now), { id: 'u', full_name: 'Ada' })
  assert.equal(withProfileSetupApplied(null, { full_name: 'Ada' }), null)
})

test('phone numbers follow the database format rule', () => {
  for (const ok of ['08031234567', '+234 803 123 4567', '(0803) 123-4567']) assert.equal(isValidPhone(ok), true, ok)
  for (const bad of ['', '12345', 'call me', '0803123456789012345678', null]) assert.equal(isValidPhone(bad), false, String(bad))
})
