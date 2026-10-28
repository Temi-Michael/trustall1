import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useSession } from '../lib/useProfile.js'
import { PUBLIC_PROFILE_COLUMNS } from '../lib/profileFields.js'
import { SealMark } from '../components/Navbar.jsx'
import { LoadingState, NotFound, DataError } from '../components/ErrorBoundary.jsx'
import Seo from '../components/Seo.jsx'

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function formatMembershipDate(createdAt) {
  if (!createdAt) return null
  const joined = new Date(createdAt)
  if (Number.isNaN(joined.getTime())) return null

  const now = new Date()
  const years = now.getFullYear() - joined.getFullYear() - (
    now < new Date(now.getFullYear(), joined.getMonth(), joined.getDate()) ? 1 : 0
  )
  const month = joined.toLocaleDateString('en-US', { month: 'long' })
  const year = joined.getFullYear()
  return years >= 1 ? `Member since ${year} (${years} ${years === 1 ? 'year' : 'years'} on Trustall)` : `Member since ${month} ${year}`
}

function formatResponseTime(seconds) {
  if (!seconds || seconds < 0) return null
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60))
    return `Usually responds within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }
  if (seconds < 86400) {
    const hours = Math.max(1, Math.round(seconds / 3600))
    return `Usually responds within ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return 'Usually responds within a day or more'
}

function ReviewStars({ value }) {
  return (
    <span className="font-mono text-xs text-marigold-deep">
      {Array.from({ length: 5 }).map((_, idx) => (
        <span key={idx}>{idx < Number(value || 0) ? '★' : '☆'}</span>
      ))}
    </span>
  )
}

