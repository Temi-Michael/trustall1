import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bookmark, BookmarkCheck, Trash2 } from 'lucide-react'
import { useProfile } from '../lib/useProfile.js'
import { supabase } from '../lib/supabaseClient.js'
import { clearRecentlyViewed, loadRecentlyViewed, loadSavedListingIds, saveListing, unsaveListing } from '../lib/listingFeatures.js'
import Seo from '../components/Seo.jsx'
import { recordPromotionEvent } from '../lib/promotions.js'

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River',
  'Delta','Ebonyi','Edo','Ekiti','Enugu','FCT (Abuja)','Gombe','Imo','Jigawa','Kaduna','Kano',
  'Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
  'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
]

function listingImageUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return supabase.storage.from('listing-images').getPublicUrl(value).data.publicUrl
}

function firstListingImage(value) {
  if (Array.isArray(value)) return value[0] || ''
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed[0] || '' : value
    } catch {
      return value
    }
  }
  return ''
}

function isPublicServiceListing(listing) {
  return listing.product_type !== 'digital_service' || listing.status === 'published'
}

function normalizedLabel(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
}

function isServiceLabel(value) {
  return /freelanc|service|digital/.test(normalizedLabel(value))
}

function LevelBadge({ level, proVendor }) {
  if (proVendor) {
    return <span className="listing-card-badge rounded-full bg-marigold px-2 py-0.5 font-mono text-[10px] font-semibold text-ink">PRO VENDOR</span>
  }
  if (level >= 1) {
    return <span className="listing-card-badge rounded-full bg-seal/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-seal">LEVEL {level} VERIFIED</span>
  }
  return null
}

