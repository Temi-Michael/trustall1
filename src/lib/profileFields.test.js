import test from 'node:test'
import assert from 'node:assert/strict'
import { isProfileRpcUnavailable, PUBLIC_PROFILE_COLUMNS } from './profileFields.js'

test('public profile queries exclude generated payout state and private columns', () => {
  assert.equal(PUBLIC_PROFILE_COLUMNS.includes('avatar_url'), true)
  assert.equal(PUBLIC_PROFILE_COLUMNS.includes('payout_connected'), false)
  assert.equal(PUBLIC_PROFILE_COLUMNS.includes('wallet_cleared'), false)
  assert.equal(PUBLIC_PROFILE_COLUMNS.includes('paystack_recipient_code'), false)
})

test('public profile queries omit columns absent from the deployed profile schema', () => {
  for (const column of ['business_logo_url', 'buyer_avg_rating', 'buyer_review_count']) {
    assert.equal(PUBLIC_PROFILE_COLUMNS.includes(column), false)
  }
})

test('recognizes only missing profile RPC errors for the public fallback', () => {
  assert.equal(isProfileRpcUnavailable({ code: 'PGRST202' }), true)
  assert.equal(isProfileRpcUnavailable({ code: '42883' }), true)
  assert.equal(isProfileRpcUnavailable({ code: '42501' }), false)
  assert.equal(isProfileRpcUnavailable(null), false)
})
