// Profile columns anyone may read. Wallet balances, payout codes, warnings and
// referral data are hidden by the database (migration 0033); read your own via
// the get_my_profile RPC. select('*') on profiles fails for that reason, so
// list columns explicitly.
export const PUBLIC_PROFILE_COLUMNS = [
  'id', 'full_name', 'business_name', 'handle', 'state', 'bio', 'avatar_url', 'business_logo_url',
  'role', 'status', 'is_seller', 'verified_seller', 'pro_vendor', 'pro_buyer', 'seller_level', 'phone_verified',
  'avg_rating', 'buyer_avg_rating', 'buyer_review_count', 'completed_sales_count', 'completed_purchases_count',
  'total_sales_volume', 'payout_connected', 'last_seen_at', 'created_at',
].join(', ')
