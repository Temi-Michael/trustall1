import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, BriefcaseBusiness, Check, ChevronRight, Dumbbell, Flower2, House, Laptop, ShieldCheck, Shirt, ShoppingBag, Smartphone, Sparkles, Users, Wrench } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { SealMark } from '../components/Navbar.jsx'
import Seo from '../components/Seo.jsx'
import { recordPromotionEvent } from '../lib/promotions.js'

const categories = [
  { label: 'Phones & Gadgets', icon: Smartphone },
  { label: 'Fashion & Style', icon: Shirt },
  { label: 'Home & Living', icon: House },
  { label: 'Beauty & Personal Care', icon: Flower2 },
  { label: 'Sports & Outdoors', icon: Dumbbell },
  { label: 'Digital Products', icon: Laptop },
  { label: 'Services', icon: Wrench },
  { label: 'Books', icon: BookOpen },
]

function imageUrl(value) {
  if (!value) return ''
  const image = Array.isArray(value) ? value[0] : typeof value === 'string' ? (() => {
    try { return JSON.parse(value)[0] || value } catch { return value }
  })() : ''
  if (!image) return ''
  return /^https?:\/\//i.test(image) ? image : supabase.storage.from('listing-images').getPublicUrl(image).data.publicUrl
}

function getTrustScore(listing) {
  const seller = listing.seller || {}
  const createdAt = new Date(listing.created_at).getTime()
  const ageDays = Number.isFinite(createdAt) ? Math.max(0, (Date.now() - createdAt) / 86400000) : 365
  const freshness = Math.max(0, 12 - ageDays / 3)
  const completedSales = Math.min(24, Math.log2(Number(seller.completed_sales_count || 0) + 1) * 5)
  return (seller.verified_seller ? 40 : 0)
    + Math.max(0, Number(seller.seller_level || 0)) * 8
    + Math.max(0, Number(seller.avg_rating || 0)) * 4
    + completedSales
    + (seller.pro_vendor ? 8 : 0)
    + freshness
}

