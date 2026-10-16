import { supabase } from './supabaseClient.js'

export const PROMOTION_PLACEMENTS = [
  { id: 'homepage_featured', label: 'Homepage featured' },
  { id: 'marketplace_featured', label: 'Marketplace featured' },
  { id: 'category_featured', label: 'Category featured' },
  { id: 'search_featured', label: 'Search featured' },
  { id: 'seller_spotlight', label: 'Seller spotlight' },
]

export async function recordPromotionEvent(promotionId, eventType, metadata = {}) {
  if (!promotionId) return
  if (eventType === 'impression' && typeof window !== 'undefined') {
    const key = `trustall-promotion-impression:${promotionId}:${metadata.listing_id || metadata.target_id || ''}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // Continue recording when session storage is unavailable.
    }
  }
  const { error } = await supabase.rpc('record_promotion_event', {
    p_promotion_id: promotionId,
    p_event_type: eventType,
    p_metadata: metadata,
  })
  if (error) console.warn(`Promotion ${eventType} event could not be recorded:`, error.message)
}

export async function loadPromotionsForPlacement(placement) {
  const { data, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('status', 'active')
    .contains('placements', [placement])
  if (error) {
    console.warn(`Promotions for ${placement} could not be loaded:`, error.message)
    return []
  }
  return data || []
}