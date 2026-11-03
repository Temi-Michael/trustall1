// Profile columns anyone may read. Wallet balances, payout codes, warnings and
// referral data are hidden by the database (migration 0033); read your own via
// the get_my_profile RPC. select('*') on profiles fails for that reason, so
// list columns explicitly.
export const PUBLIC_PROFILE_COLUMNS = [
  'id', 'full_name', 'business_name', 'handle', 'state', 'bio', 'avatar_url',
  'role', 'status', 'is_seller', 'verified_seller', 'pro_vendor', 'pro_buyer', 'seller_level', 'phone_verified',
  'avg_rating', 'completed_sales_count', 'completed_purchases_count',
  'total_sales_volume', 'last_seen_at', 'created_at',
].join(', ')

export function isProfileRpcUnavailable(error) {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

// 42703: Postgres "column does not exist", as returned through PostgREST.
export function isMissingColumn(error) {
  return error?.code === '42703'
}

// The signed-in user's full profile, private fields included. get_my_profile
// (migration 0033) is the normal path. A database without it also has no
// column restrictions, so select('*') returns the same fields there.
export async function fetchOwnProfile(client, userId) {
  const { data, error } = await client.rpc('get_my_profile').maybeSingle()
  if (!error) return data
  if (!isProfileRpcUnavailable(error)) throw error

  const fallback = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (fallback.error) throw fallback.error
  return fallback.data
}

// Whether a seller can be paid. Migration 0033 exposes only the
// payout_connected flag; databases without it have no flag but still let
// anyone read the payout code.
export async function fetchPayoutConnected(client, profileId) {
  const { data, error } = await client.from('profiles').select('payout_connected').eq('id', profileId).maybeSingle()
  if (!error) return Boolean(data?.payout_connected)
  if (!isMissingColumn(error)) throw error

  const legacy = await client.from('profiles').select('paystack_recipient_code').eq('id', profileId).maybeSingle()
  if (legacy.error) throw legacy.error
  return Boolean(legacy.data?.paystack_recipient_code)
}
