import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchOwnProfile, fetchPayoutConnected, isProfileRpcUnavailable, PUBLIC_PROFILE_COLUMNS } from './profileFields.js'

// Minimal stand-in for the Supabase client: rpc() and from().select() resolve
// to whatever the test configures, and every query is recorded.
function fakeClient({ rpc, selects = {} }) {
  const calls = []
  const query = (columns) => {
    calls.push(columns)
    const result = selects[columns] ?? { data: null, error: null }
    const chain = { eq: () => chain, maybeSingle: async () => result }
    return chain
  }
  return {
    calls,
    rpc: () => ({ maybeSingle: async () => rpc }),
    from: () => ({ select: query }),
  }
}

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

test('own profile comes from get_my_profile when it exists', async () => {
  const client = fakeClient({ rpc: { data: { id: 'u1', referral_code: 'abc123' }, error: null } })
  assert.deepEqual(await fetchOwnProfile(client, 'u1'), { id: 'u1', referral_code: 'abc123' })
  assert.deepEqual(client.calls, [])
})

test('own profile falls back to every column, so private fields survive', async () => {
  const client = fakeClient({
    rpc: { data: null, error: { code: 'PGRST202' } },
    selects: { '*': { data: { id: 'u1', referral_code: 'abc123', wallet_cleared: 500 }, error: null } },
  })
  const profile = await fetchOwnProfile(client, 'u1')
  assert.equal(profile.referral_code, 'abc123')
  assert.equal(profile.wallet_cleared, 500)
  assert.deepEqual(client.calls, ['*'])
})

test('other own-profile errors are not hidden by the fallback', async () => {
  const client = fakeClient({ rpc: { data: null, error: { code: '42501', message: 'denied' } } })
  await assert.rejects(() => fetchOwnProfile(client, 'u1'), { code: '42501' })
})

test('payout status uses payout_connected where it exists', async () => {
  const client = fakeClient({ selects: { payout_connected: { data: { payout_connected: true }, error: null } } })
  assert.equal(await fetchPayoutConnected(client, 's1'), true)
  assert.deepEqual(client.calls, ['payout_connected'])
})

test('payout status falls back to the payout code on older databases', async () => {
  const client = fakeClient({
    selects: {
      payout_connected: { data: null, error: { code: '42703' } },
      paystack_recipient_code: { data: { paystack_recipient_code: 'RCP_1' }, error: null },
    },
  })
  assert.equal(await fetchPayoutConnected(client, 's1'), true)
  assert.deepEqual(client.calls, ['payout_connected', 'paystack_recipient_code'])
})

test('a seller without a payout account is reported as not connected', async () => {
  const client = fakeClient({
    selects: {
      payout_connected: { data: null, error: { code: '42703' } },
      paystack_recipient_code: { data: { paystack_recipient_code: null }, error: null },
    },
  })
  assert.equal(await fetchPayoutConnected(client, 's1'), false)
})