function ListingTile({ listing, badge, promotion = listing.promotion }) {
  const image = imageUrl(listing.images)
  const price = listing.product_type === 'digital_service' ? listing.basicPrice ?? listing.price : listing.price
  const SellerTrustIcon = listing.seller?.verified_seller ? ShieldCheck : BriefcaseBusiness
  const listingBadge = Number(listing.seller?.completed_sales_count || 0) === 0 ? 'New seller' : badge
  useEffect(() => {
    if (promotion?.id) recordPromotionEvent(promotion.id, 'impression', { listing_id: listing.id })
  }, [promotion?.id, listing.id])
  return (
    <Link to={`/listing/${listing.slug}${promotion?.id ? `?promotion=${encodeURIComponent(promotion.id)}` : ''}`} onClick={() => promotion?.id && recordPromotionEvent(promotion.id, 'click', { listing_id: listing.id })} className="group block min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-emerald-700/40 hover:shadow-lg">
      <div className="relative aspect-[1.22] overflow-hidden bg-slate-100">
        {image ? <img src={image} alt={listing.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-slate-300"><BriefcaseBusiness size={34} /></div>}
        {(promotion?.id ? 'Promoted' : listingBadge) && <span className="absolute left-2 top-2 rounded bg-marigold-500 px-2 py-1 font-mono text-[9px] font-bold uppercase text-emerald-950">{promotion?.id ? 'Promoted' : listingBadge}</span>}
      </div>
      <div className="p-2.5">
        <p className="truncate text-[11px] font-semibold text-slate-800">{listing.title}</p>
        <p className="mt-1 truncate text-xs font-bold text-emerald-800">{listing.product_type === 'digital_service' ? 'From ' : ''}₦{Number(price || 0).toLocaleString()}</p>
        <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${listing.seller?.verified_seller ? 'font-semibold text-emerald-800' : 'text-slate-500'}`}><SellerTrustIcon size={11} className={listing.seller?.verified_seller ? 'text-emerald-700' : 'text-slate-400'} />{listing.seller?.verified_seller ? 'Verified seller' : listing.seller?.business_name || listing.category || 'Trustall seller'}</div>
      </div>
    </Link>
  )
}

function ProductSection({ title, subtitle, listings, badge, to = '/browse', icon: Icon }) {
  if (!listings.length) return null
  return (
    <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon size={21} className="mt-0.5 shrink-0 text-emerald-700" />
          <div><h2 className="font-display text-lg font-bold text-slate-900">{title}</h2><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div>
        </div>
        <Link to={to} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950">View all <ChevronRight size={15} /></Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {listings.slice(0, 5).map((listing) => <ListingTile key={listing.id} listing={listing} badge={badge} />)}
      </div>
    </section>
  )
}

export default function Home() {
  const [listings, setListings] = useState([])
  const [sellers, setSellers] = useState([])
  const [promotedSellers, setPromotedSellers] = useState([])
  const [loadingMarketplace, setLoadingMarketplace] = useState(true)
  const [marketplaceError, setMarketplaceError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    async function loadMarketplace() {
      setLoadingMarketplace(true)
      setMarketplaceError('')
      try {
        const [{ data: rows, error: listingsError }, { data: packages }, { data: homePromotions }, { data: spotlightPromotions }] = await Promise.all([
          supabase.from('listings').select('id, slug, title, description, category, product_type, status, is_active, images, price, created_at, seller_id').eq('is_active', true).order('created_at', { ascending: false }).range(0, 199),
          supabase.from('service_packages').select('listing_id, tier, price').eq('tier', 'basic'),
          supabase.from('promotions').select('*').eq('status', 'active').contains('placements', ['homepage_featured']),
          supabase.from('promotions').select('*').eq('status', 'active').contains('placements', ['seller_spotlight']),
        ])
        if (listingsError) throw listingsError
        if (!active) return

        const promotions = homePromotions || []
        const spotlightRows = spotlightPromotions || []
        const listingPromotions = promotions.filter((item) => ['product', 'service'].includes(item.target_type))
        const rowIds = new Set((rows || []).map((row) => row.id))
        const missingIds = [...new Set(listingPromotions.map((item) => item.target_id).filter((id) => id && !rowIds.has(id)))]
        const { data: promotedRows } = missingIds.length
          ? await supabase.from('listings').select('id, slug, title, description, category, product_type, status, is_active, images, price, created_at, seller_id').in('id', missingIds).eq('is_active', true)
          : { data: [] }
        const allRows = [...(rows || []), ...(promotedRows || [])]

        const sellerIds = [...new Set([...allRows.map((row) => row.seller_id), ...spotlightRows.map((item) => item.target_id)].filter(Boolean))]
        const { data: listingSellers, error: sellersError } = sellerIds.length
          ? await supabase.from('profiles').select('id, business_name, full_name, handle, avatar_url, verified_seller, seller_level, pro_vendor, is_seller, status, state, avg_rating, completed_sales_count, created_at').in('id', sellerIds)
          : { data: [], error: null }
        if (sellersError) throw sellersError
        if (!active) return

        const sellerById = new Map((listingSellers || []).map((seller) => [seller.id, seller]))
        const priceByListing = new Map((packages || []).map((row) => [row.listing_id, row.price]))
        const promotionByListing = new Map(listingPromotions.map((item) => [item.target_id, item]))
        const publicListings = allRows
          .filter((row) => row.product_type !== 'digital_service' || row.status === 'published')
          .map((row) => ({ ...row, seller: sellerById.get(row.seller_id), basicPrice: priceByListing.get(row.id), promotion: promotionByListing.get(row.id) || null }))
          .filter((row) => row.seller && row.seller.status !== 'suspended')

        let rankedOrder = new Map()
        const { data: rankedRows, error: rankingError } = await supabase.rpc('search_listings_ranked', {
          p_query: null,
          p_category: null,
          p_limit: 200,
          p_offset: 0,
        })
        if (!rankingError && Array.isArray(rankedRows)) {
          rankedOrder = new Map(rankedRows.map((row, index) => [row.id, index]))
        } else if (rankingError) {
          console.info('Trustall ranked listing search unavailable; using marketplace trust signals.', rankingError.message)
        }

        const rankedListings = publicListings.sort((first, second) => {
          const firstRank = rankedOrder.get(first.id)
          const secondRank = rankedOrder.get(second.id)
          if (firstRank !== undefined || secondRank !== undefined) {
            return (firstRank ?? Number.MAX_SAFE_INTEGER) - (secondRank ?? Number.MAX_SAFE_INTEGER)
          }
          return getTrustScore(second) - getTrustScore(first)
            || new Date(second.created_at).getTime() - new Date(first.created_at).getTime()
        }).filter((listing, index, allListings) => {
          const normalizedTitle = String(listing.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
          return allListings.findIndex((candidate) => (
            candidate.seller_id === listing.seller_id
            && String(candidate.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalizedTitle
          )) === index
        })
        const activeSellerIds = new Set(publicListings.map((listing) => listing.seller_id))
        const discoverableSellers = (listingSellers || [])
          .filter((seller) => activeSellerIds.has(seller.id) && seller.status !== 'suspended')
          .sort((first, second) => Number(second.verified_seller) - Number(first.verified_seller)
            || Number(second.completed_sales_count || 0) - Number(first.completed_sales_count || 0)
            || Number(second.avg_rating || 0) - Number(first.avg_rating || 0))
        setListings(rankedListings)
        setSellers(discoverableSellers)
        setPromotedSellers(spotlightRows.map((promotion) => ({ promotion, seller: sellerById.get(promotion.target_id) })).filter(({ seller }) => seller && seller.status !== 'suspended'))
      } catch (error) {
        console.error('Trustall marketplace homepage failed to load:', error)
        if (active) {
          setListings([])
          setSellers([])
          setMarketplaceError('Marketplace listings could not load. Please try again shortly.')
        }
      } finally {
        if (active) setLoadingMarketplace(false)
      }
    }
    loadMarketplace()
    return () => { active = false }
  }, [])

  useEffect(() => {
    promotedSellers.forEach(({ promotion, seller }) => {
      recordPromotionEvent(promotion.id, 'impression', { target_id: seller.id })
    })
  }, [promotedSellers])

  const promotedListings = listings.filter((listing) => listing.promotion)
  const organicListings = listings.filter((listing) => !listing.promotion)
  const products = organicListings.filter((listing) => listing.product_type !== 'digital_service')
  const services = organicListings.filter((listing) => listing.product_type === 'digital_service')
  const newcomerCandidates = organicListings
    .filter((listing) => Number(listing.seller?.completed_sales_count || 0) === 0)
    .sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime())
  const newcomerSellerIds = new Set()
  const newcomerPicks = newcomerCandidates.filter((listing) => {
    if (newcomerSellerIds.has(listing.seller_id)) return false
    newcomerSellerIds.add(listing.seller_id)
    return true
  }).slice(0, 2)
  const featuredSellerIds = new Set(newcomerPicks.map((listing) => listing.seller_id))
  const rankedEstablishedPicks = organicListings.filter((listing) => !featuredSellerIds.has(listing.seller_id))
  const featuredListings = [...newcomerPicks, ...rankedEstablishedPicks].slice(0, 5)
  const featuredIds = new Set(featuredListings.map((listing) => listing.id))
  const popularProducts = products.filter((listing) => !featuredIds.has(listing.id)).slice(0, 4)
  const featuredServices = services.filter((listing) => !featuredIds.has(listing.id)).slice(0, 4)
  const newSellers = sellers
    .filter((seller) => Number(seller.completed_sales_count || 0) === 0)
    .sort((first, second) => new Date(second.created_at || 0).getTime() - new Date(first.created_at || 0).getTime())
    .slice(0, 5)
  return (
    <div className="bg-white pb-6">
      <Seo
        title="Trustall | Buy and Sell Safely Across Nigeria"
        description="Shop products, discover digital services and connect with verified sellers across Nigeria. Chat, negotiate and pay with Trustall escrow protection."
        path="/"
        image="https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1200&q=85"
      />
      <section className="relative overflow-hidden bg-[#eaf8ef]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(255,255,255,.9),transparent_48%),linear-gradient(120deg,rgba(221,246,229,.75),rgba(245,251,246,.92)_58%,rgba(226,247,232,.85))]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-7 px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-10 md:min-h-[430px] md:grid-cols-[1.02fr_.98fr] md:gap-10 md:py-12">
          <div className="relative z-10 max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-800/10 bg-white/75 px-3 py-1.5 font-mono text-[9px] font-semibold uppercase text-emerald-900 sm:text-[10px]"><ShieldCheck size={13} /> Nigeria’s trusted marketplace</p>
            <h1 className="mt-4 max-w-[12ch] font-display text-3xl font-extrabold leading-[1.02] text-slate-950 sm:text-5xl md:text-[54px]">Buy &amp; sell safely <span className="text-emerald-700">across Nigeria.</span></h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-700 sm:text-base">Find quality products, digital services and trusted sellers. Chat, agree and pay with secure escrow protection.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10px] text-slate-600"><span className="font-semibold">Popular:</span>{['Phones', 'Fashion', 'Web design', 'Home services'].map((term) => <button key={term} type="button" onClick={() => navigate(`/browse?q=${encodeURIComponent(term)}`)} className="underline decoration-emerald-700/20 underline-offset-2 transition hover:text-emerald-800">{term}</button>)}</div>
            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-emerald-900/10 pt-4">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700"><ShieldCheck size={17} className="shrink-0 text-emerald-700" /><span>Escrow protection</span></div>
              <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700"><Check size={17} className="shrink-0 text-emerald-700" /><span>Verified sellers</span></div>
              <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700"><ShoppingBag size={16} className="shrink-0 text-emerald-700" /><span>Made for Nigeria</span></div>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[520px] md:max-w-none">
            <div className="relative aspect-[3.2/1] overflow-hidden rounded-lg bg-emerald-900/10 shadow-[0_24px_60px_rgba(18,75,49,.16)] md:aspect-[1.55/1]">
              <img src="https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1200&q=85" alt="Secure online shopping and payment on a laptop" className="h-full w-full object-cover object-center" fetchPriority="high" />
              <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/35 via-transparent to-transparent" />
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-white/70 bg-white/95 px-3 py-2 shadow-lg sm:bottom-5 sm:left-5 sm:gap-3 sm:px-4 sm:py-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><ShieldCheck size={18} /></span><span><span className="block text-[10px] font-bold text-slate-900 sm:text-xs">Trusted sellers</span><span className="mt-0.5 block text-[9px] text-slate-600">Protected from first chat to delivery</span></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-8">
          {categories.map(({ label, icon: Icon }) => (
            <Link key={label} to={`/browse?category=${encodeURIComponent(label)}`} className="group flex min-h-[78px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-slate-100 bg-white px-1.5 py-3 text-center transition hover:border-emerald-200 hover:bg-emerald-50/60">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 transition group-hover:bg-emerald-100"><Icon size={18} /></span><span className="line-clamp-2 text-[9px] font-semibold leading-tight text-slate-600 sm:text-[10px]">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-5 sm:px-6">
        <div className="grid overflow-hidden rounded-lg border border-emerald-100 bg-[#eff9f1] md:grid-cols-[.85fr_1.15fr]">
          <div className="relative aspect-[2.1/1] overflow-hidden bg-emerald-900/10 md:aspect-auto md:min-h-[250px]">
            <img src="https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1000&q=82" alt="A professional team collaborating on a business" loading="lazy" className="absolute inset-0 h-full w-full object-cover object-center" />
          </div>
          <div className="flex flex-col justify-center p-5 sm:p-7">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-800">For sellers</p>
            <h2 className="mt-2 max-w-md font-display text-xl font-bold leading-tight text-slate-950 sm:text-2xl">Grow your business with Trustall</h2>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-600 sm:text-sm">Reach customers across Nigeria with products, services and digital listings, backed by safer conversations and protected checkout.</p>
            <div className="mt-4 grid gap-2 text-[10px] font-medium text-slate-700 sm:grid-cols-2 sm:text-xs"><span className="flex items-center gap-2"><Check size={14} className="text-emerald-700" /> Create a seller profile</span><span className="flex items-center gap-2"><Check size={14} className="text-emerald-700" /> List products or services</span><span className="flex items-center gap-2"><Check size={14} className="text-emerald-700" /> Chat with interested buyers</span><span className="flex items-center gap-2"><Check size={14} className="text-emerald-700" /> Promote listings when ready</span></div>
            <Link to="/sell" className="mt-5 inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-emerald-800 px-4 text-xs font-semibold text-white transition hover:bg-emerald-950">Become a seller <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      {marketplaceError && <p role="alert" className="mx-auto max-w-6xl px-4 py-4 text-sm text-red-700 sm:px-6">{marketplaceError}</p>}
      {loadingMarketplace && listings.length === 0 && <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-500 sm:px-6">Finding trusted listings…</p>}
      {!loadingMarketplace && !marketplaceError && listings.length === 0 && <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-500 sm:px-6">No live listings yet. Check back soon for trusted products and services.</p>}

      {promotedListings.length > 0 && <ProductSection title="Promoted listings" subtitle="Paid placements from Trustall sellers." listings={promotedListings} badge="Promoted" icon={Sparkles} />}

      {promotedSellers.length > 0 && <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6"><h2 className="font-display text-lg font-bold text-slate-900">Seller spotlight</h2><p className="mt-1 text-xs text-slate-500">Promoted storefronts from Trustall sellers.</p><div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">{promotedSellers.map(({ promotion, seller }) => <Link key={promotion.id} to={`/seller/${seller.handle || seller.id}`} onClick={() => recordPromotionEvent(promotion.id, 'click', { target_id: seller.id })} className="rounded-lg border border-marigold-300 bg-white p-3" ><span className="inline-block rounded bg-marigold-500 px-2 py-1 font-mono text-[9px] font-bold uppercase text-emerald-950">Promoted</span><span className="mt-2 block truncate text-sm font-bold text-slate-900">{seller.business_name || seller.full_name || 'Trustall seller'}</span><span className="mt-1 block truncate text-xs text-slate-600">{seller.state || 'Nigeria'}</span></Link>)}</div></section>}

      <ProductSection title="Picked for trust" subtitle="Ranked by Trustall signals, with two discovery spots reserved for sellers with no completed sales." listings={featuredListings} badge="Trustall pick" icon={ShieldCheck} />

      <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <div className="mb-4 flex items-end justify-between"><div><h2 className="font-display text-lg font-bold text-slate-900">Popular products</h2><p className="text-xs text-slate-500">Trending finds loved by the Trustall community.</p></div><Link to="/browse" className="flex items-center text-xs font-semibold text-emerald-800">View all <ChevronRight size={15} /></Link></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{popularProducts.map((listing) => <ListingTile key={listing.id} listing={listing} badge="Trusted seller" />)}</div>
          </div>
          <div className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
            <div className="mb-4 flex items-end justify-between"><div><h2 className="font-display text-lg font-bold text-slate-900">Featured services</h2><p className="text-xs text-slate-500">Skilled professionals ready to help you.</p></div><Link to="/browse?category=Services" className="flex items-center text-xs font-semibold text-emerald-800">View all <ChevronRight size={15} /></Link></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{featuredServices.map((listing) => <ListingTile key={listing.id} listing={listing} badge="Service" />)}</div>
          </div>
        </div>
      </section>

      {newSellers.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div className="flex items-start gap-2.5"><Sparkles size={21} className="mt-0.5 text-emerald-700" /><div><h2 className="font-display text-lg font-bold text-slate-900">New sellers to discover</h2><p className="text-xs text-slate-500">Give an emerging Trustall business its first order.</p></div></div>
            <Link to="/sellers" className="flex shrink-0 items-center text-xs font-semibold text-emerald-800">View all <ChevronRight size={15} /></Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
            {newSellers.map((seller) => <Link key={seller.id} to={`/seller/${seller.handle || seller.id}`} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 transition hover:border-emerald-700/40 hover:bg-white hover:shadow-sm"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-xs font-bold text-emerald-800">{seller.avatar_url ? <img src={seller.avatar_url} alt="" className="h-full w-full object-cover" /> : (seller.business_name || seller.full_name || '?').slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-[11px] font-bold text-slate-900">{seller.business_name || seller.full_name || 'New seller'}</span><span className="mt-1 block truncate text-[10px] text-emerald-800">{seller.verified_seller ? 'Verified · ' : ''}{seller.state || 'Nigeria'} · New seller</span></span></Link>)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
        <div className="mb-4 flex items-end justify-between"><div className="flex items-start gap-2.5"><Users size={21} className="mt-0.5 text-emerald-700" /><div><h2 className="font-display text-lg font-bold text-slate-900">Sellers to discover</h2><p className="text-xs text-slate-500">Amazing sellers. Great products. Real people.</p></div></div><Link to="/sellers" className="flex items-center text-xs font-semibold text-emerald-800">View all <ChevronRight size={15} /></Link></div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          {sellers.slice(0, 5).map((seller) => <Link key={seller.id} to={`/seller/${seller.handle || seller.id}`} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 transition hover:border-emerald-700/40 hover:shadow-sm"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-xs font-bold text-emerald-800">{seller.avatar_url ? <img src={seller.avatar_url} alt="" className="h-full w-full object-cover" /> : (seller.business_name || seller.full_name || '?').slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="flex items-center gap-1 truncate text-[11px] font-bold text-slate-900">{seller.business_name || seller.full_name || 'Trustall seller'}{seller.verified_seller && <SealMark size={12} />}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{seller.state || 'Nigeria'} · {seller.avg_rating ? `${Number(seller.avg_rating).toFixed(1)} rating` : 'New seller'}</span></span></Link>)}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-950 px-5 py-4 text-white sm:px-7"><div><p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-200">Trust &amp; safety</p><h2 className="mt-1 font-display text-lg font-bold">A safer way to find your next deal.</h2></div><Link to="/trust-safety" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-4 text-xs font-semibold text-emerald-950">How it works <ArrowRight size={14} /></Link></div></section>
    </div>
  )
}