import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BriefcaseBusiness, Check, ChevronRight, Heart, House, Laptop, Search, ShieldCheck, Shirt, Smartphone, Sparkles, Users, Wrench } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { SealMark } from '../components/Navbar.jsx'
import { recordPromotionEvent } from '../lib/promotions.js'

const categories = [
  { label: 'Phones & Gadgets', icon: Smartphone },
  { label: 'Electronics', icon: Laptop },
  { label: 'Fashion & Style', icon: Shirt },
  { label: 'Home & Living', icon: House },
  { label: 'Services', icon: Wrench },
  { label: 'Beauty & Personal Care', icon: Heart },
  { label: 'Freelance Gigs', icon: BriefcaseBusiness },
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
  const [search, setSearch] = useState('')
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
  const submitSearch = (event) => {
    event.preventDefault()
    const value = search.trim()
    navigate(value ? `/browse?q=${encodeURIComponent(value)}` : '/browse')
  }

  return (
    <div className="bg-white pb-6">
      <section className="relative isolate overflow-hidden bg-gradient-to-r from-emerald-50 via-white to-blossom/80">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(236,253,245,.98)_0%,rgba(255,255,255,.94)_46%,rgba(255,241,216,.32)_78%),url('https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1800&q=85')] bg-cover bg-[center_42%]" />
        <div className="mx-auto grid min-h-[330px] max-w-6xl items-center gap-8 px-5 py-10 sm:px-6 sm:py-14 md:min-h-[370px] md:grid-cols-[1.05fr_.95fr]">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-800">Buy <span className="px-1 text-marigold-500">·</span> Sell <span className="px-1 text-marigold-500">·</span> Find services</p>
            <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.02] text-slate-950 sm:text-5xl">Everything you need,<br /><span className="text-emerald-700">in one trusted place.</span></h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-700">Discover quality products, skilled service providers and trusted sellers, all on Trustall.</p>
            <form onSubmit={submitSearch} className="mt-5 flex max-w-[560px] overflow-hidden rounded-lg border border-emerald-700/20 bg-white shadow-sm focus-within:ring-2 focus-within:ring-emerald-600/30">
              <label className="flex min-w-0 flex-1 items-center gap-2 px-3"><Search size={16} className="shrink-0 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, services, or sellers..." className="min-w-0 flex-1 border-0 bg-transparent py-3 text-xs text-slate-900 outline-none placeholder:text-slate-400" /></label>
              <button aria-label="Search" className="flex w-12 shrink-0 items-center justify-center bg-emerald-700 text-white transition hover:bg-emerald-800"><Search size={17} /></button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-600"><span className="font-semibold">Popular:</span>{['iPhone', 'Laptop', 'Fashion', 'Web Design', 'Home Services'].map((term) => <button key={term} type="button" onClick={() => navigate(`/browse?q=${encodeURIComponent(term)}`)} className="rounded-full border border-emerald-100 bg-white/80 px-2.5 py-1 transition hover:border-marigold-300 hover:text-emerald-800">{term}</button>)}</div>
          </div>
          <div className="hidden justify-end md:flex">
            <div className="max-w-[190px] rounded-xl border border-marigold-200 bg-white/90 p-4 shadow-lg shadow-emerald-900/5 backdrop-blur-sm">
              <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-marigold-100 text-marigold-700"><ShieldCheck size={22} /></span><div><p className="text-xs font-bold text-slate-900">Buyer protection</p><p className="mt-0.5 text-[10px] leading-snug text-slate-600">Your transactions are safe with Trustall.</p></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-7">
          {categories.map(({ label, icon: Icon }) => (
            <Link key={label} to={`/browse?category=${encodeURIComponent(label)}`} className="group flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-100 bg-white px-1 py-3 text-center transition hover:border-emerald-200 hover:bg-emerald-50/60">
              <Icon size={19} className="text-emerald-700 transition group-hover:scale-110" /><span className="text-[9px] font-semibold leading-tight text-slate-600 sm:text-[10px]">{label}</span>
            </Link>
          ))}
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

      <section className="mx-auto grid max-w-6xl gap-3 px-4 py-5 sm:px-6 md:grid-cols-[1fr_190px]">
        <div className="flex min-h-28 items-center justify-between gap-5 overflow-hidden rounded-lg bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-700 px-5 py-5 text-white sm:px-8">
          <div><p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-marigold-200">Grow your business</p><h2 className="mt-1 font-display text-xl font-bold">Get more visibility with Trustall</h2><p className="mt-1 text-xs text-white/70">Showcase your products and services to more people.</p><Link to="/marketing" className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-950">Learn more <ArrowRight size={12} /></Link></div>
          <div className="hidden h-20 w-20 shrink-0 items-center justify-center rounded-full border border-marigold-300/50 bg-emerald-800 sm:flex"><Check size={34} className="text-marigold-200" /></div>
        </div>
        <Link to="/sell" className="flex items-center justify-between gap-3 rounded-lg bg-gradient-to-br from-marigold-500 to-marigold-400 p-5 text-emerald-950 transition hover:brightness-105"><span><span className="block text-xs font-bold">For sellers</span><span className="mt-1 block text-[10px] leading-relaxed text-emerald-950/80">Grow your business with targeted exposure on Trustall.</span><span className="mt-3 inline-block rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-800">Promote now</span></span><ArrowRight size={18} /></Link>
      </section>
    </div>
  )
}