function ListingCard({ listing, saved, onToggleSave, compact = false, promotion = listing.promotion }) {
  const servicePrice = listing.product_type === 'digital_service' ? listing.basicPackagePrice : null
  const displayPrice = servicePrice ?? listing.price
  useEffect(() => {
    if (!compact && promotion?.id) recordPromotionEvent(promotion.id, 'impression', { listing_id: listing.id })
  }, [compact, promotion?.id, listing.id])
  return (
    <article className={`relative rounded-2xl border border-hairline bg-white ${compact ? 'recently-viewed-card min-w-[150px] p-2.5 sm:min-w-[165px]' : 'p-3 md:p-5'}`}>
      <Link to={`/listing/${listing.slug}${promotion?.id ? `?promotion=${encodeURIComponent(promotion.id)}` : ''}`} onClick={() => promotion?.id && recordPromotionEvent(promotion.id, 'click', { listing_id: listing.id })} className="block">
        <div className={`listing-card-image mb-3 aspect-square overflow-hidden rounded-xl bg-surfacealt ${compact ? '' : 'md:mb-4'}`}>
          {listingImageUrl(firstListingImage(listing.images)) && <img src={listingImageUrl(firstListingImage(listing.images))} alt={listing.title} loading="lazy" className="h-full w-full object-cover" />}
        </div>
        {promotion?.id && <span className="absolute left-4 top-4 rounded bg-marigold px-2 py-1 font-mono text-[9px] font-bold uppercase text-ink">Promoted</span>}
        <p className="truncate font-mono text-[10px] uppercase tracking-widest text-seal">{listing.product_type === 'digital_service' ? (listing.categoryName || 'Digital service') : listing.category}</p>
        <h3 className={`listing-card-title mt-1 truncate font-display text-sm text-ink ${compact ? '' : 'md:text-base'}`}>{listing.title}</h3>
        <p className={`mt-1 truncate font-mono font-semibold text-ink ${compact ? 'text-[11px]' : 'text-xs md:text-sm'}`}>{listing.product_type === 'digital_service' ? 'From ' : ''}₦{Number(displayPrice || 0).toLocaleString()}</p>
        {!compact && listing.seller && (
          <p className="mt-2 truncate text-xs text-muted">{listing.seller.business_name || 'Verified seller'}</p>
        )}
      </Link>
      <button type="button" onClick={() => onToggleSave(listing.id)} aria-label={saved ? 'Remove saved listing' : 'Save listing'} className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-seal shadow-sm hover:bg-seal hover:text-white">
        {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      </button>
    </article>
  )
}

export default function Browse() {
  const [params, setParams] = useSearchParams()
  const [listings, setListings] = useState([])
  const [sellerMetrics, setSellerMetrics] = useState({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [savedIds, setSavedIds] = useState(new Set())
  const [recentlyViewed, setRecentlyViewed] = useState([])
  const [clearingRecent, setClearingRecent] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [subcategoryOptions, setSubcategoryOptions] = useState([])
  const [tagOptions, setTagOptions] = useState([])
  const { session } = useProfile()
  const pageSize = 24

  const query = params.get('q') || ''
  const category = params.get('category') || ''
  const subcategory = params.get('subcategory') || ''
  const tag = params.get('tag') || ''
  const state = params.get('state') || ''

  useEffect(() => { setPage(0) }, [query, category, subcategory, tag, state])
  useEffect(() => { load() }, [query, category, subcategory, tag, state, page])

  useEffect(() => {
    if (!session?.user?.id) {
      setSavedIds(new Set())
      setRecentlyViewed([])
      return
    }
    loadSavedListingIds(session.user.id).then(setSavedIds)
    loadRecentlyViewed(session.user.id, 10).then(setRecentlyViewed)
  }, [session?.user?.id])

  useEffect(() => {
    Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('subcategories').select('id, category_id, name').eq('is_active', true).order('name'),
      supabase.from('tags').select('id, name').order('name'),
    ]).then(([categoryResult, subcategoryResult, tagResult]) => {
      setCategoryOptions(categoryResult.data || [])
      setSubcategoryOptions(subcategoryResult.data || [])
      setTagOptions(tagResult.data || [])
    })
  }, [])

  async function load() {
    setLoading(true)
    const cleanQuery = query.trim().toLowerCase()
    const selectedCategory = categoryOptions.find((item) => item.id === category)
    const selectedSubcategory = subcategoryOptions.find((item) => item.id === subcategory)
    const serviceAliasQuery = isServiceLabel(cleanQuery)
    const relevantPlacements = cleanQuery
      ? ['search_featured', 'marketplace_featured']
      : category || subcategory || tag
        ? ['category_featured', 'marketplace_featured']
        : ['marketplace_featured']
    const [{ data: rows, error: listingError }, { data: categories }, { data: subcategories }, { data: listingTagRows }, { data: tagRows }, ...promotionResults] = await Promise.all([
      supabase.from('listings').select('id, seller_id, slug, title, description, category, category_id, subcategory_id, product_type, status, is_active, images, price, created_at').eq('is_active', true).order('created_at', { ascending: false }).range(0, 999),
      supabase.from('categories').select('id, name'),
      supabase.from('subcategories').select('id, category_id, name'),
      supabase.from('listing_tags').select('listing_id, tag_id'),
      supabase.from('tags').select('id, name'),
      ...relevantPlacements.map((placement) => supabase.from('promotions').select('*').eq('status', 'active').contains('placements', [placement])),
    ])
    if (listingError) {
      console.error('Direct listing discovery failed:', listingError)
      setListings([])
      setLoading(false)
      return
    }
    const promotions = [...new Map(promotionResults.flatMap((result) => result.data || []).map((promotion) => [promotion.id, promotion])).values()]
      .filter((promotion) => ['product', 'service'].includes(promotion.target_type))
    const existingIds = new Set((rows || []).map((row) => row.id))
    const missingIds = [...new Set(promotions.map((promotion) => promotion.target_id).filter((id) => id && !existingIds.has(id)))]
    const { data: promotedRows } = missingIds.length
      ? await supabase.from('listings').select('id, seller_id, slug, title, description, category, category_id, subcategory_id, product_type, status, is_active, images, price, created_at').in('id', missingIds).eq('is_active', true)
      : { data: [] }
    const allRows = [...(rows || []), ...(promotedRows || [])]
    const categoryById = new Map((categories || []).map((item) => [item.id, item]))
    const selectedCategoryName = categoryById.get(category)?.name || selectedCategory?.name || category || null
    const { data: rankedRows } = await supabase.rpc('search_listings_ranked', {
      p_query: cleanQuery || null,
      p_category: selectedCategoryName,
      p_limit: 1000,
      p_offset: 0,
    })
    const rankedOrder = new Map((rankedRows || []).map((row, index) => [row.id, index]))
    const subcategoryById = new Map((subcategories || []).map((item) => [item.id, item]))
    const tagById = new Map((tagRows || []).map((item) => [item.id, item]))
    const tagsByListing = (listingTagRows || []).reduce((result, row) => {
      const tagName = tagById.get(row.tag_id)?.name
      if (tagName) result[row.listing_id] = [...(result[row.listing_id] || []), tagName]
      return result
    }, {})
    const sellerIds = [...new Set(allRows.map((listing) => listing.seller_id).filter(Boolean))]
    const { data: sellers } = sellerIds.length > 0
      ? await supabase.from('profiles').select('id, business_name, handle, state, verified_seller, seller_level, pro_vendor, completed_sales_count, avg_rating, avatar_url').in('id', sellerIds)
      : { data: [] }
    const sellerById = new Map((sellers || []).map((seller) => [seller.id, seller]))
    const promotionByListing = new Map(promotions.map((promotion) => [promotion.target_id, promotion]))
    const publicRows = allRows.filter(isPublicServiceListing).map((listing) => ({
      ...listing,
      categoryName: categoryById.get(listing.category_id)?.name || listing.category || '',
      subcategoryName: subcategoryById.get(listing.subcategory_id)?.name || '',
      tagNames: tagsByListing[listing.id] || [],
      seller: sellerById.get(listing.seller_id),
      promotion: promotionByListing.get(listing.id) || null,
    }))
    const matchingRows = publicRows.filter((listing) => {
      const categoryMatches = !category
        || listing.category_id === category
        || normalizedLabel(listing.categoryName) === normalizedLabel(selectedCategory?.name || category)
        || (isServiceLabel(category) && isServiceLabel(listing.categoryName))
      const subcategoryMatches = !subcategory || listing.subcategory_id === subcategory
      const tagMatches = !tag || listing.tagNames.some((name) => normalizedLabel(name) === normalizedLabel(tagOptions.find((item) => item.id === tag)?.name || tag))
      const searchText = [listing.title, listing.description, listing.categoryName, listing.subcategoryName, ...listing.tagNames].filter(Boolean).join(' ').toLowerCase()
      const searchMatches = !cleanQuery
        || searchText.includes(cleanQuery)
        || (serviceAliasQuery && isServiceLabel(listing.categoryName))
        || listing.seller?.business_name?.toLowerCase().includes(cleanQuery)
        || listing.seller?.handle?.toLowerCase().includes(cleanQuery)
      return categoryMatches && subcategoryMatches && tagMatches && searchMatches
    })
    const serviceIds = matchingRows.filter((listing) => listing.product_type === 'digital_service').map((listing) => listing.id)
    const { data: packageRows } = serviceIds.length > 0
      ? await supabase.from('service_packages').select('listing_id, tier, price').in('listing_id', serviceIds)
      : { data: [] }
    const basicPriceByListing = (packageRows || []).reduce((prices, servicePackage) => {
      if (servicePackage.tier === 'basic') prices[servicePackage.listing_id] = servicePackage.price
      return prices
    }, {})
    const results = matchingRows
      .map((listing) => ({ ...listing, basicPackagePrice: basicPriceByListing[listing.id], seller: sellerById.get(listing.seller_id) }))
      .filter((listing) => !state || listing.seller?.state === state)
      .sort((first, second) => Number(Boolean(second.promotion)) - Number(Boolean(first.promotion)) || (rankedOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (rankedOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER) || new Date(second.created_at) - new Date(first.created_at))
    const pagedResults = results.slice(page * pageSize, page * pageSize + pageSize)

    let metrics = {}

    for (const item of results) {
      const seller = item.seller
      if (!seller?.id) continue
      metrics[seller.id] = {
        count: Number(seller.completed_sales_count || 0),
      }
    }

    if (sellerIds.length > 0) {
      const { data: salesRows } = await supabase
        .from('orders')
        .select('seller_id')
        .in('seller_id', sellerIds)
        .in('status', ['confirmed', 'complete', 'completed'])

      const completedSalesBySeller = {}
      for (const row of salesRows || []) {
        completedSalesBySeller[row.seller_id] = (completedSalesBySeller[row.seller_id] || 0) + 1
      }

      for (const [sellerId, completedSales] of Object.entries(completedSalesBySeller)) {
        const currentCount = Number(metrics[sellerId]?.count || 0)
        metrics[sellerId] = { count: Math.max(currentCount, completedSales) }
      }
    }

    setSellerMetrics(metrics)
    setListings(pagedResults)
    setLoading(false)
  }

  async function toggleSave(listingId) {
    if (!session) {
      window.location.assign(`/auth?redirectTo=${encodeURIComponent('/browse')}`)
      return
    }
    const next = new Set(savedIds)
    if (next.has(listingId)) {
      await unsaveListing(session.user.id, listingId)
      next.delete(listingId)
    } else {
      await saveListing(session.user.id, listingId)
      next.add(listingId)
    }
    setSavedIds(next)
  }

  async function clearRecent() {
    if (!session?.user?.id || !window.confirm('Clear your recently viewed listings?')) return
    setClearingRecent(true)
    try {
      await clearRecentlyViewed(session.user.id)
      setRecentlyViewed([])
    } catch (error) {
      console.error('Failed to clear recently viewed listings:', error)
      alert('Could not clear recently viewed listings. Please try again.')
    } finally {
      setClearingRecent(false)
    }
  }

  function updateParam(key, value) {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next)
  }

  function updateCategory(value) {
    const next = new URLSearchParams(params)
    value ? next.set('category', value) : next.delete('category')
    next.delete('subcategory')
    setParams(next)
  }

  const selectedCategoryName = categoryOptions.find((item) => item.id === category)?.name
  const browseTitle = query
    ? `Search results for ${query.trim().slice(0, 45)} | Trustall`
    : selectedCategoryName
      ? `Shop ${selectedCategoryName} in Nigeria | Trustall`
      : 'Browse Products and Services in Nigeria | Trustall'
  const browseDescription = query
    ? `Search Trustall for ${query.trim().slice(0, 90)}. Find products and services from sellers across Nigeria.`
    : 'Browse products, digital services and local sellers across Nigeria. Find what you need and pay with Trustall buyer protection.'

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <Seo title={browseTitle} description={browseDescription} path="/browse" noindex={Boolean(query || subcategory || tag || state)} />
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Marketplace</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink">Browse listings</h1>
        <Link to="/sellers" className="rounded-full border border-hairline px-4 py-2 font-mono text-xs font-semibold text-seal transition hover:border-seal">Browse sellers</Link>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-4">
        <input
          placeholder="Search by name, seller, business…"
          defaultValue={query}
          onKeyDown={(e) => e.key === 'Enter' && updateParam('q', e.target.value)}
          onBlur={(e) => updateParam('q', e.target.value)}
          className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none sm:col-span-2"
        />
        <select value={category} onChange={(e) => updateCategory(e.target.value)} className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink focus:border-seal outline-none">
          <option value="">All categories</option>
          {categoryOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={subcategory} onChange={(e) => updateParam('subcategory', e.target.value)} className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink focus:border-seal outline-none">
          <option value="">All subcategories</option>
          {subcategoryOptions.filter((item) => !category || item.category_id === category).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={tag} onChange={(e) => updateParam('tag', e.target.value)} className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink focus:border-seal outline-none">
          <option value="">All tags</option>
          {tagOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={state} onChange={(e) => updateParam('state', e.target.value)} className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink focus:border-seal outline-none">
          <option value="">All states</option>
          {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {session && recentlyViewed.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold text-ink">Recently viewed</h2>
            <button type="button" onClick={clearRecent} disabled={clearingRecent} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted hover:text-seal disabled:opacity-50">
              <Trash2 size={13} aria-hidden="true" />{clearingRecent ? 'Clearing…' : 'Clear history'}
            </button>
          </div>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {recentlyViewed.map((listing) => <ListingCard key={listing.id} listing={listing} saved={savedIds.has(listing.id)} onToggleSave={toggleSave} compact />)}
          </div>
        </section>
      )}

      {loading && <p className="mt-12 text-muted">Loading listings…</p>}
      {!loading && listings.length === 0 && <p className="mt-12 text-muted">No listings match yet — try a different search or check back soon.</p>}

      <div className="listing-grid mt-10 gap-6">
        {listings.map((l) => {
          const sellerSales = sellerMetrics[l.seller?.id] || { count: 0 }
          return (
            <article key={l.id} className="relative rounded-2xl border border-hairline bg-white p-3 transition hover:-translate-y-0.5 hover:border-seal hover:shadow-md md:p-5">
              <Link to={`/listing/${l.slug}`} className="block">
              <div className="listing-card-image mb-3 aspect-square overflow-hidden rounded-xl bg-surfacealt">{listingImageUrl(firstListingImage(l.images)) && <img src={listingImageUrl(firstListingImage(l.images))} alt={l.title} className="h-full w-full object-cover" />}</div>
              <p className="truncate font-mono text-[10px] text-muted md:text-xs">{l.categoryName || l.category || 'Uncategorized'}</p>
              <h3 className="listing-card-title mt-1 truncate font-display text-sm text-ink md:text-base">{l.title}</h3>
              <p className="mt-1 truncate font-mono text-xs font-semibold text-ink md:text-sm">{l.product_type === 'digital_service' ? 'From ' : ''}₦{Number(l.product_type === 'digital_service' ? (l.basicPackagePrice ?? l.price) : l.price || 0).toLocaleString()}</p>
              <div className="mt-3 rounded-xl bg-surfacealt px-2 py-2 md:px-2.5">
                <div className="listing-card-stat"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted md:text-[10px] md:tracking-[0.2em]">Total sales</p><p className="font-display text-sm font-bold text-ink md:text-lg">{sellerSales.count}</p></div>
              </div>
              <div className="mt-3 flex min-w-0 items-center gap-2 md:gap-2.5">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-[10px] font-bold text-surface md:h-10 md:w-10 md:text-xs">
                  {l.seller?.avatar_url ? <img src={l.seller.avatar_url} alt={l.seller.business_name || 'Seller'} className="h-full w-full object-cover" /> : (l.seller?.business_name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-1 md:gap-2">
                  <div className="min-w-0"><span className="block truncate text-[10px] text-muted md:text-xs">{l.seller?.business_name}</span>{l.seller?.avg_rating ? <span className="mt-0.5 block truncate font-mono text-[9px] text-marigold-deep md:text-[10px]">{Number(l.seller.avg_rating).toFixed(1)}★ rating</span> : <span className="mt-0.5 block truncate font-mono text-[9px] text-muted md:text-[10px]">No reviews yet</span>}</div>
                  <LevelBadge level={l.seller?.seller_level} proVendor={l.seller?.pro_vendor} />
                </div>
              </div>
              </Link>
              <button type="button" onClick={() => toggleSave(l.id)} aria-label={savedIds.has(l.id) ? 'Remove saved listing' : 'Save listing'} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-seal shadow-sm hover:bg-seal hover:text-white">
                {savedIds.has(l.id) ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              </button>
            </article>
          )
        })}
      </div>
      {!loading && listings.length > 0 && (
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Previous</button>
          <button type="button" disabled={listings.length < pageSize} onClick={() => setPage((current) => current + 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Next</button>
        </div>
      )}
    </section>
  )
}
