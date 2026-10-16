import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useSession } from '../lib/useProfile.js'
import { SealMark } from '../components/Navbar.jsx'
import { LoadingState, NotFound, DataError } from '../components/ErrorBoundary.jsx'
import { loadSavedListingIds, saveListing, unsaveListing } from '../lib/listingFeatures.js'
import Seo from '../components/Seo.jsx'
import { recordPromotionEvent } from '../lib/promotions.js'

function listingImageUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return supabase.storage.from('listing-images').getPublicUrl(value).data.publicUrl
}

function ListingGallery({ gallery }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [touchStart, setTouchStart] = useState(null)

  useEffect(() => {
    setActiveIndex(0)
    setLightboxOpen(false)
  }, [gallery])

  if (gallery.length === 0) {
    return <div className="aspect-square rounded-2xl bg-surfacealt" />
  }

  const previous = () => setActiveIndex((current) => (current - 1 + gallery.length) % gallery.length)
  const next = () => setActiveIndex((current) => (current + 1) % gallery.length)
  const handleTouchStart = (event) => setTouchStart(event.touches[0].clientX)
  const handleTouchEnd = (event) => {
    if (touchStart === null) return
    const distance = event.changedTouches[0].clientX - touchStart
    if (Math.abs(distance) > 40) distance > 0 ? previous() : next()
    setTouchStart(null)
  }

  return (
    <div>
      <div
        className="relative aspect-square overflow-hidden rounded-2xl bg-surfacealt"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="h-full w-full cursor-zoom-in"
          aria-label="Open listing image full screen"
        >
          <img src={listingImageUrl(gallery[activeIndex])} alt={`Listing image ${activeIndex + 1} of ${gallery.length}`} loading="lazy" className="h-full w-full object-cover" />
        </button>
        {gallery.length > 1 && (
          <>
            <button type="button" onClick={previous} aria-label="Previous listing image" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-ink/70 px-3 py-2 text-lg text-white hover:bg-ink">‹</button>
            <button type="button" onClick={next} aria-label="Next listing image" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-ink/70 px-3 py-2 text-lg text-white hover:bg-ink">›</button>
            <span className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-3 py-1 font-mono text-xs text-white">{activeIndex + 1}/{gallery.length}</span>
          </>
        )}
      </div>

      {gallery.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {gallery.map((src, index) => (
            <button
              key={src + index}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Show listing image ${index + 1}`}
              className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border-2 ${index === activeIndex ? 'border-seal' : 'border-transparent'}`}
            >
              <img src={listingImageUrl(src)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="Listing image viewer">
          <button type="button" onClick={() => setLightboxOpen(false)} aria-label="Close image viewer" className="absolute right-4 top-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20">×</button>
          {gallery.length > 1 && <button type="button" onClick={previous} aria-label="Previous listing image" className="absolute left-4 rounded-full bg-white/10 px-4 py-2 text-3xl text-white hover:bg-white/20">‹</button>}
          <img src={listingImageUrl(gallery[activeIndex])} alt={`Listing image ${activeIndex + 1} of ${gallery.length}`} loading="lazy" className="max-h-[90vh] max-w-[90vw] object-contain" />
          {gallery.length > 1 && <button type="button" onClick={next} aria-label="Next listing image" className="absolute right-4 rounded-full bg-white/10 px-4 py-2 text-3xl text-white hover:bg-white/20">›</button>}
          <span className="absolute bottom-5 rounded-full bg-white/10 px-3 py-1 font-mono text-xs text-white">{activeIndex + 1}/{gallery.length}</span>
        </div>
      )}
    </div>
  )
}

export default function Listing() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [shareLabel, setShareLabel] = useState('Share listing')
  const [manualShareUrl, setManualShareUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const [packages, setPackages] = useState([])
  const [extras, setExtras] = useState([])
  const [selectedPackageId, setSelectedPackageId] = useState(null)
  const [selectedExtraIds, setSelectedExtraIds] = useState([])
  const [creatingOffer, setCreatingOffer] = useState(false)
  const [offerMessage, setOfferMessage] = useState('')

  useEffect(() => {
    async function loadListing() {
      try {
        setLoading(true)
        setError(null)
        
        const { data, error: fetchError } = await supabase
          .from('listings')
          .select('*, seller:seller_id(id, business_name, handle, state, verified_seller, seller_level, pro_vendor, avg_rating, completed_sales_count, total_sales_volume)')
          .eq('slug', slug)
          .maybeSingle()

        if (fetchError) {
          console.error('Error loading listing:', fetchError)
          setError(fetchError)
          setListing(null)
        } else if (!data) {
          setListing(null)
          setError(null)
        } else {
          const { data: categoryRow } = data.category_id
            ? await supabase.from('categories').select('name').eq('id', data.category_id).maybeSingle()
            : { data: null }
          setListing({ ...data, category: data.category || categoryRow?.name || null })
          setError(null)
          if (data.product_type === 'digital_service') {
            const [{ data: packageRows }, { data: extraRows }] = await Promise.all([
              supabase.from('service_packages').select('*').eq('listing_id', data.id).order('tier'),
              supabase.from('gig_extras').select('*').eq('listing_id', data.id).order('created_at'),
            ])
            setPackages(packageRows || [])
            setExtras(extraRows || [])
            setSelectedPackageId(packageRows?.[0]?.id || null)
          }
          if (session?.user?.id) {
            supabase
              .rpc('record_listing_view', { p_listing_id: data.id })
              .then(({ error: viewError }) => {
                if (viewError) console.warn('Recently viewed update skipped:', viewError)
              })
          }
        }
      } catch (err) {
        console.error('Unexpected error loading listing:', err)
        setError(err)
        setListing(null)
      } finally {
        setLoading(false)
      }
    }

    if (slug) {
      loadListing()
    }
  }, [slug, session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id || !listing?.id) return
    loadSavedListingIds(session.user.id).then((ids) => setSaved(ids.has(listing.id)))
  }, [session?.user?.id, listing?.id])

  useEffect(() => {
    const promotionId = searchParams.get('promotion')
    if (listing?.id && promotionId) recordPromotionEvent(promotionId, 'view', { listing_id: listing.id })
  }, [listing?.id, searchParams])

  async function toggleSaved() {
    if (!session) {
      navigate(`/auth?redirectTo=${encodeURIComponent(`/listing/${slug}`)}`)
      return
    }
    if (saved) await unsaveListing(session.user.id, listing.id)
    else await saveListing(session.user.id, listing.id)
    setSaved((current) => !current)
  }

  async function startChat(withPackageRequest = false) {
    if (!session) {
      navigate('/auth', { state: { redirectTo: `/listing/${slug}` } })
      return
    }

    const sellerId = listing?.seller_id || listing?.seller?.id
    if (!sellerId) {
      console.error('Cannot start chat because the listing seller id is missing.')
      return
    }
    if (session.user.id === sellerId) return

    setStarting(true)
    try {
      const conversationId = await getOrCreateConversation(listing.id, session.user.id, sellerId)
      if (!conversationId) return
      const promotionId = searchParams.get('promotion')
      if (promotionId) await recordPromotionEvent(promotionId, 'message_started', { listing_id: listing.id, conversation_id: conversationId })
      if (withPackageRequest && selectedPackageId) {
        const { error: messageError } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: session.user.id,
          body: buildPackageRequestMessage(packages, extras, selectedPackageId, selectedExtraIds),
        })
        if (messageError) console.warn('Package request message could not be saved:', messageError)
      }
      navigate(`/messages/${conversationId}?listing=${encodeURIComponent(listing.id)}`)
    } catch (err) {
      console.error('Error starting chat:', err)
    } finally {
      setStarting(false)
    }
  }

  async function continueWithService() {
    if (!session) {
      navigate('/auth', { state: { redirectTo: `/listing/${slug}` } })
      return
    }

    const sellerId = listing?.seller_id || listing?.seller?.id
    if (!sellerId) {
      console.error('Cannot start service request because the listing seller id is missing.')
      return
    }
    if (!selectedPackageId || session.user.id === sellerId) return
    setCreatingOffer(true)
    setOfferMessage('')
    try {
      const conversationId = await getOrCreateConversation(listing.id, session.user.id, sellerId)
      if (!conversationId) return
      const promotionId = searchParams.get('promotion')
      if (promotionId) await recordPromotionEvent(promotionId, 'message_started', { listing_id: listing.id, conversation_id: conversationId })

      const { error: offerError } = await supabase.from('offers').insert({
        conversation_id: conversationId,
        seller_id: sellerId,
        item_title: listing.title,
        item_description: listing.description || null,
        package_id: selectedPackageId,
        selected_extra_ids: selectedExtraIds,
      })
      if (offerError) {
        // Older RLS policies allow sellers to create offers only. Preserve the
        // buyer request in the conversation so the seller can respond with the formal offer.
        const requestBody = buildPackageRequestMessage(packages, extras, selectedPackageId, selectedExtraIds)
        const { error: messageError } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: session.user.id,
          body: requestBody,
        })
        if (messageError) throw offerError
      } else {
        const { error: messageError } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: session.user.id,
          body: buildPackageRequestMessage(packages, extras, selectedPackageId, selectedExtraIds),
        })
        if (messageError) console.warn('Package request message was not saved:', messageError)
      }
      navigate(`/messages/${conversationId}?listing=${encodeURIComponent(listing.id)}`)
    } catch (offerError) {
      console.error('Service offer creation failed:', offerError)
      setOfferMessage(offerError.message || 'Could not start this service offer.')
    } finally {
      setCreatingOffer(false)
    }
  }

  async function shareListing() {
    const url = window.location.href
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        copied = true
      }

      if (navigator.share) {
        await navigator.share({ title: listing.title, url })
        setShareLabel('Shared')
      } else if (copied) {
        setShareLabel('Link copied')
      } else {
        setManualShareUrl(url)
        return
      }
      setTimeout(() => setShareLabel('Share listing'), 1800)
    } catch (error) {
      if (error.name === 'AbortError' && copied) {
        setShareLabel('Link copied')
        setTimeout(() => setShareLabel('Share listing'), 1800)
      } else if (error.name !== 'AbortError') {
        console.error('Failed to share listing:', error)
        if (!copied) setManualShareUrl(url)
      }
    }
  }

  // Loading state
  if (loading) {
    return <LoadingState message="Loading listing…" />
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
  if (!listing) {
    return (
      <div className="px-6 py-24">
        <NotFound 
          message="This listing could not be found. It may have been removed or is no longer available."
          actionHref="/browse"
        />
      </div>
    )
  }

  const gallery = listing.images || []
  const listingDescription = String(listing.description || `${listing.title} available from a Trustall seller in Nigeria.`)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  const listingImage = Array.isArray(listing.images) ? listing.images[0] : listing.images
  const listingCanonicalPath = `/listing/${encodeURIComponent(listing.slug || slug)}`
  const servicePrice = packages.find((item) => item.tier === 'basic')?.price
  const seoPrice = listing.product_type === 'digital_service' ? servicePrice ?? listing.price : listing.price
  const listingSchema = listing.product_type === 'digital_service'
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: listing.title,
        description: listingDescription,
        serviceType: listing.category || 'Digital service',
        provider: { '@type': 'Organization', name: listing.seller?.business_name || listing.seller?.handle || 'Trustall seller' },
        areaServed: { '@type': 'Country', name: 'Nigeria' },
        url: `https://trustall.online${listingCanonicalPath}`,
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: listing.title,
        description: listingDescription,
        image: listingImage ? [listingImageUrl(listingImage)] : undefined,
        category: listing.category || undefined,
        offers: {
          '@type': 'Offer',
          url: `https://trustall.online${listingCanonicalPath}`,
          priceCurrency: 'NGN',
          price: Number(seoPrice || 0),
          availability: listing.is_active ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
      }

  return (
    <>
    <Seo
      title={`${listing.title} | Buy safely on Trustall`}
      description={listingDescription}
      path={listingCanonicalPath}
      image={listingImage ? listingImageUrl(listingImage) : undefined}
      type="product"
      noindex={!listing.is_active || listing.product_type === 'digital_service' && listing.status !== 'published'}
      structuredData={listingSchema}
    />
    <section className="mx-auto max-w-4xl px-6 py-16">
      <div className="grid gap-10 md:grid-cols-2">
        <ListingGallery gallery={gallery} />
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">{listing.category || 'Digital service'}</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">{listing.title}</h1>
          <p className="mt-3 font-mono text-2xl text-ink">₦{Number(listing.price).toLocaleString()}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={shareListing} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs font-semibold text-ink hover:border-seal hover:text-seal">{shareLabel}</button>
            <button type="button" onClick={toggleSaved} aria-label={saved ? 'Remove saved listing' : 'Save listing'} className="rounded-full border border-hairline p-2 text-seal hover:bg-seal hover:text-white">
              {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </button>
          </div>
          {manualShareUrl && (
            <div className="mt-3 rounded-xl border border-hairline bg-surfacealt p-3">
              <label className="block text-xs text-muted" htmlFor="manual-listing-link">Copy this listing link</label>
              <input id="manual-listing-link" readOnly value={manualShareUrl} onFocus={(event) => event.target.select()} className="mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-xs text-ink" />
            </div>
          )}

          {listing.description && (
            <p className="mt-5 text-sm leading-relaxed text-muted">{listing.description}</p>
          )}

          {listing.product_type === 'digital_service' && (
            <ServicePackagePicker
              packages={packages}
              extras={extras}
              selectedPackageId={selectedPackageId}
              selectedExtraIds={selectedExtraIds}
              onPackageChange={setSelectedPackageId}
              onExtrasChange={setSelectedExtraIds}
              onContinue={continueWithService}
              onContact={() => startChat(true)}
              creatingOffer={creatingOffer}
              message={offerMessage}
            />
          )}

          <Link
            to={`/seller/${listing.seller?.handle}`}
            className="mt-6 flex items-center gap-3 rounded-xl border border-hairline bg-white p-4 transition hover:border-seal"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-inksoft font-display text-sm font-bold text-surface">
              {(listing.seller?.business_name || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="font-body text-sm font-semibold text-ink">{listing.seller?.business_name}</p>
                {listing.seller?.verified_seller && <SealMark size={14} />}
              </div>
              <p className="font-mono text-xs text-muted">
                {listing.seller?.state} · {listing.seller?.avg_rating ? `${Number(listing.seller.avg_rating).toFixed(1)}★` : 'No reviews yet'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-seal/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-seal">
                  {Number(listing.seller?.completed_sales_count || 0)} sales
                </span>
                <span className="rounded-full bg-ink/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-ink">
                  ₦{Number(listing.seller?.total_sales_volume || 0).toLocaleString()} total
                </span>
              </div>
            </div>
          </Link>

          <button
            onClick={startChat}
            disabled={starting}
            className="mt-6 w-full rounded-full bg-seal py-3 font-body text-sm font-semibold text-surface transition hover:bg-seal-deep disabled:opacity-50"
          >
            {starting ? 'Starting chat…' : 'Chat with seller'}
          </button>
        </div>
      </div>
    </section>
    </>
  )
}

async function getOrCreateConversation(listingId, buyerId, sellerId) {
  const { data: existing, error: lookupError } = await supabase
    .from('conversations')
    .select('id')
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (existing?.id) return existing.id

  const { data: created, error: insertError } = await supabase
    .from('conversations')
    .insert({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId })
    .select('id')
    .single()

  if (!insertError) return created.id

  // Another tab or request may have created the unique buyer/seller thread first.
  if (insertError.code === '23505') {
    const { data: concurrentConversation, error: retryError } = await supabase
      .from('conversations')
      .select('id')
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .maybeSingle()

    if (retryError) throw retryError
    if (concurrentConversation?.id) return concurrentConversation.id
  }

  throw insertError
}

function buildPackageRequestMessage(packages, extras, selectedPackageId, selectedExtraIds) {
  const selectedPackage = packages.find((item) => item.id === selectedPackageId)
  const selectedExtras = extras.filter((item) => selectedExtraIds.includes(item.id))
  return [
    `Package request: ${selectedPackage?.name || 'Selected package'} (${selectedPackage?.tier || 'package'})`,
    selectedPackage ? `Package price: ₦${Number(selectedPackage.price || 0).toLocaleString()} · ${selectedPackage.delivery_days || 0} days · ${selectedPackage.revisions || 0} revisions` : null,
    selectedExtras.length ? `Extras: ${selectedExtras.map((item) => item.name).join(', ')}` : null,
    'I would like to proceed with this package. Please confirm the next steps.',
  ].filter(Boolean).join('\n')
}

function ServicePackagePicker({ packages, extras, selectedPackageId, selectedExtraIds, onPackageChange, onExtrasChange, onContinue, onContact, creatingOffer, message }) {
  function toggleExtra(extraId) {
    onExtrasChange(selectedExtraIds.includes(extraId)
      ? selectedExtraIds.filter((id) => id !== extraId)
      : [...selectedExtraIds, extraId])
  }

  const selectedPackage = packages.find((item) => item.id === selectedPackageId)

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-seal/20 bg-gradient-to-br from-seal/10 via-white to-marigold/10 shadow-sm">
      <div>
        <div className="border-b border-seal/15 p-4 sm:p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-seal">Choose a package</p><p className="mt-1 text-sm text-muted">Select a tier to view its exact deliverables.</p></div>
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {packages.map((servicePackage) => (
            <button key={servicePackage.id} type="button" onClick={() => onPackageChange(servicePackage.id)} className={`flex min-h-[190px] flex-col text-left rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-seal hover:shadow-md ${selectedPackageId === servicePackage.id ? 'border-seal bg-white ring-2 ring-seal/20' : 'border-hairline bg-white/90'}`}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{servicePackage.tier}</p>
              <p className="mt-1 font-display text-lg font-bold text-ink">{servicePackage.name}</p>
              <p className="mt-2 font-display text-xl font-bold text-seal">₦{Number(servicePackage.price).toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted">{servicePackage.delivery_days} days · {servicePackage.revisions} revisions</p><span className="mt-auto pt-3 text-xs font-semibold text-seal">{selectedPackageId === servicePackage.id ? 'Selected package' : 'View package details'}</span>
            </button>
          ))}
        </div>
      </div>
      {selectedPackage && <div className="mx-4 rounded-xl border border-seal/20 bg-white p-4 sm:mx-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-widest text-seal">Selected package</p><h4 className="mt-1 font-display text-xl font-bold text-ink">{selectedPackage.name}</h4></div><p className="font-display text-xl font-bold text-seal">₦{Number(selectedPackage.price).toLocaleString()}</p></div>{selectedPackage.description && <p className="mt-3 text-sm leading-relaxed text-muted">{selectedPackage.description}</p>}{selectedPackage.features?.length > 0 && <ul className="mt-3 grid gap-2 text-sm text-ink sm:grid-cols-2">{selectedPackage.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>}<p className="mt-3 text-xs font-semibold text-muted">{selectedPackage.delivery_days} delivery days · {selectedPackage.revisions} revisions</p></div>}
      {extras.length > 0 && <div className="p-4 sm:p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-seal">Add extras</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{extras.map((extra) => <label key={extra.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-hairline bg-white p-3 text-sm"><input type="checkbox" checked={selectedExtraIds.includes(extra.id)} onChange={() => toggleExtra(extra.id)} className="mt-1 shrink-0" /><span className="min-w-0 flex-1"><strong className="text-ink">{extra.name}</strong><span className="ml-2 text-seal">+₦{Number(extra.price).toLocaleString()}</span>{extra.description && <span className="mt-1 block break-words text-xs text-muted">{extra.description}</span>}</span></label>)}</div></div>}
      {message && <p className="px-4 text-sm text-marigold-deep sm:px-5">{message}</p>}
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:p-5"><button type="button" onClick={onContact} disabled={creatingOffer} className="rounded-full border border-seal px-5 py-3 font-body text-sm font-semibold text-seal hover:bg-seal/10 disabled:opacity-50 sm:flex-1">Contact seller</button><button type="button" onClick={onContinue} disabled={!selectedPackageId || creatingOffer} className="rounded-full bg-seal px-5 py-3 font-body text-sm font-semibold text-surface disabled:opacity-50 sm:flex-1">{creatingOffer ? 'Sending request…' : 'Send request'}</button></div>
    </div>
  )
}
