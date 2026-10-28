import { Trash2 } from 'lucide-react'
import { clearRecentlyViewed, loadRecentlyViewed } from '../lib/listingFeatures.js'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { useRole } from '../lib/RoleContext.jsx'
import Sell from './Sell.jsx'

export function OrderManagement() {
  const { session, profile, role, loading, isSeller } = useRole()

  if (loading) {
    return <div className="px-4 py-24 text-center text-muted sm:px-6">Checking your workspace…</div>
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-seal">Orders</p>
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">Please sign in to view your orders</h1>
        <p className="mt-3 text-sm text-muted">Your order history and status are available after you log in.</p>
        <Link to="/auth" className="mt-6 inline-flex rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
          Go to sign in
        </Link>
      </div>
    )
  }

  if (!profile) {
    return <div className="px-4 py-24 text-center text-muted sm:px-6">Setting up your account profile…</div>
  }

  if (isSeller) {
    return <SellerDashboard />
  }

  return <BuyerDashboard />
}

export function SellerDashboard() {
  const { session, profile, loading } = useProfile()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('orders')
  const [orderFilter, setOrderFilter] = useState('all')
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [ordersError, setOrdersError] = useState(null)
  const [myReviews, setMyReviews] = useState([])
  const [reviewsAboutMe, setReviewsAboutMe] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [reviewsError, setReviewsError] = useState(null)
  const [reviewsSubmitted, setReviewsSubmitted] = useState({})
  const [buyerRatings, setBuyerRatings] = useState({})
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/orders' } })
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session?.user?.id) return

    async function loadOrders() {
      setLoadingOrders(true)
      setOrdersError(null)
      const { data, error } = await supabase
        .from('orders')
        .select('*, offer:offer_id(item_title, item_description, price, delivery_fee), seller:seller_id(id, business_name, handle, verified_seller), buyer:buyer_id(id, full_name, business_name, handle)')
        .eq('seller_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Seller orders query failed:', error)
        setOrdersError(error.message || 'Failed to load orders. Please try again.')
        setOrders([])
      } else {
        setOrders(data || [])
        setOrdersError(null)
        
        // Fetch buyer ratings for all unique buyers using both legacy and current review fields
        if (data && data.length > 0) {
          const uniqueBuyerIds = [...new Set(data.map(order => order.buyer?.id).filter(Boolean))]
          const buyerRatingsMap = {}

          for (const buyerId of uniqueBuyerIds) {
            const [{ data: revieweeReviews }] = await Promise.all([
              supabase
                .from('reviews')
                .select('rating')
                .eq('reviewee_id', buyerId)
                .eq('review_type', 'seller_to_buyer'),
            ])

            const reviews = revieweeReviews || []
            if (reviews.length > 0) {
              const avgRating = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
              buyerRatingsMap[buyerId] = {
                avgRating: parseFloat(avgRating.toFixed(1)),
                reviewCount: reviews.length
              }
            } else {
              buyerRatingsMap[buyerId] = { avgRating: 0, reviewCount: 0 }
            }
          }

          setBuyerRatings(buyerRatingsMap)
        }
      }

      setLoadingOrders(false)

      // Check for existing reviews for confirmed orders
      if (data && session?.user?.id) {
        const submittedReviews = {}
        for (const order of data) {
          if (['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status)) {
            const { data: existingReview } = await supabase
              .from('reviews')
              .select('id')
              .eq('order_id', order.id)
              .eq('reviewer_id', session.user.id)
              .eq('review_type', 'seller_to_buyer')
              .single()
            
            if (existingReview) {
              submittedReviews[order.id] = true
            }
          }
        }
        setReviewsSubmitted(submittedReviews)
      }
    }

    loadOrders()

    const channel = supabase
      .channel(`seller-orders-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${session.user.id}` }, loadOrders)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session?.user?.id])

  // Load reviews submitted by this seller
  useEffect(() => {
    if (!session?.user?.id || activeTab !== 'myreviews') return

    async function loadMyReviews() {
      setLoadingReviews(true)
      setReviewsError(null)
      const [{ data, error }, { data: aboutMe, error: aboutMeError }] = await Promise.all([
        supabase
          .from('reviews')
          .select('*, order:order_id(id, buyer_id), reviewee:reviewee_id(id, business_name, full_name, handle, avatar_url)')
          .eq('reviewer_id', session.user.id)
          .eq('review_type', 'seller_to_buyer')
          .order('created_at', { ascending: false }),
        supabase
          .from('reviews')
          .select('*, reviewer:reviewer_id(id, business_name, full_name, handle, avatar_url)')
          .eq('reviewee_id', session.user.id)
          .eq('review_type', 'buyer_to_seller')
          .order('created_at', { ascending: false }),
      ])

      if (error || aboutMeError) {
        console.error('Failed to load seller review lists:', error || aboutMeError)
        setReviewsError((error || aboutMeError).message || 'Failed to load reviews.')
        setMyReviews([])
        setReviewsAboutMe([])
      } else {
        setMyReviews(data || [])
        setReviewsAboutMe(aboutMe || [])
        setReviewsError(null)
      }
      setLoadingReviews(false)
    }

    loadMyReviews()
  }, [session?.user?.id, activeTab])

  // Calculate summary - MUST be before early return to avoid hook violations
  const summary = useMemo(() => {
    const active = orders.filter((order) => ['paid', 'fulfilled'].includes(order.status))
    const past = orders.filter((order) => ['confirmed', 'completed', 'complete', 'disputed'].includes(order.status))
    return {
      total: orders.length,
      active: active.length,
      past: past.length,
      revenue: orders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
    }
  }, [orders])

  const visibleOrders = useMemo(() => {
    if (orderFilter === 'active') return orders.filter((order) => ['paid', 'fulfilled'].includes(order.status))
    if (orderFilter === 'completed') return orders.filter((order) => ['confirmed', 'completed', 'complete'].includes(order.status))
    return orders
  }, [orders, orderFilter])

  const ReviewStars = ({ value }) => (
    <span className="font-mono text-xs text-marigold-deep">
      {Array.from({ length: 5 }).map((_, idx) => (
        <span key={idx}>{idx < Number(value || 0) ? '★' : '☆'}</span>
      ))}
    </span>
  )

  if (loading && !session) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  return (
    <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-12">
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1f4d38] via-[#286649] to-[#183d30] p-5 text-white shadow-[0_20px_50px_rgba(31,77,56,0.16)] sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/70">Seller workspace</p>
            <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Sales & Orders</h1>
            <p className="mt-2 text-sm text-white/75">Manage fulfillment, track your sales, and build buyer trust.</p>
          </div>
          <Link to="/sell" className="inline-flex w-full items-center justify-center rounded-full bg-marigold px-5 py-3 font-mono text-xs font-semibold text-ink transition hover:bg-marigold-soft sm:w-auto">
            + List a new item
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-3 divide-x divide-white/20 border-t border-white/20 pt-4">
          <div className="pr-3 sm:pr-6">
            <p className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.1em] text-white/65 sm:text-[10px] sm:tracking-[0.18em]">All orders</p>
            <p className="mt-1 font-display text-2xl font-bold sm:text-3xl">{summary.total}</p>
          </div>
          <div className="px-3 sm:px-6">
            <p className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.1em] text-white/65 sm:text-[10px] sm:tracking-[0.18em]">Needs action</p>
            <p className="mt-1 font-display text-2xl font-bold text-marigold-soft sm:text-3xl">{summary.active}</p>
          </div>
          <div className="pl-3 sm:pl-6">
            <p className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.1em] text-white/65 sm:text-[10px] sm:tracking-[0.18em]">Completed</p>
            <p className="mt-1 font-display text-2xl font-bold sm:text-3xl">{summary.past}</p>
          </div>
        </div>
      </div>

      <div className="mt-7 flex gap-2 border-b border-hairline">
        <button
          onClick={() => setActiveTab('orders')}
          className={`border-b-2 px-4 py-3 font-mono text-xs font-semibold transition ${
            activeTab === 'orders'
              ? 'border-seal text-seal'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('myreviews')}
          className={`border-b-2 px-4 py-3 font-mono text-xs font-semibold transition ${
            activeTab === 'myreviews'
              ? 'border-seal text-seal'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Reviews you wrote ({myReviews.length})
        </button>
      </div>

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <>
          {ordersError && (
            <div className="mt-6 rounded-2xl border border-marigold bg-marigold/10 p-4">
              <p className="font-mono text-xs font-semibold text-marigold-deep">Error loading orders</p>
              <p className="mt-1 text-sm text-marigold-deep">{ordersError}</p>
            </div>
          )}
          <div className="mt-6 grid grid-cols-3 gap-2" aria-label="Filter seller orders">
            {[
              { id: 'all', label: 'All orders', count: summary.total },
              { id: 'active', label: 'Needs action', count: summary.active },
              { id: 'completed', label: 'Completed', count: orders.filter((order) => ['confirmed', 'completed', 'complete'].includes(order.status)).length },
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setOrderFilter(filter.id)}
                aria-pressed={orderFilter === filter.id}
                className={`w-full whitespace-nowrap rounded-full border px-2 py-2 text-center font-mono text-[9px] font-semibold transition sm:px-4 sm:text-[10px] ${orderFilter === filter.id ? 'border-seal bg-seal text-white' : 'border-hairline bg-white text-muted hover:border-seal/40 hover:text-seal'}`}
              >
                {filter.label} <span className="ml-1 opacity-75">{filter.count}</span>
              </button>
            ))}
          </div>

          {loadingOrders && <p className="mt-10 text-muted">Loading orders…</p>}

          {!loadingOrders && orders.length === 0 && (
            <div className="mt-10 rounded-2xl border border-hairline bg-white p-8 text-center">
              <p className="text-muted">You do not have any orders yet.</p>
              <Link to="/sell" className="mt-4 inline-flex rounded-full bg-seal px-6 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
                List an item
              </Link>
            </div>
          )}

          {!loadingOrders && orders.length > 0 && visibleOrders.length === 0 && (
            <p className="mt-8 rounded-2xl border border-dashed border-hairline p-6 text-center text-sm text-muted">There are no {orderFilter === 'active' ? 'orders needing action' : 'completed orders'} yet.</p>
          )}

          <div className="mt-5 divide-y divide-hairline">
        {visibleOrders.map((order) => {
          const isActive = ['paid', 'fulfilled'].includes(order.status)
          const isCompleted = ['confirmed', 'completed', 'complete'].includes(order.status)
          const statusMap = {
            paid: 'Payment received',
            fulfilled: 'Delivered',
            confirmed: 'Completed',
            disputed: 'Disputed',
          }

          return (
            <article key={order.id} className="py-5 first:pt-2">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Order · {new Date(order.created_at).toLocaleDateString()}</p>
                  <p className="mt-1 font-display text-base font-bold text-ink">{order.offer?.item_title || 'Order'}</p>
                  <p className="mt-1 text-xs text-muted">
                    Buyer: <span className="font-semibold text-ink">{order.buyer?.full_name || order.buyer?.business_name || 'Buyer'}</span>
                    {order.buyer?.handle && <span className="ml-1 font-mono">@{order.buyer.handle}</span>}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold ${order.status === 'paid' ? 'bg-marigold/20 text-marigold-deep' : order.status === 'fulfilled' ? 'bg-seal/10 text-seal' : order.status === 'disputed' ? 'bg-red-50 text-red-700' : 'bg-surfacealt text-muted'}`}>
                    {statusMap[order.status] || order.status}
                  </span>
                  <Link 
                    to={`/orders/${order.id}`} 
                    className="rounded-full border border-seal/30 px-4 py-2 font-mono text-[10px] font-semibold text-seal transition hover:bg-seal hover:text-white"
                  >
                    Details
                  </Link>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-hairline pt-3">
                <p className="text-xs text-muted">Your earnings <strong className="ml-1 font-display text-sm text-seal">₦{Number(order.seller_payout ?? order.amount ?? 0).toLocaleString()}</strong></p>
                <p className="text-xs text-muted">Delivery <strong className="ml-1 font-display text-sm text-ink">₦{Number(order.delivery_fee || 0).toLocaleString()}</strong></p>
                {buyerRatings[order.buyer?.id]?.reviewCount > 0 && (
                  <Link to={`/buyer/${order.buyer?.id || order.buyer?.handle}`} className="font-mono text-[10px] font-semibold text-seal hover:underline">
                    Buyer ★ {buyerRatings[order.buyer.id].avgRating} ({buyerRatings[order.buyer.id].reviewCount})
                  </Link>
                )}
              </div>

              {order.delivery_address && (
                <p className="mt-3 line-clamp-2 text-xs text-muted"><span className="font-semibold text-ink">Delivery address:</span> {order.delivery_address}</p>
              )}

              {isCompleted && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!reviewsSubmitted[order.id] && (
                    <button
                      onClick={() => {
                        setSelectedOrder(order)
                        setReviewOpen(true)
                      }}
                      className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-mono text-xs font-semibold text-white hover:bg-inksoft transition"
                    >
                      ⭐ Rate buyer
                    </button>
                  )}

                  {reviewsSubmitted[order.id] && (
                    <span className="flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 font-mono text-xs font-semibold text-green-900">
                      ✓ You reviewed this buyer
                    </span>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
        </>
      )}

      {/* My Reviews Tab */}
      {activeTab === 'myreviews' && (
        <>
          {reviewsError && (
            <div className="mt-6 rounded-2xl border border-marigold bg-marigold/10 p-4">
              <p className="font-mono text-xs font-semibold text-marigold-deep">Error loading reviews</p>
              <p className="mt-1 text-sm text-marigold-deep">{reviewsError}</p>
            </div>
          )}
          <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-muted mb-6">
            {myReviews.length === 0 ? 'No reviews yet' : `${myReviews.length} review${myReviews.length === 1 ? '' : 's'} submitted`}
          </p>

          {loadingReviews && <p className="text-muted">Loading reviews…</p>}

          {!loadingReviews && myReviews.length === 0 && (
            <div className="mt-10 rounded-2xl border border-hairline bg-white p-8 text-center">
              <p className="text-muted">You haven't submitted any reviews yet.</p>
              <Link to="/orders" className="mt-4 inline-flex rounded-full bg-seal px-6 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
                Back to orders
              </Link>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {myReviews.map((review) => (
              <article key={review.id} className="group rounded-2xl border border-hairline bg-white p-5 sm:p-6 shadow-xs hover:shadow-sm hover:border-seal/50 transition-all duration-200">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <Link to={`/buyer/${review.reviewee?.handle || review.reviewee?.id}`} className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-seal/20 to-seal/10 border border-seal/20 font-display text-sm font-bold text-seal transition group-hover:from-seal/30 group-hover:to-seal/20">
                      {review.reviewee?.avatar_url ? (
                        <img src={review.reviewee.avatar_url} alt={review.reviewee?.full_name || 'Buyer'} className="h-full w-full object-cover" />
                      ) : (
                        (review.reviewee?.business_name || review.reviewee?.full_name || '?').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm sm:text-base font-bold text-ink group-hover:text-seal transition">
                        {review.reviewee?.business_name || review.reviewee?.full_name || 'A buyer'}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                        @{review.reviewee?.handle}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
        </>
      )}

      {reviewOpen && selectedOrder && (
        <LeaveSellerReview 
          order={selectedOrder} 
          onClose={() => {
            setReviewOpen(false)
            setSelectedOrder(null)
          }}
          onReviewSubmitted={() => {
            setReviewsSubmitted(prev => ({
              ...prev,
              [selectedOrder.id]: true
            }))
            setReviewOpen(false)
            setSelectedOrder(null)
          }}
        />
      )}
    </section>
  )
}

export function BuyerDashboard() {
  const { session, profile, loading } = useProfile()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('orders')
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [ordersError, setOrdersError] = useState(null)
  const [myReviews, setMyReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [reviewsError, setReviewsError] = useState(null)
  const [reviewsSubmitted, setReviewsSubmitted] = useState({})
  const [sellerRatings, setSellerRatings] = useState({})
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [recentlyViewed, setRecentlyViewed] = useState([])
  const [clearingRecent, setClearingRecent] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/orders' } })
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session?.user?.id) return

    async function loadOrders() {
      setLoadingOrders(true)
      setOrdersError(null)
      const { data, error } = await supabase
        .from('orders')
        .select('*, offer:offer_id(item_title, item_description, price, delivery_fee), seller:seller_id(id, business_name, handle, verified_seller), buyer:buyer_id(id, full_name, business_name, handle)')
        .eq('buyer_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Buyer orders query failed:', error)
        setOrdersError(error.message || 'Failed to load orders. Please try again.')
        setOrders([])
      } else {
        setOrders(data || [])
        setOrdersError(null)
        
        // Fetch seller ratings for all unique sellers using both legacy and current review fields
        if (data && data.length > 0) {
          const uniqueSellerIds = [...new Set(data.map(order => order.seller?.id).filter(Boolean))]
          const sellerRatingsMap = {}

          for (const sellerId of uniqueSellerIds) {
            const [{ data: sellerReviews }, { data: revieweeReviews }] = await Promise.all([
              supabase
                .from('reviews')
                .select('rating')
                .eq('seller_id', sellerId)
                .eq('review_type', 'buyer_to_seller'),
              supabase
                .from('reviews')
                .select('rating')
                .eq('reviewee_id', sellerId)
                .eq('review_type', 'buyer_to_seller')
            ])

            const reviews = [...(sellerReviews || []), ...(revieweeReviews || [])]
            if (reviews.length > 0) {
              const avgRating = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
              sellerRatingsMap[sellerId] = {
                avgRating: parseFloat(avgRating.toFixed(1)),
                reviewCount: reviews.length
              }
            } else {
              sellerRatingsMap[sellerId] = { avgRating: 0, reviewCount: 0 }
            }
          }

          setSellerRatings(sellerRatingsMap)
        }
      }

      setLoadingOrders(false)
    }

    loadOrders()

    const channel = supabase
      .channel(`buyer-orders-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `buyer_id=eq.${session.user.id}` }, loadOrders)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id) return
    loadRecentlyViewed(session.user.id, 10).then(setRecentlyViewed)
  }, [session?.user?.id])

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

  // Load reviews submitted by this buyer
  useEffect(() => {
    if (!session?.user?.id || activeTab !== 'myreviews') return

    async function loadMyReviews() {
      setLoadingReviews(true)
      setReviewsError(null)
      const { data, error } = await supabase
        .from('reviews')
        .select('*, order:order_id(id, seller_id), reviewee:reviewee_id(id, business_name, handle, avatar_url, verified_seller)')
        .eq('reviewer_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to load buyer reviews:', error)
        setReviewsError(error.message || 'Failed to load reviews.')
        setMyReviews([])
      } else {
        const filtered = (data || []).filter((review) => review.review_type === 'buyer_to_seller' || review.review_type === null || review.review_type === undefined)
        setMyReviews(filtered)
        setReviewsError(null)
      }
      setLoadingReviews(false)
    }

    loadMyReviews()
  }, [session?.user?.id, activeTab])

  const summary = useMemo(() => {
    const active = orders.filter((order) => ['paid', 'fulfilled'].includes(order.status))
    const past = orders.filter((order) => ['confirmed', 'completed', 'complete', 'disputed'].includes(order.status))
    return {
      total: orders.length,
      active: active.length,
      past: past.length,
      revenue: orders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
    }
  }, [orders])

  const ReviewStars = ({ value }) => (
    <span className="font-mono text-xs text-marigold-deep">
      {Array.from({ length: 5 }).map((_, idx) => (
        <span key={idx}>{idx < Number(value || 0) ? '★' : '☆'}</span>
      ))}
    </span>
  )

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-16">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex-1">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Buyer dashboard</p>
          <h1 className="mt-3 font-display text-2xl sm:text-3xl font-bold text-ink">My orders</h1>
          <p className="mt-2 text-sm text-muted">Track your active and past purchases</p>
        </div>
        <Link to="/browse" className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition text-center sm:text-right">
          Continue shopping
        </Link>
      </div>

      {/* Tab Navigation */}
      <div className="mt-8 flex gap-2 border-b border-hairline">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-3 font-mono text-xs font-semibold transition border-b-2 ${
            activeTab === 'orders'
              ? 'border-seal text-seal'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('myreviews')}
          className={`px-4 py-3 font-mono text-xs font-semibold transition border-b-2 ${
            activeTab === 'myreviews'
              ? 'border-seal text-seal'
              : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          My Reviews ({myReviews.length})
        </button>
      </div>

      {recentlyViewed.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink">Recently viewed</h2>
            <button type="button" onClick={clearRecent} disabled={clearingRecent} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted hover:text-seal disabled:opacity-50">
              <Trash2 size={13} aria-hidden="true" />{clearingRecent ? 'Clearing…' : 'Clear history'}
            </button>
          </div>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {recentlyViewed.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.slug}`} className="min-w-[190px] rounded-2xl border border-hairline bg-white p-3 transition hover:border-seal">
                <div className="aspect-square rounded-xl bg-surfacealt bg-cover bg-center" style={listing.images?.[0] ? { backgroundImage: `url(${listing.images[0]})` } : undefined} />
                <p className="mt-2 truncate font-display text-sm text-ink">{listing.title}</p>
                <p className="mt-1 font-mono text-xs text-muted">₦{Number(listing.price).toLocaleString()}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <>
          {ordersError && (
            <div className="mt-6 rounded-2xl border border-marigold bg-marigold/10 p-4">
              <p className="font-mono text-xs font-semibold text-marigold-deep">Error loading orders</p>
              <p className="mt-1 text-sm text-marigold-deep">{ordersError}</p>
            </div>
          )}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Total orders</p>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Active orders</p>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{summary.active}</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Past orders</p>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{summary.past}</p>
        </div>
      </div>

      {loadingOrders && <p className="mt-10 text-muted">Loading orders…</p>}

      {!loadingOrders && orders.length === 0 && (
        <div className="mt-10 rounded-2xl border border-hairline bg-white p-8 text-center">
          <p className="text-muted">You do not have any orders yet.</p>
          <Link to="/browse" className="mt-4 inline-flex rounded-full bg-seal px-6 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
            Browse listings
          </Link>
        </div>
      )}

      <div className="mt-8 space-y-4">
        {orders.map((order) => {
          const isActive = ['paid', 'fulfilled'].includes(order.status)
          const statusMap = {
            paid: 'Payment confirmed',
            fulfilled: 'Delivery sent',
            confirmed: 'Completed',
            disputed: 'Disputed',
          }

          return (
            <article key={order.id} className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface hover:shadow-md transition p-4 sm:p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-display text-base font-bold text-ink truncate">{order.offer?.item_title || 'Order'}</p>
                  <p className="mt-1 font-body text-xs text-muted line-clamp-2">
                    Status: <strong>{statusMap[order.status] || order.status}</strong> · {new Date(order.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Seller Profile Card - For Buyer View */}
                <Link to={`/seller/${order.seller?.id || order.seller?.handle}`} className="flex items-center gap-3 rounded-xl border border-hairline bg-white p-3 hover:border-seal hover:shadow-sm transition lg:flex-shrink-0 w-full sm:w-auto sm:min-w-[240px]">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-seal/10 border border-seal/20 font-display text-xs font-bold text-seal">
                    {order.seller?.business_name?.[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-xs sm:text-sm font-bold text-ink truncate">{order.seller?.business_name || 'Seller'}</p>
                    <p className="font-mono text-[10px] text-muted truncate">@{order.seller?.handle || 'seller'}</p>
                    {sellerRatings[order.seller?.id] && sellerRatings[order.seller?.id].reviewCount > 0 && (
                      <p className="font-mono text-[10px] text-seal font-semibold truncate">
                        ★ {sellerRatings[order.seller?.id].avgRating} ({sellerRatings[order.seller?.id].reviewCount})
                      </p>
                    )}
                    {order.seller?.verified_seller && (
                      <p className="font-mono text-[10px] text-seal font-semibold">✓ Verified</p>
                    )}
                  </div>
                </Link>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold transition whitespace-nowrap ${
                    isActive 
                      ? 'bg-amber-100 text-amber-900' 
                      : 'bg-green-100 text-green-900'
                  }`}>
                    {order.status}
                  </span>
                  <Link 
                    to={`/orders/${order.id}`} 
                    className="rounded-full border border-seal bg-seal/5 px-4 py-2 font-mono text-[10px] font-semibold text-seal hover:bg-seal hover:text-white transition whitespace-nowrap"
                  >
                    View
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-seal/5 p-3 border border-seal/10">
                  <p className="text-[9px] uppercase tracking-widest text-muted font-semibold">Total</p>
                  <p className="mt-1.5 font-display text-sm sm:text-base font-bold text-seal truncate">₦{Number(order.amount || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-3 border border-blue-200">
                  <p className="text-[9px] uppercase tracking-widest text-blue-700 font-semibold">Delivery</p>
                  <p className="mt-1.5 font-display text-sm sm:text-base font-bold text-blue-900 truncate">₦{Number(order.delivery_fee || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
                  <p className="text-[9px] uppercase tracking-widest text-gray-700 font-semibold">Fee</p>
                  <p className="mt-1.5 font-display text-sm sm:text-base font-bold text-gray-900 truncate">₦{Number(order.buyer_fee || 100).toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-surfacealt p-3 border border-hairline">
                  <p className="text-[9px] uppercase tracking-widest text-muted font-semibold">Status</p>
                  <p className="mt-1.5 font-display text-xs sm:text-sm font-bold text-ink truncate">{statusMap[order.status] || order.status}</p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
        </>
      )}

      {/* My Reviews Tab */}
      {activeTab === 'myreviews' && (
        <>
          {reviewsError && (
            <div className="mt-6 rounded-2xl border border-marigold bg-marigold/10 p-4">
              <p className="font-mono text-xs font-semibold text-marigold-deep">Error loading reviews</p>
              <p className="mt-1 text-sm text-marigold-deep">{reviewsError}</p>
            </div>
          )}
          <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-muted mb-6">
            {myReviews.length === 0 ? 'No reviews yet' : `${myReviews.length} review${myReviews.length === 1 ? '' : 's'} submitted`}
          </p>

          {loadingReviews && <p className="text-muted">Loading reviews…</p>}

          {!loadingReviews && myReviews.length === 0 && (
            <div className="mt-10 rounded-2xl border border-hairline bg-white p-8 text-center">
              <p className="text-muted">You haven't submitted any reviews yet.</p>
              <Link to="/orders" className="mt-4 inline-flex rounded-full bg-seal px-6 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
                Back to orders
              </Link>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {myReviews.map((review) => (
              <article key={review.id} className="group rounded-2xl border border-hairline bg-white p-5 sm:p-6 shadow-xs hover:shadow-sm hover:border-seal/50 transition-all duration-200">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <Link to={`/seller/${review.reviewee?.handle || review.reviewee?.id}`} className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-seal/20 to-seal/10 border border-seal/20 font-display text-sm font-bold text-seal transition group-hover:from-seal/30 group-hover:to-seal/20">
                      {review.reviewee?.avatar_url ? (
                        <img src={review.reviewee.avatar_url} alt={review.reviewee?.business_name || 'Seller'} className="h-full w-full object-cover" />
                      ) : (
                        (review.reviewee?.business_name || '?').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm sm:text-base font-bold text-ink group-hover:text-seal transition">
                        {review.reviewee?.business_name || 'A seller'}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                        @{review.reviewee?.handle}
                      </p>
                      {review.reviewee?.verified_seller && (
                        <p className="mt-1 font-mono text-[10px] text-seal font-semibold">✓ Verified seller</p>
                      )}
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
        </>
      )}
    </section>
  )
}

function LeaveSellerReview({ order, onClose, onReviewSubmitted }) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submitReview(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session?.user?.id || !order?.id) {
        throw new Error('A session is required to write a review.')
      }

      const reviewPayload = {
        order_id: order.id,
        reviewer_id: session.user.id,
        seller_id: order.seller_id,
        reviewee_id: order.buyer_id,
        review_type: 'seller_to_buyer',
        rating: Number(rating),
        comment: comment.trim(),
      }

      // For sellers: just insert the review (order is already confirmed)
      const { error: reviewError } = await supabase.from('reviews').insert(reviewPayload)
      if (reviewError) {
        if (reviewError.code === '23505') {
          throw new Error('You have already reviewed this buyer.')
        }
        throw reviewError
      }

      setSuccess('Thank you for your review!')
      setTimeout(() => {
        onReviewSubmitted()
      }, 1500)
    } catch (err) {
      console.error('Failed to publish review:', err)
      setError(err.message || 'Unable to save your review right now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-hairline p-4 sm:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-hairline">
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Review</p>
            <h3 className="font-display text-lg sm:text-xl font-bold text-ink">
              Rate your buyer: <strong>{order.buyer?.full_name || order.buyer?.business_name}</strong>
            </h3>
          </div>
          <button onClick={onClose} className="font-mono text-xs text-muted hover:text-ink transition text-right">Close</button>
        </div>

        <form onSubmit={submitReview} className="mt-4 space-y-4">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Buyer rating</span>
            <select value={rating} onChange={(e) => setRating(e.target.value)} className="mt-1 w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink focus:border-seal outline-none">
              <option value="5">5 — Excellent</option>
              <option value="4">4 — Good</option>
              <option value="3">3 — Fair</option>
              <option value="2">2 — Poor</option>
              <option value="1">1 — Bad</option>
            </select>
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Feedback</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} minLength="8" placeholder="Share your experience with this buyer" className="mt-1 min-h-[110px] w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none" />
          </label>

          {error && <p className="rounded-xl border border-marigold bg-marigold/10 px-3 py-2 text-xs font-semibold text-marigold-deep">{error}</p>}
          {success && <p className="rounded-xl border border-seal/30 bg-seal/10 px-3 py-2 text-xs font-semibold text-seal">{success}</p>}

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-hairline">
            <button type="submit" disabled={submitting} className="rounded-full bg-ink px-5 py-2.5 font-body text-sm font-semibold text-surface hover:bg-inksoft disabled:opacity-50 transition">
              {submitting ? 'Sending…' : 'Submit review'}
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-hairline px-5 py-2.5 font-body text-sm text-ink hover:border-marigold-deep transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Orders

function Orders() {
  return <OrderManagement />
}

export function OrderDetails() {
  const { orderId } = useParams()
  const { session, loading: sessionLoading } = useProfile()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sellerDelivering, setSellerDelivering] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [existingReview, setExistingReview] = useState(null)
  const [checkingReview, setCheckingReview] = useState(false)
  const [buyerRating, setBuyerRating] = useState({ avgRating: 0, reviewCount: 0 })
  const [sellerRating, setSellerRating] = useState({ avgRating: 0, reviewCount: 0 })
  const [showDisputeModal, setShowDisputeModal] = useState(false)
  const [showDisputeGatekeeper, setShowDisputeGatekeeper] = useState(true)
  const [disputeReason, setDisputeReason] = useState('')
  const [submittingDispute, setSubmittingDispute] = useState(false)
  const [disputeError, setDisputeError] = useState('')
  const [servicePackage, setServicePackage] = useState(null)
  const [serviceExtras, setServiceExtras] = useState([])

  useEffect(() => {
    if (!sessionLoading && !session) {
      navigate('/auth', { state: { redirectTo: `/orders/${orderId || ''}` } })
      return
    }
  }, [session, sessionLoading, navigate, orderId])

  useEffect(() => {
    if (!session?.user?.id || !orderId) return

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('orders')
        .select('*, offer:offer_id(item_title, item_description, price, delivery_fee, conversation_id), seller:seller_id(id, business_name, handle, verified_seller), buyer:buyer_id(id, full_name, business_name, handle)')
        .eq('id', orderId)
        .single()

      if (error) {
        console.error('Order detail query failed:', error)
        setOrder(null)
      } else if (data?.buyer_id === session.user.id || data?.seller_id === session.user.id) {
        setOrder(data)

        if (data.package_id) {
          const [{ data: packageRow }, { data: extraRows }] = await Promise.all([
            supabase.from('service_packages').select('name, tier, price, delivery_days, revisions').eq('id', data.package_id).maybeSingle(),
            data.selected_extra_ids?.length
              ? supabase.from('gig_extras').select('name, price, additional_days').in('id', data.selected_extra_ids)
              : Promise.resolve({ data: [] }),
          ])
          setServicePackage(packageRow || null)
          setServiceExtras(extraRows || [])
        } else {
          setServicePackage(null)
          setServiceExtras([])
        }
        
        // Fetch buyer rating if seller is viewing
        if (data?.seller_id === session.user.id && data?.buyer_id) {
          const [{ data: revieweeReviews }] = await Promise.all([
            supabase
              .from('reviews')
              .select('rating')
              .eq('reviewee_id', data.buyer_id)
              .eq('review_type', 'seller_to_buyer'),
          ])

          const reviews = revieweeReviews || []
          if (reviews.length > 0) {
            const avgRating = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
            setBuyerRating({
              avgRating: parseFloat(avgRating.toFixed(1)),
              reviewCount: reviews.length
            })
          }
        }

        // Fetch seller rating if buyer is viewing
        if (data?.buyer_id === session.user.id && data?.seller_id) {
          const [{ data: sellerReviews }, { data: revieweeReviews }] = await Promise.all([
            supabase
              .from('reviews')
              .select('rating')
              .eq('seller_id', data.seller_id)
              .eq('review_type', 'buyer_to_seller'),
            supabase
              .from('reviews')
              .select('rating')
              .eq('reviewee_id', data.seller_id)
              .eq('review_type', 'buyer_to_seller')
          ])

          const reviews = [...(sellerReviews || []), ...(revieweeReviews || [])]
          if (reviews.length > 0) {
            const avgRating = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
            setSellerRating({
              avgRating: parseFloat(avgRating.toFixed(1)),
              reviewCount: reviews.length
            })
          }
        }
      } else {
        setOrder(null)
      }

      setLoading(false)
    }

    load()
  }, [orderId, session?.user?.id])

  // Check if user has already reviewed this order
  useEffect(() => {
    if (!order?.id || !session?.user?.id) return

    async function checkExistingReview() {
      setCheckingReview(true)
      const reviewType = order.buyer_id === session.user.id ? 'buyer_to_seller' : 'seller_to_buyer'
      const { data, error } = await supabase
        .from('reviews')
        .select('id, review_type')
        .eq('order_id', order.id)
        .eq('reviewer_id', session.user.id)
        .eq('review_type', reviewType)
        .maybeSingle()

      if (data && !error) {
        setExistingReview(data)
      } else {
        setExistingReview(null)
      }
      setCheckingReview(false)
    }

    checkExistingReview()
  }, [order?.id, session?.user?.id])

  const viewerIsBuyer = order?.buyer_id === session?.user?.id
  const viewerIsSeller = order?.seller_id === session?.user?.id
  const orderComplete = ['confirmed', 'completed', 'complete'].includes(order?.status)
  const disputeWindowOpen = !!order?.dispute_deadline_at && new Date(order.dispute_deadline_at).getTime() > Date.now()

  const [deadlineText, setDeadlineText] = useState('')

  useEffect(() => {
    if (!order?.dispute_deadline_at) {
      setDeadlineText('')
      return
    }

    function updateCountdown() {
      const deadline = new Date(order.dispute_deadline_at).getTime()
      const diff = deadline - Date.now()
      if (diff <= 0) {
        setDeadlineText('The 24-hour dispute window for this order has closed.')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const days = Math.floor(hours / 24)
      const remainingHours = hours % 24
      setDeadlineText(
        days > 0
          ? `You have ${days}d ${remainingHours}h ${minutes}m left to inspect and raise a dispute.`
          : `You have ${hours}h ${minutes}m left to inspect and raise a dispute.`
      )
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 60000)
    return () => window.clearInterval(timer)
  }, [order?.dispute_deadline_at])

  async function markAsDelivered() {
    if (!order?.id) return

    setSellerDelivering(true)
    try {
      const { data, error } = await supabase.rpc('mark_order_fulfilled', { p_order_id: order.id })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to mark as delivered.')

      setOrder((current) => ({
        ...current,
        status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
      }))
    } catch (err) {
      console.error('Failed to mark as delivered:', err)
      alert(err.message || 'Failed to mark as delivered. Please try again.')
    } finally {
      setSellerDelivering(false)
    }
  }

  if (sessionLoading) return <div className="px-6 py-24 text-center text-muted">Checking your session…</div>
  if (!session) return <div className="px-6 py-24 text-center text-muted">Redirecting to sign in…</div>

  if (loading) return <div className="px-6 py-24 text-center text-muted">Loading order…</div>
  if (!order) return <div className="px-6 py-24 text-center text-muted">Order not found.</div>

  return (
    <section className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-16">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Order details</p>
          <h1 className="mt-3 font-display text-2xl sm:text-3xl font-bold text-ink">{order.offer?.item_title}</h1>
        </div>
        <Link to="/orders" className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal transition text-center sm:text-right">
          Back to orders
        </Link>
      </div>

      <article className="rounded-2xl border border-hairline bg-gradient-to-br from-white via-white to-surface p-4 sm:p-6 shadow-sm">
        <div className="grid gap-4 sm:gap-6 sm:grid-cols-2">
          <div className="rounded-xl bg-seal/5 p-4 border border-seal/20">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal font-semibold">Seller</p>
            <p className="mt-2 font-display text-lg font-bold text-ink">{order.seller?.business_name}</p>
            <p className="mt-1 text-xs text-muted">@{order.seller?.handle}</p>
            {order.seller?.verified_seller && (
              <p className="mt-1 text-xs text-seal font-semibold">✓ Verified seller</p>
            )}
            {viewerIsBuyer && sellerRating.reviewCount > 0 && (
              <p className="mt-1 text-xs font-semibold text-seal">★ {sellerRating.avgRating} ({sellerRating.reviewCount} reviews)</p>
            )}
          </div>
          <div className="rounded-xl bg-blue-50 p-4 border border-blue-200">
            <p className="font-mono text-[10px] uppercase tracking-widest text-blue-700 font-semibold">Order Status</p>
            <p className="mt-2 font-display text-lg font-bold text-blue-900">
              {['confirmed', 'completed', 'complete'].includes(order.status) && '✓ Completed'}
              {order.status === 'fulfilled' && '📦 Delivered — Awaiting confirmation'}
              {order.status === 'paid' && '💳 Payment secured'}
              {order.status === 'disputed' && '⚠️ Disputed'}
              {!['confirmed', 'completed', 'complete', 'fulfilled', 'paid', 'disputed'].includes(order.status) && order.status}
            </p>
          </div>

          {/* Buyer Profile Section - For Seller View */}
          {viewerIsSeller && (
            <div className="rounded-xl bg-purple-50 p-4 border border-purple-200">
              <p className="font-mono text-[10px] uppercase tracking-widest text-purple-700 font-semibold">Buyer</p>
              <p className="mt-2 font-display text-lg font-bold text-purple-900">{order.buyer?.full_name || order.buyer?.business_name}</p>
              <p className="mt-1 text-xs text-purple-700">@{order.buyer?.handle}</p>
              {buyerRating.reviewCount > 0 && (
                <p className="mt-1 text-xs font-semibold text-purple-700">★ {buyerRating.avgRating} ({buyerRating.reviewCount} reviews)</p>
              )}
              {buyerRating.reviewCount === 0 && (
                <p className="mt-1 text-xs text-purple-600">No reviews yet</p>
              )}
              <Link to={`/buyer/${order.buyer?.handle || order.buyer?.id}`} className="mt-3 inline-flex text-xs font-semibold text-purple-700 hover:text-purple-900 transition">
                View profile →
              </Link>
            </div>
          )}

          <div className="rounded-xl bg-green-50 p-4 border border-green-200 sm:col-span-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-green-700 font-semibold">Order Total</p>
            <p className="mt-2 font-display text-xl sm:text-2xl font-bold text-green-900">₦{Number(order.amount + order.delivery_fee + (order.buyer_fee || 100)).toLocaleString()}</p>
          </div>
          <div className="rounded-xl bg-surfacealt p-4 border border-hairline">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Placed</p>
            <p className="mt-2 font-body text-xs sm:text-sm font-semibold text-ink">{new Date(order.created_at).toLocaleString()}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-hairline bg-white p-4 shadow-xs">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Item Price</p>
            <p className="mt-2 font-display text-lg sm:text-xl font-bold text-ink">₦{Number(order.amount).toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-white p-4 shadow-xs">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Delivery Fee</p>
            <p className="mt-2 font-display text-lg sm:text-xl font-bold text-ink">₦{Number(order.delivery_fee || 0).toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-hairline bg-white p-4 shadow-xs">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Platform Fee</p>
            <p className="mt-2 font-display text-lg sm:text-xl font-bold text-ink">₦{Number(order.buyer_fee || 100).toLocaleString()}</p>
          </div>
        </div>

        {order.package_id && servicePackage && (
          <div className="mt-6 rounded-xl border border-seal/30 bg-seal/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal font-semibold">Service package</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted">Package</p><p className="mt-1 font-semibold text-ink">{servicePackage.name} <span className="font-normal text-muted">({servicePackage.tier})</span></p></div>
              <div><p className="text-xs text-muted">Delivery</p><p className="mt-1 font-semibold text-ink">{servicePackage.delivery_days} days</p></div>
              <div><p className="text-xs text-muted">Revisions</p><p className="mt-1 font-semibold text-ink">{servicePackage.revisions}</p></div>
            </div>
            {serviceExtras.length > 0 && <div className="mt-4 border-t border-seal/20 pt-3"><p className="text-xs text-muted">Selected extras</p><ul className="mt-2 space-y-1 text-sm text-ink">{serviceExtras.map((extra) => <li key={extra.name}>+ {extra.name} · ₦{Number(extra.price).toLocaleString()}{extra.additional_days ? ` · +${extra.additional_days} days` : ''}</li>)}</ul></div>}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-seal/30 bg-gradient-to-r from-seal/5 to-seal/10 p-4">
          <div className="flex items-start gap-3">
            <span className="text-lg sm:text-xl flex-shrink-0">📍</span>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-seal font-semibold">Delivery Address</p>
              <p className="mt-2 font-body text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">
                {order.delivery_address || 'No delivery address captured yet'}
              </p>
            </div>
          </div>
        </div>

        {(order.delivery_speed || order.delivery_deadline) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {order.delivery_speed && (
              <div className="rounded-xl border border-hairline bg-white p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Delivery Speed</p>
                <p className="mt-2 font-body text-sm font-semibold text-ink">{order.delivery_speed === 'fast' ? '⚡ Fast' : 'Standard'}</p>
              </div>
            )}
            {order.delivery_deadline && (
              <div className="rounded-xl border border-hairline bg-white p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Delivery Deadline</p>
                <p className="mt-2 font-body text-xs sm:text-sm font-semibold text-ink">{new Date(order.delivery_deadline).toLocaleString()}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-hairline bg-white p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted font-semibold">Delivery Progress</p>
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <span className={`h-3 w-3 rounded-full flex-shrink-0 transition ${['paid', 'fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) ? 'bg-seal' : 'bg-gray-300'}`} />
              <span className="text-xs font-medium text-muted">Payment secured</span>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className={`h-3 w-3 rounded-full flex-shrink-0 transition ${['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) ? 'bg-seal' : 'bg-gray-300'}`} />
              <span className="text-xs font-medium text-muted">Delivery sent</span>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className={`h-3 w-3 rounded-full flex-shrink-0 transition ${['confirmed', 'completed', 'complete'].includes(order.status) ? 'bg-seal' : 'bg-gray-300'}`} />
              <span className="text-xs font-medium text-muted">Completed</span>
            </div>
          </div>
        </div>

        {viewerIsBuyer && order?.fulfilled_at && (
          <div className="mt-6 rounded-2xl border border-seal/30 bg-seal/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Inspection window</p>
            <p className="mt-2 text-sm text-ink">{deadlineText || 'The dispute window is active.'}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={`/messages/${order.offer?.conversation_id || ''}`} className="rounded-full bg-ink px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-inksoft transition">
            Open conversation
          </Link>

          {viewerIsSeller && order.status === 'paid' && (
            <button disabled={sellerDelivering || order.fulfilled_at} onClick={markAsDelivered} className="rounded-full bg-amber-700 px-5 py-2 font-mono text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 transition">
              {sellerDelivering ? 'Updating...' : order.fulfilled_at ? 'Delivered — Awaiting buyer confirmation' : 'Mark as Delivered'}
            </button>
          )}

          {viewerIsBuyer && order.status === 'fulfilled' && (
            <div className="rounded-full border border-hairline bg-white px-4 py-2 text-xs text-muted">
              Confirming releases payment to the seller immediately. You can still file a dispute within your 24-hour window even after confirming.
            </div>
          )}

          {viewerIsBuyer && order.status === 'fulfilled' && (
            <button onClick={async () => {
              try {
                const { data, error } = await supabase.rpc('confirm_delivery_and_release_payment', { p_order_id: order.id })
                if (error) throw error
                if (!data?.success) throw new Error(data?.error || 'Unable to confirm delivery.')
                setOrder((current) => ({ ...current, status: 'confirmed', confirmed_at: new Date().toISOString() }))
                
                // Chain payout processing after release succeeds
                const { data: { session } } = await supabase.auth.getSession()
                const payoutRes = await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-process-payout`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({ order_id: order.id }),
                  }
                )
                const payoutData = await payoutRes.json()
                
                if (!payoutRes.ok) {
                  console.error('Payout processing error:', payoutData)
                  alert(`Warning: Payout processing encountered an issue. Admin will review. Details: ${payoutData.error || payoutData.message || 'Unknown error'}`)
                } else if (payoutData.otp_required) {
                  alert(`⚠️ Seller's payout requires verification on Paystack:\n\n${payoutData.message || 'The seller must verify this transfer in their Paystack dashboard within 24 hours.'}\n\nOur admin team has been notified.`)
                } else {
                  alert('✓ Delivery confirmed. Seller will receive payment within 24 hours.')
                }
              } catch (err) {
                alert(err.message || 'Unable to confirm delivery.')
              }
            }} className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
              Confirm Delivery
            </button>
          )}

          {viewerIsBuyer && disputeWindowOpen && (
            <button onClick={() => {
              setDisputeReason('')
              setDisputeError('')
              setShowDisputeGatekeeper(true)
              setShowDisputeModal(true)
            }} className="rounded-full border border-marigold bg-marigold/10 px-5 py-2 font-mono text-xs font-semibold text-marigold-deep hover:bg-marigold/20 transition">
              File a Dispute
            </button>
          )}

          {viewerIsBuyer && order?.dispute_deadline_at && !disputeWindowOpen && (
            <span className="rounded-full border border-hairline bg-surfacealt px-5 py-2 font-mono text-xs font-semibold text-muted">
              The 24-hour dispute window for this order has closed.
            </span>
          )}

          {viewerIsSeller && ['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) && !existingReview && !checkingReview && (
            <button onClick={() => setReviewOpen(true)} className="rounded-full bg-ink px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-inksoft transition">
              {order.status === 'fulfilled' ? 'Review after delivery' : 'Review this buyer'}
            </button>
          )}

          {viewerIsSeller && ['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) && existingReview && (
            <span className="rounded-full bg-green-100 px-5 py-2 font-mono text-xs font-semibold text-green-900">
              ✓ You reviewed this buyer
            </span>
          )}

          {viewerIsBuyer && ['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) && !existingReview && !checkingReview && (
            <button onClick={() => setReviewOpen(true)} className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep transition">
              {order.status === 'fulfilled' ? 'Confirm Receipt & Leave Review' : 'Leave review'}
            </button>
          )}

          {viewerIsBuyer && ['fulfilled', 'confirmed', 'completed', 'complete'].includes(order.status) && existingReview && (
            <span className="rounded-full bg-green-100 px-5 py-2 font-mono text-xs font-semibold text-green-900">
              ✓ Thank you for your review
            </span>
          )}
        </div>

        {orderComplete && (
          <div className="mt-6 rounded-2xl border border-seal/40 bg-seal/8 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Review unlock</p>
                <p className="mt-1 font-display text-lg font-bold text-ink">Order complete</p>
                <p className="mt-1 text-sm text-muted">Thanks for using Trustall.</p>
              </div>
            </div>
          </div>
        )}

        {showDisputeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4">
            <div className="w-full max-w-2xl rounded-3xl border border-hairline bg-white p-5 shadow-2xl">
              {showDisputeGatekeeper ? (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Before you continue</p>
                  <h3 className="mt-3 font-display text-2xl font-bold text-ink">To ensure a fast resolution, please follow these rules:</h3>
                  <ul className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-7 text-muted">
                    <li>Upload clear evidence. Unboxing videos are prioritized.</li>
                    <li>Keep it professional. Insults will result in account suspension.</li>
                    <li>The Trustall Admin's decision based on the evidence provided here is final.</li>
                  </ul>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <a href="/trust-safety" target="_blank" rel="noreferrer" className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal">Read full rules</a>
                    <button type="button" onClick={() => setShowDisputeGatekeeper(false)} className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep">I Understand</button>
                    <button type="button" onClick={() => setShowDisputeModal(false)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-muted hover:text-ink">Close</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-seal">File a dispute</p>
                      <h3 className="mt-2 font-display text-2xl font-bold text-ink">Tell us what went wrong</h3>
                    </div>
                    <button type="button" onClick={() => setShowDisputeModal(false)} className="font-mono text-xs text-muted hover:text-ink">Close</button>
                  </div>

                  <textarea
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                    rows={6}
                    placeholder="Describe the issue, what was missing, or what was incorrect about the delivery…"
                    className="mt-5 w-full rounded-2xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
                  />

                  {disputeError && <p className="mt-3 text-sm text-marigold-deep">{disputeError}</p>}

                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <button type="button" onClick={() => setShowDisputeModal(false)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-muted hover:text-ink">Cancel</button>
                    <button
                      type="button"
                      disabled={submittingDispute || !disputeReason.trim()}
                      onClick={async () => {
                        try {
                          setSubmittingDispute(true)
                          setDisputeError('')
                          const { data, error } = await supabase.from('disputes').insert({
                            order_id: order.id,
                            filed_by: session.user.id,
                            reason: disputeReason.trim(),
                          }).select().single()

                          if (error) throw error
                          setShowDisputeModal(false)
                          navigate(`/disputes/${data.id}`)
                        } catch (err) {
                          console.error('Failed to create dispute:', err)
                          setDisputeError(err.message || 'Unable to file the dispute right now.')
                        } finally {
                          setSubmittingDispute(false)
                        }
                      }}
                      className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep disabled:opacity-55"
                    >
                      {submittingDispute ? 'Submitting…' : 'Submit dispute'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {reviewOpen && <LeaveReview order={order} onClose={() => setReviewOpen(false)} buyerReviewMode={viewerIsBuyer} />}
      </article>
    </section>
  )
}

function LeaveReview({ order, onClose, buyerReviewMode = true }) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function processPayoutForOrder(orderId, { alertOnSuccess = true, alertOnWarning = true } = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('Your session expired before payout processing could start.')
    }

    const payoutRes = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-process-payout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      }
    )

    const payoutData = await payoutRes.json().catch(() => ({}))

    if (!payoutRes.ok) {
      console.error('Payout processing error:', payoutData)
      if (alertOnWarning) {
        alert(`Warning: Payout processing encountered an issue. Admin will review. Details: ${payoutData.error || payoutData.message || 'Unknown error'}`)
      }
      return { ok: false, payload: payoutData }
    }

    if (payoutData.otp_required) {
      if (alertOnWarning) {
        alert(`⚠️ Seller's payout requires verification on Paystack:\n\n${payoutData.message || 'The seller must verify this transfer in their Paystack dashboard within 24 hours.'}\n\nOur admin team has been notified.`)
      }
      return { ok: true, otp_required: true, payload: payoutData }
    }

    if (alertOnSuccess) {
      alert('✓ Delivery confirmed. Seller will receive payment within 24 hours.')
    }

    return { ok: true, payload: payoutData }
  }

  async function submitReview(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session?.user?.id || !order?.id) {
        throw new Error('A session is required to write a review.')
      }

      const reviewType = buyerReviewMode ? 'buyer_to_seller' : 'seller_to_buyer'
      const reviewPayload = {
        order_id: order.id,
        reviewer_id: session.user.id,
        seller_id: buyerReviewMode ? order.seller_id : session.user.id,
        reviewee_id: buyerReviewMode ? order.seller_id : order.buyer_id,
        review_type: reviewType,
        rating: Number(rating),
        comment: comment.trim(),
      }

      // For buyers: confirm delivery FIRST (which updates order status to 'confirmed'),
      // THEN insert review (RLS policy requires confirmed status)
      if (buyerReviewMode && order.status === 'fulfilled') {
        const { data, error: rpcError } = await supabase.rpc('confirm_delivery_and_release_payment', {
          p_order_id: order.id,
        })

        if (rpcError) {
          throw new Error(rpcError.message || 'The payment release RPC could not be completed.')
        }

        if (!data?.success) {
          const actualError = data?.error || 'The buyer confirmation RPC returned an error.'
          setError(actualError)
          setSuccess('')
          return
        }

        const payoutResult = await processPayoutForOrder(order.id)
        if (!payoutResult.ok) {
          setError('Delivery was confirmed, but payout processing did not complete. The admin team has been notified.')
          setSuccess('')
          return
        }

        // Now that order is confirmed, insert the review
        const { error: reviewError } = await supabase.from('reviews').insert(reviewPayload)
        if (reviewError) {
          if (reviewError.code === '23505') {
            throw new Error('You have already reviewed this order.')
          }
          throw reviewError
        }

        setSuccess('Delivery confirmed. Payment released to seller. Thank you for your review!')
        onClose()
        return
      }

      // For sellers or buyers on already-confirmed orders: just insert the review
      const { error: reviewError } = await supabase.from('reviews').insert(reviewPayload)
      if (reviewError) {
        if (reviewError.code === '23505') {
          throw new Error('You have already reviewed this order.')
        }
        throw reviewError
      }

      setSuccess('Thank you for your review!')
      onClose()
    } catch (err) {
      console.error('Failed to publish review:', err)
      setError(err.message || 'Unable to save your review right now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-hairline bg-white p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Review</p>
          <h3 className="font-display text-lg sm:text-xl font-bold text-ink">
            {buyerReviewMode ? 'Confirm receipt & leave feedback' : 'Review this buyer'}
          </h3>
        </div>
        <button onClick={onClose} className="font-mono text-xs text-muted hover:text-ink transition text-right">Close</button>
      </div>

      <form onSubmit={submitReview} className="mt-4 space-y-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {buyerReviewMode ? 'Seller rating' : 'Buyer rating'}
          </span>
          <select value={rating} onChange={(e) => setRating(e.target.value)} className="mt-1 w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink focus:border-seal outline-none">
            <option value="5">5 — Excellent</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Fair</option>
            <option value="2">2 — Poor</option>
            <option value="1">1 — Bad</option>
          </select>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Feedback</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} minLength="8" placeholder={buyerReviewMode ? 'Tell them how the order experience went' : 'Share how the buyer handled the order'} className="mt-1 min-h-[110px] w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none" />
        </label>

        {error && <p className="rounded-xl border border-marigold bg-marigold/10 px-3 py-2 text-xs font-semibold text-marigold-deep">{error}</p>}
        {success && <p className="rounded-xl border border-seal/30 bg-seal/10 px-3 py-2 text-xs font-semibold text-seal">{success}</p>}

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="submit" disabled={submitting} className="rounded-full bg-seal px-5 py-2.5 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50 transition">
            {submitting ? 'Sending…' : 'Submit review'}
          </button>
          <button type="button" onClick={onClose} className="rounded-full border border-hairline px-5 py-2.5 font-body text-sm text-ink hover:border-marigold-deep transition">
            Later
          </button>
        </div>
      </form>
    </div>
  )
}
