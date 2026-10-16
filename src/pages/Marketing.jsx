import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BarChart3, Check, CircleDollarSign, Eye, MousePointer2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { PROMOTION_PLACEMENTS } from '../lib/promotions.js'

const TARGET_TYPES = [
  { id: 'product', label: 'Product' },
  { id: 'service', label: 'Service / gig' },
  { id: 'storefront', label: 'Storefront' },
]

function naira(value) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return 'Unavailable'
  return Number(value).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
}

function packagePrice(item) {
  const price = Number(item?.price_ngn ?? item?.amount_ngn ?? item?.price)
  return Number.isFinite(price) && price > 0 ? price : null
}

function listingImage(value) {
  let image = Array.isArray(value) ? value[0] : value
  if (typeof image === 'string') {
    try {
      const parsed = JSON.parse(image)
      if (Array.isArray(parsed)) image = parsed[0]
    } catch {
      // Use a non-JSON value as the storage path.
    }
  }
  if (!image) return ''
  return /^https?:\/\//i.test(image) ? image : supabase.storage.from('listing-images').getPublicUrl(image).data.publicUrl
}

function unwrap(value) {
  return Array.isArray(value) ? value[0] : value
}

function readMetric(stats, keys) {
  for (const key of keys) {
    if (stats?.[key] !== undefined && stats[key] !== null && Number.isFinite(Number(stats[key]))) return Number(stats[key])
  }
  return null
}