export function BuyerProfile() {
  const { handle: identifier } = useParams()
  const [buyer, setBuyer] = useState(null)
  const [reviews, setReviews] = useState([])
  const [avgRating, setAvgRating] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setError(null)
        
        const lookupColumn = UUID_PATTERN.test(identifier) ? 'id' : 'handle'
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq(lookupColumn, identifier)
          .maybeSingle()

        if (profileError) {
          console.error('Error loading buyer profile:', profileError)
          setError(profileError)
          setBuyer(null)
          setReviews([])
          setAvgRating(0)
          return
        }

        if (!profile) {
          setBuyer(null)
          setReviews([])
          setAvgRating(0)
          return
        }

        setBuyer(profile)

        const { data: revieweeReviews, error: reviewError } = await supabase
          .from('reviews')
          .select('*, reviewer:reviewer_id(id, business_name, full_name, handle, avatar_url)')
          .eq('reviewee_id', profile.id)
          .eq('review_type', 'seller_to_buyer')
          .order('created_at', { ascending: false })

        if (reviewError) {
          console.error('Error loading reviews:', reviewError)
          setError(reviewError)
          return
        }

        const dedupedReviews = revieweeReviews || []
        setReviews(dedupedReviews)
        setError(null)

        if (dedupedReviews.length > 0) {
          const avg = dedupedReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / dedupedReviews.length
          setAvgRating(avg)
        }
      } catch (err) {
        console.error('Unexpected error loading buyer profile:', err)
        setError(err)
        setBuyer(null)
        setReviews([])
      } finally {
        setLoading(false)
      }
    }

    if (identifier) {
      load()
    }
  }, [identifier])

  // Loading state
  if (loading) {
    return <LoadingState message="Loading buyer profile…" />
  }

  // Error state
  if (error) {
    return (
      <div className="px-6 py-24">
        <DataError 
          error={error} 
          onRetry={() => window.location.reload()}
          actionLabel="Reload"
          actionHref="/browse"
        />
      </div>
    )
  }

  // Not found state
  if (!buyer) {
    return (
      <div className="px-6 py-24">
        <NotFound 
          message="This buyer profile could not be found."
          actionHref="/browse"
        />
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <div className="rounded-2xl border border-hairline bg-white p-8">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-xl font-bold text-surface">
            {buyer.avatar_url ? (
              <img src={buyer.avatar_url} alt={buyer.full_name || 'Profile'} className="h-full w-full object-cover" />
            ) : (
              (buyer.full_name || buyer.business_name || '?').slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">{buyer.business_name || buyer.full_name}</h1>
            <p className="font-mono text-xs text-muted">
              @{buyer.handle} · Buyer profile
              {avgRating > 0 ? ` · ${avgRating.toFixed(1)}★ (${reviews.length} reviews)` : reviews.length > 0 ? ` · ${reviews.length} reviews` : ''}
            </p>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="font-display text-lg font-bold text-ink mb-1">Seller reviews</h2>
          <p className="font-mono text-xs text-muted mb-6">
            {reviews.length === 0 ? 'No reviews yet' : `${reviews.length} review${reviews.length === 1 ? '' : 's'} from sellers`}
          </p>

          {reviews.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-hairline bg-surfacealt/50 p-8 text-center">
              <p className="text-sm text-muted">This buyer doesn't have any seller reviews yet. They'll appear here as sellers submit them.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {reviews.map((review) => (
                <article key={review.id} className="group rounded-2xl border border-hairline bg-white p-5 sm:p-6 shadow-xs hover:shadow-sm hover:border-seal/50 transition-all duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <Link to={`/seller/${review.reviewer?.handle || review.reviewer?.id}`} className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-seal/20 to-seal/10 border border-seal/20 font-display text-sm font-bold text-seal transition group-hover:from-seal/30 group-hover:to-seal/20">
                        {review.reviewer?.avatar_url ? (
                          <img src={review.reviewer.avatar_url} alt={review.reviewer?.business_name || 'Seller'} className="h-full w-full object-cover" />
                        ) : (
                          (review.reviewer?.business_name || review.reviewer?.full_name || '?').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm sm:text-base font-bold text-ink group-hover:text-seal transition">
                          {review.reviewer?.business_name || review.reviewer?.full_name || 'A seller'}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                          @{review.reviewer?.handle}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ReviewStars value={review.rating} />
                      <span className="ml-2 font-display text-sm font-bold text-ink">{review.rating}/5</span>
                    </div>
                  </div>
                  
                  {review.comment && (
                    <p className="mt-4 text-sm leading-relaxed text-muted italic border-l-2 border-seal/30 pl-4">
                      "{review.comment}"
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default function SellerProfile() {
  const { handle: identifier } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const [seller, setSeller] = useState(null)
  const [listings, setListings] = useState([])
  const [reviews, setReviews] = useState([])
  const [avgRating, setAvgRating] = useState(0)
  const [salesSummary, setSalesSummary] = useState({ totalSales: 0, totalRevenue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [shareLabel, setShareLabel] = useState('Share profile')
  const [manualShareUrl, setManualShareUrl] = useState('')
  const [responseStats, setResponseStats] = useState(null)

  useEffect(() => {
    async function loadSellerProfile() {
      try {
        setLoading(true)
        setError(null)
        
        const lookupColumn = UUID_PATTERN.test(identifier) ? 'id' : 'handle'
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq(lookupColumn, identifier)
          .maybeSingle()
        if (profileError) throw profileError
        setSeller(data)

        if (!data) {
          setLoading(false)
          return
        }

        const { data: rawStats, error: statsError } = await supabase.rpc('get_seller_response_stats', { p_seller_id: data.id })
        if (statsError) {
          console.warn('Seller response stats unavailable:', statsError)
          setResponseStats(null)
        } else {
          setResponseStats(Array.isArray(rawStats) ? rawStats[0] || null : rawStats)
        }

        // Fetch buyer reviews of this seller
        const [{ data: sellerReviews, error: sellError }, { data: revieweeReviews, error: revError }] = await Promise.all([
          supabase
            .from('reviews')
            .select('*, reviewer:reviewer_id(id, business_name, full_name, handle, avatar_url)')
            .eq('seller_id', data.id)
            .eq('review_type', 'buyer_to_seller')
            .order('created_at', { ascending: false }),
          supabase
            .from('reviews')
            .select('*, reviewer:reviewer_id(id, business_name, full_name, handle, avatar_url)')
            .eq('reviewee_id', data.id)
            .eq('review_type', 'buyer_to_seller')
            .order('created_at', { ascending: false })
        ])

        if (sellError || revError) {
          console.error('Error loading reviews:', sellError || revError)
          setError(sellError || revError)
          return
        }

        const allReviews = [...(sellerReviews || []), ...(revieweeReviews || [])]
        const dedupedReviews = allReviews.filter((review, index, array) => array.findIndex((item) => item.id === review.id) === index)

        setReviews(dedupedReviews)

        if (dedupedReviews.length > 0) {
          const avg = dedupedReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / dedupedReviews.length
          setAvgRating(avg)
        }

        const [{ data: items }, { data: categoryRows }] = await Promise.all([
          supabase.from('listings').select('*').eq('seller_id', data.id).eq('is_active', true),
          supabase.from('categories').select('id, name'),
        ])
        const categoryById = new Map((categoryRows || []).map((category) => [category.id, category.name]))
        const publicItems = (items || []).filter(isPublicServiceListing)
          .map((item) => ({ ...item, categoryName: categoryById.get(item.category_id) || item.category || 'Digital service' }))
          .sort((first, second) => new Date(second.created_at) - new Date(first.created_at))
        const serviceListingIds = publicItems.filter((item) => item.product_type === 'digital_service').map((item) => item.id)
        const { data: packageRows } = serviceListingIds.length > 0
          ? await supabase.from('service_packages').select('listing_id, tier, price').in('listing_id', serviceListingIds)
          : { data: [] }
        const basicPriceByListing = (packageRows || []).reduce((prices, row) => {
          if (row.tier === 'basic') prices[row.listing_id] = row.price
          return prices
        }, {})
        publicItems.forEach((item) => { item.basicPackagePrice = basicPriceByListing[item.id] })
        setListings(publicItems)

        const profileSalesCount = Number(data.completed_sales_count || 0)
        const profileSalesRevenue = Number(data.total_sales_volume || 0)

        const { data: sales } = await supabase
          .from('orders')
          .select('id, status, amount, seller_payout, buyer_fee, delivery_fee')
          .eq('seller_id', data.id)
          .in('status', ['paid', 'fulfilled', 'confirmed', 'complete', 'completed', 'disputed'])

        const completedStatuses = new Set(['confirmed', 'complete', 'completed'])
        const completedOrders = (sales || []).filter((order) => completedStatuses.has(order.status))
        const derivedTotalSales = completedOrders.length
        const derivedRevenue = completedOrders.reduce((sum, order) => sum + Number(order.seller_payout || order.amount || 0), 0)

        setSalesSummary({
          totalSales: profileSalesCount > 0 ? profileSalesCount : derivedTotalSales,
          totalRevenue: profileSalesRevenue > 0 ? profileSalesRevenue : derivedRevenue,
        })
        
        setError(null)
        setLoading(false)
      } catch (err) {
        console.error('Unexpected error loading seller profile:', err)
        setError(err)
        setSeller(null)
        setLoading(false)
      }
    }

    if (identifier) {
      loadSellerProfile()
    }
  }, [identifier])

  useEffect(() => {
    if (!seller?.id) return

    const channel = supabase
      .channel(`seller-public-stats-${seller.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${seller.id}` }, async () => {
        const { data: sales } = await supabase
          .from('orders')
          .select('id, status, amount, seller_payout')
          .eq('seller_id', seller.id)
          .in('status', ['paid', 'fulfilled', 'confirmed', 'complete', 'completed', 'disputed'])

        const completedStatuses = new Set(['confirmed', 'complete', 'completed'])
        const completedOrders = (sales || []).filter((order) => completedStatuses.has(order.status))
        const derivedTotalSales = completedOrders.length
        const derivedRevenue = completedOrders.reduce((sum, order) => sum + Number(order.seller_payout || order.amount || 0), 0)

        const { data: profileRow } = await supabase
          .from('profiles')
          .select('completed_sales_count, total_sales_volume')
          .eq('id', seller.id)
          .single()

        setSalesSummary({
          totalSales: Number(profileRow?.completed_sales_count || 0) > 0 ? Number(profileRow.completed_sales_count) : derivedTotalSales,
          totalRevenue: Number(profileRow?.total_sales_volume || 0) > 0 ? Number(profileRow.total_sales_volume) : derivedRevenue,
        })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [seller?.id])

  async function messageSeller() {
    if (!session) {
      navigate('/auth', { state: { redirectTo: `/seller/${identifier}` } })
      return
    }
    if (session.user.id === seller.id) return

    setStarting(true)
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .eq('buyer_id', session.user.id).eq('seller_id', seller.id)
      .maybeSingle()

    let conversationId = existing?.id
    if (!conversationId) {
      const { data: created, error } = await supabase
        .from('conversations').insert({ buyer_id: session.user.id, seller_id: seller.id })
        .select('id').single()
      if (error) { setStarting(false); return }
      conversationId = created.id
    }
    navigate(`/messages/${conversationId}`)
  }

  async function shareProfile() {
    const url = window.location.href
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        copied = true
      }

      if (navigator.share) {
        await navigator.share({ title: seller.business_name || 'Trustall seller', url })
        setShareLabel('Shared')
      } else if (copied) {
        setShareLabel('Link copied')
      } else {
        setManualShareUrl(url)
        return
      }
      setTimeout(() => setShareLabel('Share profile'), 1800)
    } catch (error) {
      if (error.name === 'AbortError' && copied) {
        setShareLabel('Link copied')
        setTimeout(() => setShareLabel('Share profile'), 1800)
      } else if (error.name !== 'AbortError') {
        console.error('Failed to share seller profile:', error)
        if (!copied) setManualShareUrl(url)
      }
    }
  }

  if (loading) return <LoadingState message="Loading seller profile…" />
  
  if (error) {
    return (
      <div className="px-6 py-24">
        <DataError 
          error={error} 
          onRetry={() => window.location.reload()}
          actionLabel="Reload"
          actionHref="/browse"
        />
      </div>
    )
  }
  
  if (!seller) {
    return (
      <div className="px-6 py-24">
        <NotFound 
          message="This seller could not be found."
          actionHref="/browse"
        />
      </div>
    )
  }

  const salesCount = salesSummary.totalSales || seller.completed_sales_count || 0
  const salesRevenue = Number(salesSummary.totalRevenue || 0)
  const isOwnStorefront = session?.user?.id === seller.id
  const sellerName = seller.business_name || seller.full_name || 'Trustall seller'
  const sellerDescription = String(seller.bio || `${sellerName} offers products and services to buyers across Nigeria on Trustall.`)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  const sellerPath = `/seller/${encodeURIComponent(seller.handle || identifier)}`

  return (
    <>
    <Seo
      title={`${sellerName} | ${seller.verified_seller ? 'Verified seller' : 'Seller'} on Trustall`}
      description={sellerDescription}
      path={sellerPath}
      image={seller.avatar_url || undefined}
      noindex={seller.status === 'suspended'}
      structuredData={{
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        name: `${sellerName} on Trustall`,
        description: sellerDescription,
        url: `https://trustall.online${sellerPath}`,
        mainEntity: {
          '@type': seller.business_name ? 'Organization' : 'Person',
          name: sellerName,
          ...(seller.avatar_url ? { image: seller.avatar_url } : {}),
        },
      }}
    />
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
      <div className="seller-hero overflow-hidden rounded-[28px] border border-seal/20 p-5 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-2xl font-bold text-surface ring-4 ring-white/70">
              {seller.avatar_url ? (
                <img src={seller.avatar_url} alt={seller.business_name || 'Profile'} className="h-full w-full object-cover" />
              ) : (
                (seller.business_name || '?').slice(0, 2).toUpperCase()
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{seller.business_name}</h1>
                {seller.verified_seller && <SealMark size={18} />}
              </div>
              <p className="font-mono text-xs text-muted">
                @{seller.handle} · {seller.state}
                {avgRating > 0 ? ` · ${avgRating.toFixed(1)}★ (${reviews.length} reviews)` : reviews.length > 0 ? ` · ${reviews.length} reviews` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {formatMembershipDate(seller.created_at) && <span>{formatMembershipDate(seller.created_at)}</span>}
                {responseStats?.sample_size > 0 && formatResponseTime(responseStats.avg_response_seconds) && (
                  <span>{formatResponseTime(responseStats.avg_response_seconds)}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {seller.pro_vendor && (
                  <span className="rounded-full bg-marigold px-2.5 py-0.5 font-mono text-[10px] font-semibold text-ink">PRO VENDOR</span>
                )}
                {seller.seller_level >= 1 && (
                  <span className="rounded-full bg-seal/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-seal">LEVEL {seller.seller_level}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <button type="button" onClick={shareProfile} className="rounded-full border border-hairline bg-white/80 px-4 py-2.5 font-body text-sm font-semibold text-ink hover:border-seal hover:text-seal">{shareLabel}</button>
            {isOwnStorefront ? (
              <Link to="/sell" className="rounded-full bg-seal px-6 py-2.5 font-body text-sm font-semibold text-surface hover:bg-seal-deep">Edit storefront</Link>
            ) : (
              <button onClick={messageSeller} disabled={starting} className="rounded-full bg-seal px-6 py-2.5 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50">{starting ? 'Starting…' : 'Message seller'}</button>
            )}
          </div>
        </div>

        {seller.bio && <p className="mt-5 max-w-3xl border-t border-seal/15 pt-4 text-sm leading-relaxed text-muted">{seller.bio}</p>}

        {manualShareUrl && (
          <div className="mt-4 w-full rounded-2xl border border-hairline bg-white/80 p-3">
            <label className="block text-xs text-muted" htmlFor="manual-profile-link">Copy this profile link</label>
            <input id="manual-profile-link" readOnly value={manualShareUrl} onFocus={(event) => event.target.select()} className="mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-xs text-ink" />
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 divide-x divide-white/20 rounded-2xl bg-seal px-4 py-5 text-white sm:max-w-xl sm:px-6">
        <div className="pr-4 sm:pr-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/70">Completed orders</p>
          <p className="mt-2 font-display text-3xl font-bold">{salesCount}</p>
          <p className="mt-1 text-xs text-white/70">{salesCount === 0 ? 'No completed sales yet' : 'Buyer-confirmed'}</p>
        </div>
        <div className="pl-4 sm:pl-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/70">Sales volume</p>
          <p className="mt-2 font-display text-3xl font-bold text-marigold-soft">₦{salesRevenue.toLocaleString()}</p>
          <p className="mt-1 text-xs text-white/70">Confirmed sales</p>
        </div>
      </div>

      <div className="mt-12">
        <div className="flex items-end justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Shop the collection</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">Available now</h2>
          </div>
          <span className="font-mono text-xs text-muted">{listings.length} {listings.length === 1 ? 'item' : 'items'}</span>
        </div>
      {listings.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No active listings yet.</p>
      ) : (
        <div className="listing-grid mt-5 gap-4 sm:gap-6">
          {listings.map((l) => (
            <Link key={l.id} to={`/listing/${l.slug}`} className="listing-card group transition">
              <div className="listing-card-image mb-3 aspect-[4/5] overflow-hidden rounded-2xl bg-surfacealt">
                {listingImageUrl(firstListingImage(l.images)) && <img src={listingImageUrl(firstListingImage(l.images))} alt={l.title} className="h-full w-full object-cover" />}
              </div>
              <p className="truncate font-mono text-[10px] uppercase tracking-widest text-seal">{l.categoryName}</p>
              <p className="listing-card-title mt-1 font-body text-sm font-semibold text-ink group-hover:text-seal">{l.title}</p>
              <p className="mt-2 font-mono text-xs text-muted">{l.product_type === 'digital_service' ? 'From ' : ''}₦{Number(l.product_type === 'digital_service' ? (l.basicPackagePrice ?? l.price) : l.price || 0).toLocaleString()}</p>
            </Link>
          ))}
        </div>
      )}
      </div>

      <div className="mt-14">
        <div className="border-b border-hairline pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Community notes</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-ink">Buyer reviews</h2>
        </div>
        <p className="font-mono text-xs text-muted mb-6">
          {reviews.length === 0 ? 'No reviews yet' : `${reviews.length} review${reviews.length === 1 ? '' : 's'} from buyers`}
        </p>

        {reviews.length === 0 ? (
          <div className="border-b border-hairline py-8 text-center">
            <p className="text-sm text-muted">This seller doesn't have any reviews yet. They'll appear here as buyers submit them.</p>
          </div>
        ) : (
          <div className="mt-2 divide-y divide-hairline">
            {reviews.map((review) => (
              <article key={review.id} className="group py-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <Link to={`/buyer/${review.reviewer?.handle || review.reviewer?.id}`} className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-seal/20 to-seal/10 border border-seal/20 font-display text-sm font-bold text-seal transition group-hover:from-seal/30 group-hover:to-seal/20">
                      {review.reviewer?.avatar_url ? (
                        <img src={review.reviewer.avatar_url} alt={review.reviewer?.full_name || 'Buyer'} className="h-full w-full object-cover" />
                      ) : (
                        (review.reviewer?.business_name || review.reviewer?.full_name || '?').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm sm:text-base font-bold text-ink group-hover:text-seal transition">
                        {review.reviewer?.business_name || review.reviewer?.full_name || 'A buyer'}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                        @{review.reviewer?.handle}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <ReviewStars value={review.rating} />
                    <span className="ml-2 font-display text-sm font-bold text-ink">{review.rating}/5</span>
                  </div>
                </div>

                {review.comment && (
                  <p className="mt-4 text-sm leading-relaxed text-muted italic border-l-2 border-seal/30 pl-4">
                    "{review.comment}"
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
    </>
  )
}