export default function Marketing() {
  const { session, profile, loading } = useProfile()
  const navigate = useNavigate()
  const [packages, setPackages] = useState([])
  const [listings, setListings] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [statsById, setStatsById] = useState({})
  const [loadingData, setLoadingData] = useState(true)
  const [dataError, setDataError] = useState('')
  const [screen, setScreen] = useState('dashboard')
  const [step, setStep] = useState(0)
  const [targetType, setTargetType] = useState('product')
  const [targetId, setTargetId] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [placements, setPlacements] = useState([])
  const [packageId, setPackageId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [selectedAnalytics, setSelectedAnalytics] = useState(null)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/marketing' } })
  }, [loading, session, navigate])

  useEffect(() => {
    if (session?.user?.id) loadDashboard()
  }, [session?.user?.id])

  async function loadDashboard() {
    setLoadingData(true)
    setDataError('')
    const [packageResult, listingResult, campaignResult] = await Promise.all([
      supabase.from('promotion_packages').select('*').eq('is_active', true).order('duration_days'),
      supabase.from('listings').select('id, title, description, category, product_type, status, is_active, images, price, slug').eq('seller_id', session.user.id).eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('promotions').select('*').eq('seller_id', session.user.id).order('created_at', { ascending: false }),
    ])
    const queryError = packageResult.error || listingResult.error || campaignResult.error
    if (queryError) {
      setDataError(queryError.message || 'Promotion data could not be loaded.')
      setLoadingData(false)
      return
    }

    const nextPackages = packageResult.data || []
    const nextListings = listingResult.data || []
    const nextCampaigns = campaignResult.data || []
    setPackages(nextPackages)
    setListings(nextListings)
    setCampaigns(nextCampaigns)
    if (!packageId && nextPackages[0]) setPackageId(nextPackages[0].id)
    const statResults = await Promise.all(nextCampaigns.map(async (campaign) => {
      const { data, error } = await supabase.rpc('get_my_promotion_stats', { p_promotion_id: campaign.id })
      return [campaign.id, error ? null : unwrap(data)]
    }))
    setStatsById(Object.fromEntries(statResults))
    setLoadingData(false)
  }

  const eligibleListings = useMemo(() => listings.filter((listing) => (
    targetType === 'service' ? listing.product_type === 'digital_service' : listing.product_type !== 'digital_service'
  )), [listings, targetType])
  const selectedTarget = targetType === 'storefront' ? profile : eligibleListings.find((listing) => listing.id === targetId)
  const selectedPackage = packages.find((item) => item.id === packageId)

  useEffect(() => {
    if (targetType === 'storefront') {
      setTargetId(profile?.id || '')
    } else if (!eligibleListings.some((listing) => listing.id === targetId)) {
      setTargetId(eligibleListings[0]?.id || '')
    }
  }, [targetType, targetId, profile?.id, eligibleListings])

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading…</div>
  if (!profile.verified_seller) return (
    <section className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Marketing</p>
      <h1 className="mt-3 font-display text-2xl font-bold text-ink">Verified sellers only</h1>
      <p className="mt-4 text-sm text-muted">Paid promotion is available once your seller profile is verified.</p>
      <button onClick={() => navigate('/sell')} className="mt-6 rounded-full bg-seal px-6 py-2.5 text-sm font-semibold text-white">Go to verification</button>
    </section>
  )

  async function payForPromotion() {
    if (!selectedTarget || !selectedPackage || !placements.length) return
    if (!window.PaystackPop) {
      setFeedback('Secure checkout is unavailable right now. Refresh the page and try again.')
      return
    }
    setSubmitting(true)
    setFeedback('')
    try {
      const { data: draftData, error: draftError } = await supabase.rpc('create_promotion_draft', {
        p_target_type: targetType,
        p_target_id: targetId,
        p_campaign_name: campaignName.trim() || selectedTarget.title || `${selectedTarget.business_name || 'Storefront'} promotion`,
        p_placements: placements,
        p_package_id: packageId,
      })
      if (draftError) throw draftError
      const draft = unwrap(draftData)
      const promotionId = draft?.promotion_id || draft?.id
      const amount = Number(draft?.amount ?? draft?.amount_ngn ?? draft?.price_ngn ?? draft?.package_price)
      if (!promotionId || !Number.isFinite(amount) || amount <= 0) throw new Error('The promotion draft did not return a valid promotion ID and price.')

      const handler = window.PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        email: session.user.email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        ref: `trustall_promo_${promotionId}_${Date.now()}`,
        callback: (response) => {
          ;(async () => {
            try {
              const { data: { session: activeSession } } = await supabase.auth.getSession()
              const verifyResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-verify-promotion-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession?.access_token}` },
                body: JSON.stringify({ reference: response.reference, promotion_id: promotionId }),
              })
              const result = await verifyResponse.json().catch(() => ({}))
              if (!verifyResponse.ok || result.error) throw new Error(result.error || 'Payment verification failed.')
              const status = result.status || result.promotion?.status
              if (status === 'active') setFeedback('Your promotion is live')
              else if (status === 'pending_review') setFeedback('Payment received, awaiting admin approval.')
              else throw new Error(`Payment was received, but promotion status is ${status || 'unavailable'}. Contact support with reference ${response.reference}.`)
              setScreen('dashboard')
              setStep(0)
              await loadDashboard()
            } catch (verifyError) {
              setFeedback(verifyError.message || 'Payment was received but could not be verified.')
            } finally {
              setSubmitting(false)
            }
          })()
        },
        onClose: () => setSubmitting(false),
      })
      handler.openIframe()
    } catch (createError) {
      setFeedback(createError.message || 'Promotion checkout could not be started.')
      setSubmitting(false)
    }
  }

  async function showAnalytics(campaign) {
    setSelectedAnalytics(campaign.id)
    const { data, error } = await supabase.rpc('get_my_promotion_stats', { p_promotion_id: campaign.id })
    if (error) setFeedback(error.message || 'Promotion analytics could not be loaded.')
    else setStatsById((current) => ({ ...current, [campaign.id]: unwrap(data) }))
  }

  const metrics = [
    { label: 'Active promotions', value: campaigns.filter((item) => item.status === 'active').length, icon: Check },
    { label: 'Total impressions', value: campaigns.length && campaigns.every((item) => readMetric(statsById[item.id], ['impressions', 'total_impressions']) !== null) ? campaigns.reduce((sum, item) => sum + readMetric(statsById[item.id], ['impressions', 'total_impressions']), 0) : null, icon: Eye },
    { label: 'Total clicks', value: campaigns.length && campaigns.every((item) => readMetric(statsById[item.id], ['clicks', 'total_clicks']) !== null) ? campaigns.reduce((sum, item) => sum + readMetric(statsById[item.id], ['clicks', 'total_clicks']), 0) : null, icon: MousePointer2 },
    { label: 'Orders from promotions', value: campaigns.length && campaigns.every((item) => readMetric(statsById[item.id], ['orders_from_promotions', 'orders', 'purchases']) !== null) ? campaigns.reduce((sum, item) => sum + readMetric(statsById[item.id], ['orders_from_promotions', 'orders', 'purchases']), 0) : null, icon: BarChart3 },
  ]

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-seal">Seller dashboard / Marketing</p><h1 className="mt-2 font-display text-3xl font-bold text-ink">Promote your business</h1><p className="mt-2 text-sm text-muted">Launch a promotion and follow its performance.</p></div>
        {screen === 'create' ? <button type="button" onClick={() => { setScreen('dashboard'); setFeedback('') }} className="inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-sm font-semibold text-ink"><ArrowLeft size={16} /> Campaigns</button> : <button type="button" onClick={() => { setScreen('create'); setStep(0); setFeedback('') }} className="inline-flex items-center gap-2 rounded-full bg-seal px-5 py-3 text-sm font-semibold text-white"><CircleDollarSign size={16} /> Promote</button>}
      </div>
      {feedback && <p role="status" className="mt-5 rounded-xl border border-seal/20 bg-seal/5 p-4 text-sm text-seal">{feedback}</p>}
      {dataError && <p role="alert" className="mt-5 rounded-xl border border-marigold/30 bg-marigold/10 p-4 text-sm text-marigold-deep">{dataError}</p>}

      {screen === 'create' ? <div className="mt-8 max-w-3xl">
        <div className="mb-6 flex flex-wrap gap-2">{['What to promote', 'Placements', 'Package', 'Review & pay'].map((label, index) => <span key={label} className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase ${index === step ? 'bg-seal text-white' : 'border border-hairline text-muted'}`}>{index + 1}. {label}</span>)}</div>
        <div className="seller-panel p-5 sm:p-7">
          {step === 0 && <><h2 className="font-display text-xl font-bold text-ink">Choose what to promote</h2><div className="mt-4 grid grid-cols-3 gap-2">{TARGET_TYPES.map((item) => <button type="button" key={item.id} onClick={() => { setTargetType(item.id); setTargetId(item.id === 'storefront' ? profile.id : '') }} className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${targetType === item.id ? 'border-seal bg-seal/5 text-seal' : 'border-hairline text-muted'}`}>{item.label}</button>)}</div>{targetType === 'storefront' ? <div className="mt-5 rounded-lg border border-seal/20 bg-seal/5 p-4"><p className="font-semibold text-ink">{profile.business_name || profile.full_name || 'Your storefront'}</p><p className="mt-1 text-xs text-muted">Your seller storefront will be featured.</p></div> : eligibleListings.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{eligibleListings.map((listing) => <button type="button" key={listing.id} onClick={() => setTargetId(listing.id)} className={`rounded-lg border p-4 text-left ${targetId === listing.id ? 'border-seal bg-seal/5' : 'border-hairline'}`}><span className="block truncate font-semibold text-ink">{listing.title}</span><span className="mt-1 block truncate text-xs text-muted">{listing.category || itemLabel(targetType)} · {naira(listing.price || 0)}</span></button>)}</div> : <p className="mt-5 rounded-lg bg-surfacealt p-4 text-sm text-muted">No active {targetType === 'service' ? 'services or gigs' : 'products'} found. Add one in your seller dashboard first.</p>}{selectedTarget && <div className="mt-5 flex gap-4 border-t border-hairline pt-4">{selectedTarget.images && <img src={listingImage(selectedTarget.images)} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />}<div><p className="font-mono text-[10px] uppercase text-muted">Selected preview</p><p className="mt-1 font-display text-lg font-bold text-ink">{selectedTarget.title || profile.business_name || profile.full_name}</p><p className="mt-1 line-clamp-2 text-sm text-muted">{selectedTarget.description || 'Your storefront will be shown to marketplace visitors.'}</p></div></div>}<label className="mt-5 block text-xs font-semibold text-ink">Campaign name <span className="font-normal text-muted">(optional)</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="e.g. New season launch" className="mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-3 text-sm" /></label></>}
          {step === 1 && <><h2 className="font-display text-xl font-bold text-ink">Choose placements</h2><p className="mt-1 text-sm text-muted">Select where this promotion can appear.</p><div className="mt-5 grid gap-2 sm:grid-cols-2">{PROMOTION_PLACEMENTS.map((item) => <label key={item.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-hairline px-3"><input type="checkbox" checked={placements.includes(item.id)} onChange={(event) => setPlacements((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="h-4 w-4 accent-emerald-800" /><span className="text-sm text-ink">{item.label}</span></label>)}</div></>}
          {step === 2 && <><h2 className="font-display text-xl font-bold text-ink">Choose a package</h2>{loadingData ? <p className="mt-5 text-sm text-muted">Loading active packages…</p> : packages.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{packages.map((item) => <button type="button" key={item.id} onClick={() => setPackageId(item.id)} className={`rounded-lg border p-4 text-left ${packageId === item.id ? 'border-seal bg-seal/5' : 'border-hairline'}`}><span className="block font-semibold text-ink">{item.name}</span><span className="mt-1 block text-xs text-muted">{item.duration_days ?? item.duration} days</span><span className="mt-3 block font-mono text-lg font-bold text-seal">{naira(packagePrice(item))}</span></button>)}</div> : <p className="mt-5 text-sm text-muted">No active promotion packages are available right now.</p>}</>}
          {step === 3 && <><h2 className="font-display text-xl font-bold text-ink">Review promotion</h2><dl className="mt-5 divide-y divide-hairline rounded-lg border border-hairline px-4"><div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-muted">Campaign</dt><dd className="text-right font-semibold text-ink">{campaignName.trim() || selectedTarget?.title || selectedTarget?.business_name || 'Promotion'}</dd></div><div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-muted">Placement(s)</dt><dd className="text-right text-ink">{placements.map((id) => PROMOTION_PLACEMENTS.find((item) => item.id === id)?.label).filter(Boolean).join(', ')}</dd></div><div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-muted">Package</dt><dd className="text-right font-semibold text-ink">{selectedPackage?.name} · {selectedPackage?.duration_days ?? selectedPackage?.duration} days</dd></div><div className="flex justify-between gap-4 py-3 text-sm"><dt className="text-muted">Package price</dt><dd className="font-mono font-bold text-seal">{naira(packagePrice(selectedPackage))}</dd></div></dl><p className="mt-3 text-xs text-muted">The server creates your draft and supplies the checkout amount. The amount shown comes from the selected active package.</p><button type="button" disabled={submitting || !selectedPackage || packagePrice(selectedPackage) === null} onClick={payForPromotion} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-seal px-5 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Starting secure checkout…' : <>Pay securely <ArrowRight size={16} /></>}</button></>}
          {step < 3 && <div className="mt-6 flex justify-between gap-3"><button type="button" disabled={step === 0} onClick={() => setStep((current) => current - 1)} className="rounded-lg border border-hairline px-4 py-2 text-sm disabled:opacity-40">Back</button><button type="button" onClick={() => setStep((current) => current + 1)} disabled={step === 0 ? (!selectedTarget || targetType !== 'storefront' && !eligibleListings.length) : step === 1 ? placements.length === 0 : !packageId || packagePrice(selectedPackage) === null} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Continue <ArrowRight size={15} /></button></div>}
        </div>
      </div> : <>
        {!loadingData && campaigns.length > 0 && <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, icon: Icon }) => <div key={label} className="seller-panel p-4"><Icon size={17} className="text-seal" /><p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-display text-2xl font-bold text-ink">{value === null ? 'Unavailable' : Number(value).toLocaleString()}</p></div>)}</div>}
        {loadingData && <p className="mt-8 text-sm text-muted">Loading your campaigns…</p>}
        {!loadingData && !campaigns.length && !dataError && <div className="seller-panel mt-8 p-7 text-center"><BarChart3 size={26} className="mx-auto text-seal" /><h2 className="mt-3 font-display text-xl font-bold text-ink">No promotions yet</h2><p className="mt-2 text-sm text-muted">Your campaigns and performance will appear here after you launch one.</p><button type="button" onClick={() => setScreen('create')} className="mt-5 rounded-lg bg-seal px-5 py-3 text-sm font-semibold text-white">Create a promotion</button></div>}
        {campaigns.length > 0 && <section className="mt-8"><h2 className="font-display text-xl font-bold text-ink">Your campaigns</h2><div className="mt-4 grid gap-3">{campaigns.map((campaign) => <article key={campaign.id} className="seller-panel p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-ink">{campaign.target_type === 'storefront' ? profile.business_name || profile.full_name : listings.find((item) => item.id === campaign.target_id)?.title || campaign.campaign_name || 'Promotion'}</p><p className="mt-1 text-xs text-muted">{campaign.campaign_name || 'Promotion'} · {campaign.starts_at || campaign.start_at ? new Date(campaign.starts_at || campaign.start_at).toLocaleDateString() : campaign.created_at ? new Date(campaign.created_at).toLocaleDateString() : 'Start date unavailable'}{(campaign.ends_at || campaign.end_at) ? ` – ${new Date(campaign.ends_at || campaign.end_at).toLocaleDateString()}` : ''}</p></div><span className="rounded-full bg-seal/10 px-3 py-1 font-mono text-[10px] uppercase text-seal">{String(campaign.status || 'unknown').replace(/_/g, ' ')}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3"><p className="font-mono text-sm font-semibold text-ink">{campaign.amount != null ? naira(campaign.amount) : campaign.payment_amount != null ? naira(campaign.payment_amount) : 'Amount unavailable'}</p><button type="button" onClick={() => showAnalytics(campaign)} className="inline-flex items-center gap-2 text-sm font-semibold text-seal"><BarChart3 size={15} /> View analytics</button></div>{selectedAnalytics === campaign.id && statsById[campaign.id] && <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surfacealt p-3 sm:grid-cols-4">{Object.entries(statsById[campaign.id]).filter(([, value]) => typeof value === 'number' || typeof value === 'string' && value !== '').map(([key, value]) => <div key={key}><p className="font-mono text-[9px] uppercase text-muted">{key.replace(/_/g, ' ')}</p><p className="mt-1 text-sm font-semibold text-ink">{value}</p></div>)}</div>}</article>)}</div></section>}
      </>}
    </section>
  )
}

function itemLabel(type) {
  return type === 'service' ? 'Service' : 'Product'
}
