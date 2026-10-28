import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getPublicSiteHost } from '../lib/authRedirect.js'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { ensureNotificationPermission, notifyConversationEvent } from '../lib/notifications.js'
import { LISTING_CATEGORIES } from '../lib/listingCategories.js'
import ServiceGigWizard from '../components/ServiceGigWizard.jsx'
import { NIGERIAN_BANKS } from '../lib/nigerianBanks.js'
import { safeFileName } from '../lib/inputSafety.js'
import { PUBLIC_PROFILE_COLUMNS } from '../lib/profileFields.js'
import { useBalanceVisibility } from '../lib/useBalanceVisibility.js'
import { formatBalance } from '../lib/balanceDisplay.js'
import BalanceToggle from '../components/BalanceToggle.jsx'

async function uploadAvatar(file, userId) {
  if (!file) return null
  const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
  if (error) {
    console.error('Avatar upload error:', error)
    if ((error.message || '').toLowerCase().includes('bucket')) {
      throw new Error("Storage bucket 'avatars' not found. Create a public bucket named 'avatars' in Supabase storage or run the migration 0005_avatar_storage.sql.")
    }
    throw error
  }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River',
  'Delta','Ebonyi','Edo','Ekiti','Enugu','FCT (Abuja)','Gombe','Imo','Jigawa','Kaduna','Kano',
  'Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
  'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
]

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export default function Sell() {
  const { session, profile, setProfile, loading } = useProfile()
  const navigate = useNavigate()
  const [salesSummary, setSalesSummary] = useState({ totalRevenue: 0, completedOrders: 0, liveOrders: 0 })
  const [loadingSales, setLoadingSales] = useState(true)

  useEffect(() => {
    if (!loading && !session) {
      navigate('/auth', { state: { redirectTo: '/sell' } })
    }
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session?.user?.id) return

    async function loadSellerSales() {
      setLoadingSales(true)

      const { data, error } = await supabase
        .from('orders')
        .select('id, status, seller_payout, amount, delivery_fee, created_at, confirmed_at')
        .eq('seller_id', session.user.id)
        .in('status', ['paid', 'fulfilled', 'confirmed'])
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to load seller sales metrics:', error)
        setSalesSummary({ totalRevenue: 0, completedOrders: 0, liveOrders: 0 })
        setLoadingSales(false)
        return
      }

      const completed = (data || []).filter((row) => row.status === 'confirmed')
      const live = (data || []).filter((row) => ['paid', 'fulfilled'].includes(row.status))

      setSalesSummary({
        totalRevenue: completed.reduce((sum, row) => sum + Number(row.seller_payout || 0), 0),
        completedOrders: completed.length,
        liveOrders: live.length,
      })
      setLoadingSales(false)
    }

    loadSellerSales()

    const channel = supabase
      .channel(`seller-sales-${session.user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `seller_id=eq.${session.user.id}` }, loadSellerSales)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session?.user?.id])

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-16">
      <div className="seller-hero overflow-hidden rounded-[30px] border border-seal/20 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-seal-light">Seller dashboard</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-ink sm:text-4xl">
              {profile.business_name || profile.full_name || 'Your seller space'}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Keep your storefront, orders, payouts, and trust signals moving in one premium workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="seller-badge bg-white/15 text-white">{profile.verified_seller ? 'Verified seller' : 'Profile setup'}</span>
            <span className="seller-badge bg-white/10 text-white/90">{profile.handle ? `@${profile.handle}` : 'Complete profile'}</span>
            <Link
              to="/marketing"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-2.5 font-mono text-xs font-semibold text-white transition hover:bg-white/20 sm:w-auto"
            >
              Marketing
            </Link>
            <Link
              to={`/seller/${encodeURIComponent(profile.handle || profile.id)}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 font-mono text-xs font-semibold text-seal transition hover:bg-seal-light sm:w-auto"
            >
              View storefront <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </div>

      <SellerSalesOverview salesSummary={salesSummary} loadingSales={loadingSales} profile={profile} />
      <SellerOrderManager session={session} />
      <ProfileSetup profile={profile} setProfile={setProfile} session={session} />
      <VerificationBlock profile={profile} session={session} />
      <PayoutBlock profile={profile} setProfile={setProfile} session={session} />
      <ListingsBlock profile={profile} session={session} />
    </section>
  )
}

function SellerSalesOverview({ salesSummary, loadingSales, profile }) {
  const { hidden: balancesHidden, toggle: toggleBalances } = useBalanceVisibility()
  return (
    <section className="seller-panel mt-8 overflow-hidden bg-gradient-to-br from-seal via-[#24654d] to-[#1a4637] p-5 text-white shadow-[0_24px_60px_rgba(31,77,56,0.2)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-seal-light">Overview</p>
          <h2 className="mt-2 font-display text-xl font-bold sm:text-2xl">Your business at a glance</h2>
        </div>
        <div className="flex items-center gap-2">
          <BalanceToggle hidden={balancesHidden} onToggle={toggleBalances} className="border border-white/20 bg-white/10 text-white/90 hover:bg-white/20" />
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/90">
            Live
          </span>
        </div>
      </div>

      <div className="mt-5 grid divide-y divide-white/15 border-t border-white/15 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <div className="py-4 sm:px-4 sm:first:pl-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/70">Revenue</p>
          <p className="mt-2 font-display text-2xl font-bold text-white">
            {loadingSales ? '…' : formatBalance(salesSummary.totalRevenue, balancesHidden)}
          </p>
        </div>
        <div className="py-4 sm:px-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/70">Completed</p>
          <p className="mt-2 font-display text-2xl font-bold text-white">
            {loadingSales ? '…' : Number(salesSummary.completedOrders || 0)}
          </p>
        </div>
        <div className="py-4 sm:px-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/70">Active</p>
          <p className="mt-2 font-display text-2xl font-bold text-white">
            {loadingSales ? '…' : Number(salesSummary.liveOrders || 0)}
          </p>
        </div>
        <div className="py-4 sm:px-4 sm:last:pr-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/80">Available</p>
          <p className="mt-2 font-display text-2xl font-bold text-marigold-soft">
            {loadingSales ? '…' : formatBalance(profile?.wallet_cleared, balancesHidden)}
          </p>
        </div>
      </div>
    </section>
  )
}

function SellerOrderManager({ session }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyOrderId, setBusyOrderId] = useState(null)

  useEffect(() => {
    if (!session?.user?.id) return

    async function loadOrders() {
      setLoading(true)
      const { data, error } = await supabase
        .from('orders')
        .select('*, offer:offer_id(item_title, price, delivery_fee), buyer:buyer_id(id, full_name, business_name)')
        .eq('seller_id', session.user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Seller order load failed:', error)
        setOrders([])
      } else {
        setOrders(data || [])
      }

      setLoading(false)
    }

    loadOrders()

    const channel = supabase
      .channel(`seller-order-manager-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${session.user.id}` }, loadOrders)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session?.user?.id])

  async function markAsDelivered(orderId) {
    if (!orderId) return
    setBusyOrderId(orderId)

    try {
      const { data, error } = await supabase.rpc('mark_order_fulfilled', { p_order_id: orderId })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to mark as delivered.')

      setOrders((prev) => prev.map((order) => order.id === orderId
        ? { ...order, status: 'fulfilled', fulfilled_at: new Date().toISOString() }
        : order
      ))
    } catch (err) {
      console.error('Failed to mark order as delivered:', err)
      alert(err.message || 'Failed to mark as delivered. Please try again.')
    } finally {
      setBusyOrderId(null)
    }
  }

  if (loading) return <div className="mt-8 text-sm text-muted">Loading seller order pipeline…</div>

  return (
    <section className="seller-panel mt-10 p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Seller order management</p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">Your orders</h2>
        </div>
        <span className="rounded-full bg-seal/10 px-3 py-1 font-mono text-[10px] font-semibold text-seal">{orders.length} total</span>
      </div>

      {orders.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-hairline bg-surfacealt/60 p-6 text-center text-sm text-muted">
          No orders yet.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {orders.map((order) => (
          <article key={order.id} className="rounded-2xl border border-hairline bg-surfacealt p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-sm font-semibold text-ink">{order.offer?.item_title || 'Order'}</p>
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Buyer: {order.buyer?.business_name || order.buyer?.full_name || 'Buyer'} · {new Date(order.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 font-mono text-[10px] font-semibold ${order.status === 'fulfilled' ? 'bg-amber-100 text-amber-900' : order.status === 'paid' ? 'bg-blue-100 text-blue-900' : ['confirmed', 'completed', 'complete'].includes(order.status) ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-gray-900'}`}>
                  {order.status === 'fulfilled' ? 'Delivered — Awaiting buyer confirmation' : order.status}
                </span>
                {order.status === 'paid' && (
                  <button
                    onClick={() => markAsDelivered(order.id)}
                    disabled={busyOrderId === order.id}
                    className="rounded-full bg-seal px-4 py-2 font-mono text-[10px] font-bold text-white hover:bg-seal-deep disabled:opacity-50"
                  >
                    {busyOrderId === order.id ? 'Updating...' : 'Mark as Delivered'}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ProfileSetup({ profile, setProfile, session }) {
  const [businessName, setBusinessName] = useState(profile.business_name || '')
  const [handle, setHandle] = useState(profile.handle || '')
  const [state, setState] = useState(profile.state || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [avatarFile, setAvatarFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const publicSiteHost = getPublicSiteHost()

  const complete = profile.business_name && profile.handle && profile.state && profile.phone

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const cleanHandle = slugify(handle)
    let avatarUrl = profile.avatar_url || profile.business_logo_url || null
    try {
      if (avatarFile) avatarUrl = await uploadAvatar(avatarFile, session.user.id)
    } catch (uploadErr) {
      setSaving(false)
      setError(uploadErr.message)
      return
    }
    const { data, error } = await supabase
      .from('profiles')
      .update({ business_name: businessName, handle: cleanHandle, state, bio: bio.trim(), avatar_url: avatarUrl })
      .eq('id', session.user.id)
      .select(PUBLIC_PROFILE_COLUMNS)
      .single()
    if (error) {
      setSaving(false)
      setError(error.message.includes('duplicate') ? 'That handle is already taken — try another.' : error.message)
      return
    }
    const { error: contactError } = await supabase
      .from('profile_contacts')
      .upsert({ id: session.user.id, phone: phone.trim(), updated_at: new Date().toISOString() })
    setSaving(false)
    if (contactError) {
      // 23514: the database's phone format check rejected the number.
      setError(contactError.code === '23514' ? 'Enter a valid phone number: digits, spaces, + and - only.' : contactError.message)
      return
    }
    // Merge: the update only returns public columns, so keep the private ones already loaded.
    setProfile((current) => ({ ...current, ...data, phone: phone.trim() }))
    setSaved(true)
  }

  return (
    <div className="seller-panel mt-10 p-4 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Profile</p>
          <h2 className="mt-1 font-display text-lg text-ink">Your seller profile</h2>
        </div>
        {complete && <span className="rounded-full bg-seal/10 px-3 py-1 font-mono text-[10px] font-semibold text-seal">✓ complete</span>}
      </div>
      <form onSubmit={save} className="seller-profile-form mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
        <input
          required placeholder="Business or shop name" value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <div className="flex min-w-0 items-center rounded-xl border border-hairline bg-surfacealt px-3 py-3 focus-within:border-seal sm:px-4">
            <span className="max-w-[46%] shrink-0 break-all font-mono text-xs text-muted sm:text-sm">{publicSiteHost}/</span>
            <input
              required placeholder="your-handle" value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink placeholder:text-muted outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-muted">This is your shareable profile link.</p>
        </div>
        <select
          required value={state} onChange={(e) => setState(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink focus:border-seal outline-none"
        >
          <option value="">State</option>
          {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          required placeholder="Phone number" value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
        />
        <div className="sm:col-span-2">
          <label className="block text-xs text-muted" htmlFor="seller-bio">Seller bio</label>
          <textarea
            id="seller-bio"
            value={bio}
            maxLength={300}
            rows={4}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell buyers what you sell and what makes your business trustworthy."
            className="mt-1 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
          />
          <p className="mt-1 text-right text-xs text-muted">{bio.length}/300</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-muted">Profile photo or business logo</label>
          <input type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files[0])} className="mt-1 w-full text-sm text-muted" />
        </div>
        {error && <p className="text-sm text-marigold-deep sm:col-span-2">{error}</p>}
        <button
          type="submit" disabled={saving}
          className="w-full rounded-full bg-ink px-6 py-3 font-body text-sm font-medium text-surface hover:bg-inksoft disabled:opacity-50 sm:col-span-2 sm:w-fit"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <p className="text-sm text-seal sm:col-span-2">Saved.</p>}
      </form>
    </div>
  )
}

function VerificationBlock({ profile, session }) {
  const [existing, setExisting] = useState(undefined)
  const [legalName, setLegalName] = useState('')
  const [idType, setIdType] = useState('NIN')
  const [idNumber, setIdNumber] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('verification_requests').select('*').eq('seller_id', session.user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setExisting(data))
  }, [session.user.id])

  async function submit(e) {
    e.preventDefault()
    if (!file) { setError('Please attach a photo of your ID or CAC certificate.'); return }
    setSubmitting(true)
    setError('')

    const path = `${session.user.id}/${Date.now()}-${safeFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from('verification-docs').upload(path, file)
    if (uploadError) { setSubmitting(false); setError(uploadError.message); return }

    const { data, error } = await supabase.from('verification_requests').insert({
      seller_id: session.user.id,
      legal_name: legalName,
      id_type: idType,
      id_number: idNumber,
      document_url: path,
    }).select().single()

    setSubmitting(false)
    if (error) { setError(error.message); return }
    setExisting(data)
  }

  if (profile.verified_seller) {
    return (
      <div className="seller-panel mt-6 border-seal/30 bg-seal/5 p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Verification</p>
        <h2 className="mt-1 font-display text-lg text-ink">Seller verification</h2>
        <p className="mt-2 text-sm text-seal">✓ You're a verified seller — Level {profile.seller_level} badge active.</p>
      </div>
    )
  }

  if (existing === undefined) return null

  if (existing && existing.status === 'pending') {
    return (
      <div className="seller-panel mt-6 p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Verification</p>
        <h2 className="mt-1 font-display text-lg text-ink">Seller verification</h2>
        <p className="mt-2 text-sm text-muted">
          Submitted, under review — verification is free and takes up to 3 business days.
        </p>
      </div>
    )
  }

  return (
    <div className="seller-panel mt-6 p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Verification</p>
      <h2 className="mt-1 font-display text-lg text-ink">Get verified — free, always</h2>
      <p className="mt-1 text-sm text-muted">
        Verified sellers get a trust badge on every listing. Takes up to 3 business days to review.
      </p>
      {existing?.status === 'rejected' && (
        <p className="mt-2 text-sm text-marigold-deep">
          Your last submission wasn't approved{existing.rejection_reason ? `: ${existing.rejection_reason}` : ''}. Please check your details and try again.
        </p>
      )}
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <input
          required placeholder="Full legal / business name" value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none sm:col-span-2"
        />
        <select
          value={idType} onChange={(e) => setIdType(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink focus:border-seal outline-none"
        >
          <option value="NIN">NIN</option>
          <option value="CAC">CAC</option>
        </select>
        <input
          required placeholder={idType === 'NIN' ? 'NIN number' : 'CAC registration number'} value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
        />
        <div className="sm:col-span-2">
          <label className="block text-xs text-muted">Photo of your ID slip or CAC certificate</label>
          <input
            required type="file" accept="image/*,.pdf"
            onChange={(e) => setFile(e.target.files[0])}
            className="mt-1 w-full text-sm text-muted"
          />
        </div>
        {error && <p className="text-sm text-marigold-deep sm:col-span-2">{error}</p>}
        <button
          type="submit" disabled={submitting}
          className="rounded-full bg-seal px-6 py-2.5 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50 sm:col-span-2 sm:w-fit"
        >
          {submitting ? 'Submitting…' : 'Submit for verification'}
        </button>
      </form>
    </div>
  )
}

function PayoutBlock({ profile, setProfile, session }) {
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const isLegacySeller = profile?.is_seller && !profile?.paystack_recipient_code

  if (profile.paystack_recipient_code) {
    return (
      <div className="seller-panel mt-6 border-seal/30 bg-seal/5 p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Payout</p>
        <h2 className="mt-1 font-display text-lg text-ink">Payout account</h2>
        <p className="mt-2 text-sm text-seal">✓ Connected — Paystack routes your share automatically at checkout.</p>
      </div>
    )
  }

  async function connect(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const { data: { session: activeSession } } = await supabase.auth.getSession()
      if (!activeSession?.access_token) throw new Error('Please sign in again before connecting your payout account.')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-create-subaccount`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.access_token}` },
          body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber }),
        }
      )
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result.success || !result.recipient_code) {
        const message = result.error || `The payout setup could not be completed (HTTP ${res.status}).`
        const diagnostic = typeof result.diagnostic === 'string'
          ? result.diagnostic
          : result.diagnostic ? JSON.stringify(result.diagnostic) : ''
        throw new Error([message, diagnostic].filter(Boolean).join(' '))
      }

      setProfile((currentProfile) => ({ ...currentProfile, paystack_recipient_code: result.recipient_code }))
    } catch (connectError) {
      setError(connectError.message || 'The payout setup could not be completed right now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {isLegacySeller && (
        <div className="seller-panel mt-6 border-marigold/40 bg-marigold/10 p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-marigold-deep">Payout</p>
          <h2 className="mt-1 font-display text-lg text-marigold-deep">Payout setup needed</h2>
          <p className="mt-2 text-sm text-marigold-deep">
            Your payout settings need to be updated. The old bank connection method no longer works for payments. Please reconnect your bank details below to continue receiving payments from your sales.
          </p>
        </div>
      )}
      <div className="seller-panel mt-6 p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Payout</p>
      <h2 className="mt-1 font-display text-lg text-ink">Connect your payout account</h2>
      <p className="mt-1 text-sm text-muted">
        Paystack automatically splits every sale at checkout — your share (5% fee, capped at
        ₦5,000) settles to this account on Paystack's standard schedule.
      </p>
      <form onSubmit={connect} className="mt-5 grid gap-4 sm:grid-cols-2">
        <select
          required value={bankCode} onChange={(e) => setBankCode(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink focus:border-seal outline-none"
        >
          <option value="">Select your bank</option>
          {NIGERIAN_BANKS.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
        </select>
        <input
          required placeholder="Account number" value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
        />
        {error && <p className="text-sm text-marigold-deep sm:col-span-2">{error}</p>}
        <button
          type="submit" disabled={submitting}
          className="rounded-full bg-ink px-6 py-2.5 font-body text-sm font-medium text-surface hover:bg-inksoft disabled:opacity-50 sm:col-span-2 sm:w-fit"
        >
          {submitting ? 'Connecting…' : 'Connect account'}
        </button>
      </form>
      </div>
    </>
  )
}

function ListingsBlock({ profile, session }) {
  const [listings, setListings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingServiceListing, setEditingServiceListing] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState(LISTING_CATEGORIES[0])
  const [file, setFile] = useState(null)
  const [productType, setProductType] = useState('physical')
  const [digitalFile, setDigitalFile] = useState(null)
  const [variants, setVariants] = useState([{ name: '', value: '' }])
  const [servicesIncluded, setServicesIncluded] = useState([{ name: '' }])
  const [mediaFiles, setMediaFiles] = useState([])
  const [acceptedEscrow, setAcceptedEscrow] = useState(false)
  const [acceptedDescription, setAcceptedDescription] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadListings() }, [])

  useEffect(() => {
    if (!showForm) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !submitting) setShowForm(false)
    }
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [showForm, submitting])

  async function loadListings() {
    const { data } = await supabase.from('listings').select('*').eq('seller_id', session.user.id)
      .order('created_at', { ascending: false })
    setListings(data || [])
  }

  async function uploadListingMedia(listingId, files) {
    if (!files || files.length === 0) return []
    const imageUrls = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const filePath = `${session.user.id}/${listingId}/${Date.now()}_${index}_${safeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage.from('listing-images').upload(filePath, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('listing-images').getPublicUrl(filePath)
      imageUrls.push(publicData.publicUrl)
    }

    return imageUrls
  }

  async function submit(e) {
    e.preventDefault()
    if (!acceptedEscrow || !acceptedDescription) {
      setError('You must confirm both listing and escrow requirements before publishing.')
      return
    }

    setSubmitting(true)
    setError('')
    let variantError = false
    let publishSucceeded = false
    try {

    let imageUrl = null
    if (file) {
      const path = `${session.user.id}/${Date.now()}-${safeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, file)
      if (uploadError) throw uploadError
      const { data: pub } = supabase.storage.from('listing-images').getPublicUrl(path)
      imageUrl = pub.publicUrl
    }

    let digitalFilePath = null
    if (productType === 'digital_instant') {
      if (!digitalFile && !editingId) throw new Error('Please attach the file buyers will receive.')
      if (digitalFile) {
        digitalFilePath = `${session.user.id}/${Date.now()}-${safeFileName(digitalFile.name)}`
        const { error: digitalUploadError } = await supabase.storage.from('digital-products').upload(digitalFilePath, digitalFile)
        if (digitalUploadError) throw digitalUploadError
      }
    }

    // Convert services_included to array of strings (only for service categories)
    const isServiceCategory = category === 'Freelance & Digital Services' || category === 'Other Services'
    const normalizedServices = isServiceCategory
      ? servicesIncluded.filter(s => s.name.trim()).map(s => s.name.trim())
      : null

    const slug = `${slugify(title)}-${Date.now().toString(36)}`

    // Step 1: Create or update the listing (WITHOUT variant data)
    const payload = {
      seller_id: session.user.id,
      title,
      description,
      price: Number(price),
      category,
      slug,
      images: imageUrl ? [imageUrl] : [],
      product_type: productType,
      digital_file_path: digitalFilePath,
      services_included: normalizedServices,
      status: 'pending_review',
      is_active: false,
      moderation_reason: null,
    }

    let newListingId = editingId
    if (editingId) {
      const { error } = await supabase.from('listings').update(payload).eq('id', editingId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('listings').insert(payload).select().single()
      if (error) throw error
      newListingId = data?.id
    }

    if (newListingId && mediaFiles.length > 0) {
      const mediaUrls = await uploadListingMedia(newListingId, mediaFiles)
      const { error: mediaUpdateError } = await supabase
        .from('listings')
        .update({ images: [...(imageUrl ? [imageUrl] : []), ...mediaUrls] })
        .eq('id', newListingId)
      if (mediaUpdateError) throw mediaUpdateError
    }

    // Step 2: Handle variants (only for physical products)
    if (productType === 'physical' && newListingId) {
      const normalizedVariants = variants
        .map((v) => ({ name: v.name.trim(), value: v.value.trim(), priceAdjustment: v.priceAdjustment || 0 }))
        .filter((v) => v.name && v.value)

      if (normalizedVariants.length > 0) {
        // First, delete any existing variants for this listing (if updating)
        if (editingId) {
          await supabase.from('listing_variants').delete().eq('listing_id', newListingId)
        }

        // Insert new variants
        const variantRows = normalizedVariants.map(v => ({
          listing_id: newListingId,
          variant_name: v.name,
          variant_value: v.value,
          price_adjustment: v.priceAdjustment,
        }))

        const { error: insertError } = await supabase.from('listing_variants').insert(variantRows)
        if (insertError) {
          console.error('Variant insertion error:', insertError)
          variantError = true
        }
      }
    }

    publishSucceeded = true

    } catch (submitError) {
      console.error('Failed to publish listing:', submitError)
      setError(submitError.message || 'Unable to publish this listing right now.')
    } finally {
      setSubmitting(false)
    }
    if (!publishSucceeded) return
    setTitle(''); setDescription(''); setPrice(''); setFile(null); setDigitalFile(null); setMediaFiles([]); setProductType('physical'); setVariants([{ name: '', value: '' }]); setServicesIncluded([{ name: '' }]); setAcceptedEscrow(false); setAcceptedDescription(false); setShowForm(false); setEditingId(null)
    
    if (variantError) {
      setError('Listing created, but some variants failed to save. You can edit the listing to add them again.')
    }

    await ensureNotificationPermission()
    await notifyConversationEvent({
      emailSelf: true,
      title: editingId ? 'Listing updated' : 'New listing published',
      body: editingId ? 'Your listing has been updated on Trustall.' : 'Your new listing is now live on Trustall.',
      preview: editingId ? 'Your listing has been updated on Trustall.' : 'Your new listing is now live on Trustall.',
    })
    loadListings()
  }

  async function startEdit(listing) {
    if (listing.product_type === 'digital_service') {
      setEditingServiceListing(listing)
      setEditingId(listing.id)
      setProductType('digital_service')
      setShowForm(true)
      return
    }
    setEditingId(listing.id)
    setShowForm(true)
    setTitle(listing.title)
    setDescription(listing.description || '')
    setPrice(listing.price?.toString() || '')
    setCategory(listing.category || LISTING_CATEGORIES[0])
    setProductType(listing.product_type || 'physical')
    
    // Load variants if they exist (physical products only)
    if (listing.product_type === 'physical') {
      const { data: variants } = await supabase
        .from('listing_variants')
        .select('*')
        .eq('listing_id', listing.id)
      
      if (variants && variants.length > 0) {
        setVariants(variants.map(v => ({
          name: v.variant_name,
          value: v.variant_value,
          priceAdjustment: v.price_adjustment || 0,
        })))
      } else {
        setVariants([{ name: '', value: '' }])
      }
    } else {
      setVariants([{ name: '', value: '' }])
    }
    
    // Load services if they exist (service products only)
    if (listing.product_type === 'digital_service' && Array.isArray(listing.services_included)) {
      setServicesIncluded(listing.services_included.map(s => ({ name: s })))
    } else {
      setServicesIncluded([{ name: '' }])
    }
    
    setFile(null)
    setDigitalFile(null)
  }

  async function deleteListing(id) {
    if (!window.confirm('Delete this listing from your seller page?')) return
    const { error } = await supabase.from('listings').delete().eq('id', id)
    if (!error) loadListings()
  }

  const needsProfile = !(profile.business_name && profile.handle)

  return (
    <div className="seller-panel mt-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Listings</p>
          <h2 className="mt-1 font-display text-lg text-ink">Your storefront</h2>
        </div>
        {!needsProfile && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-full bg-seal px-5 py-2 font-body text-sm font-semibold text-white hover:bg-seal-deep"
          >
            {showForm ? 'Cancel' : '+ New listing'}
          </button>
        )}
      </div>

      {needsProfile && (
        <p className="mt-3 text-sm text-muted">Complete your seller profile above before adding listings.</p>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/55 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setShowForm(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="listing-dialog-title"
            className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] border border-hairline bg-surface shadow-2xl sm:max-h-[90dvh] sm:rounded-[28px]"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline bg-white px-5 py-4 sm:px-7">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-seal">Your storefront</p>
                <h2 id="listing-dialog-title" className="mt-1 font-display text-lg font-bold text-ink">
                  {editingId ? 'Edit listing' : 'Create a listing'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                aria-label="Close listing form"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-hairline text-xl text-muted transition hover:border-seal hover:text-seal disabled:opacity-50"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-7">
              {productType === 'digital_service' ? (
                <ServiceGigWizard
                  session={session}
                  existingListing={editingServiceListing}
                  onCancel={() => { setShowForm(false); setProductType('physical'); setEditingServiceListing(null) }}
                  onPublished={() => { setShowForm(false); setProductType('physical'); setEditingServiceListing(null); loadListings() }}
                />
              ) : (
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted">
              <span className="rounded-full bg-seal px-3 py-1 text-surface">1 Overview</span>
              <span>2 Pricing</span><span>3 Deliverables</span><span>4 Gallery</span>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-muted">Format</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[
                { v: 'physical', l: 'Physical item' },
                { v: 'digital_instant', l: 'Instant digital file' },
                { v: 'digital_service', l: 'Service / freelance work' },
              ].map((opt) => (
                <button
                  key={opt.v} type="button"
                  onClick={() => setProductType(opt.v)}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    productType === opt.v ? 'border-seal bg-seal/10 text-seal' : 'border-hairline text-muted'
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2 rounded-2xl border border-hairline bg-white p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Overview</p>
            <input
              required placeholder="Gig title: I will…" value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
            />
            <textarea
              placeholder="Describe your service, process, and what makes it valuable." rows={4} value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
            />
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Pricing</p>
            <input required type="number" min="0" placeholder="Starting price (₦)" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-seal outline-none" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink focus:border-seal outline-none">
              {LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-muted">Photos or videos</label>
            <input type="file" accept="image/*,video/*" multiple onChange={(e) => setMediaFiles(Array.from(e.target.files || []))} className="mt-1 w-full text-sm text-muted" />
            {mediaFiles.length > 0 && (
              <p className="mt-2 text-[11px] text-muted">{mediaFiles.length} file(s) selected for this listing.</p>
            )}
          </div>
          {productType === 'physical' && (
            <div className="sm:col-span-2 rounded-xl border border-hairline bg-surfacealt p-3">
              <label className="block text-xs text-muted">Product variants (optional)</label>
              <p className="mt-1 text-[11px] text-muted">Add sizes, colours, materials, or other product options.</p>
              <div className="mt-3 space-y-2">
                {variants.map((variant, index) => (
                  <div key={`${variant.name || 'new'}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto]">
                    <input
                      placeholder="Variant name (e.g. Color)"
                      value={variant.name}
                      onChange={(e) => {
                        const next = [...variants]
                        next[index] = { ...next[index], name: e.target.value }
                        setVariants(next)
                      }}
                      className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
                    />
                    <input
                      placeholder="Variant value (e.g. Red)"
                      value={variant.value}
                      onChange={(e) => {
                        const next = [...variants]
                        next[index] = { ...next[index], value: e.target.value }
                        setVariants(next)
                      }}
                      className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Extra ₦"
                      value={variant.priceAdjustment || 0}
                      onChange={(e) => {
                        const next = [...variants]
                        next[index] = { ...next[index], priceAdjustment: Number(e.target.value) || 0 }
                        setVariants(next)
                      }}
                      className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (variants.length === 1) {
                          setVariants([{ name: '', value: '' }])
                          return
                        }
                        setVariants(variants.filter((_, variantIndex) => variantIndex !== index))
                      }}
                      className="rounded-xl border border-hairline px-3 py-2 text-xs text-muted hover:text-ink"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setVariants([...variants, { name: '', value: '', priceAdjustment: 0 }])}
                className="mt-3 rounded-full border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-white"
              >
                + Add another variant
              </button>
            </div>
          )}
          {productType === 'digital_instant' && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-muted">
                File buyers receive instantly on payment (PDF, ZIP, template, etc.)
              </label>
              <input
                required type="file"
                onChange={(e) => setDigitalFile(e.target.files[0])}
                className="mt-1 w-full text-sm text-muted"
              />
              <p className="mt-1 text-xs text-marigold-deep">
                This listing skips the fulfillment step — payout and delivery happen instantly.
              </p>
            </div>
          )}
          {(category === 'Freelance & Digital Services' || category === 'Other Services') && (
            <div className="sm:col-span-2 rounded-2xl border border-hairline bg-white p-4 space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Deliverables</p>
                <label className="mt-3 block text-sm font-semibold text-ink">What's included in this package?</label>
                <p className="text-[11px] text-muted mb-3">Add the concrete deliverables a buyer receives.</p>
                <div className="space-y-2">
                  {servicesIncluded.map((service, index) => (
                    <div key={`${service.name || 'new'}-${index}`} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. Logo design, Unlimited revisions, Source files"
                        value={service.name}
                        onChange={(e) => {
                          const next = [...servicesIncluded]
                          next[index].name = e.target.value
                          setServicesIncluded(next)
                        }}
                        className="flex-1 rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-seal outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (servicesIncluded.length === 1) {
                            setServicesIncluded([{ name: '' }])
                          } else {
                            setServicesIncluded(servicesIncluded.filter((_, serviceIndex) => serviceIndex !== index))
                          }
                        }}
                        className="rounded-xl border border-hairline px-3 py-2 text-xs text-muted hover:text-ink hover:border-marigold-deep transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setServicesIncluded([...servicesIncluded, { name: '' }])}
                    className="text-xs font-medium text-seal hover:text-seal-deep transition mt-1"
                  >
                    + Add another service
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="sm:col-span-2 space-y-3 rounded-2xl border border-hairline bg-surfacealt p-4">
            <label className="flex items-start gap-3 text-sm text-ink">
              <input type="checkbox" checked={acceptedEscrow} onChange={(event) => setAcceptedEscrow(event.target.checked)} className="mt-1" />
              <span>I understand that funds are held in escrow until the buyer confirms delivery.</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-ink">
              <input type="checkbox" checked={acceptedDescription} onChange={(event) => setAcceptedDescription(event.target.checked)} className="mt-1" />
              <span>I have accurately described all flaws. If the item is defective, the admin will refund the buyer.</span>
            </label>
          </div>
          {error && <p className="text-sm text-marigold-deep sm:col-span-2">{error}</p>}
          <button
            type="submit" disabled={submitting || !acceptedEscrow || !acceptedDescription}
            className="rounded-full bg-ink px-6 py-2.5 font-body text-sm font-medium text-surface hover:bg-inksoft disabled:opacity-50 sm:col-span-2 sm:w-fit"
          >
            {submitting ? (editingId ? 'Updating…' : 'Publishing…') : (editingId ? 'Update listing' : 'Publish listing')}
          </button>
        </form>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {listings.length === 0 && !showForm && (
          <p className="text-sm text-muted">No listings yet.</p>
        )}
        {listings.map((l) => (
          <div key={l.id} className="flex items-center gap-4 rounded-xl border border-hairline p-4">
            {l.images?.[0] && (
              <img src={l.images[0]} alt={l.title} className="h-14 w-14 rounded-lg object-cover" />
            )}
            <div className="flex-1">
              <p className="font-body text-sm font-medium text-ink">{l.title}</p>
              <p className="font-mono text-xs text-muted">₦{Number(l.price).toLocaleString()} · {l.category}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => startEdit(l)} className="rounded-full border border-hairline px-3 py-1.5 text-xs text-ink hover:bg-surfacealt">Edit</button>
              <button onClick={() => deleteListing(l.id)} className="rounded-full border border-marigold/40 px-3 py-1.5 text-xs text-marigold-deep hover:bg-marigold/10">Delete</button>
            </div>
            <span className={`font-mono text-xs ${l.is_active ? 'text-seal' : 'text-muted'}`}>
              {l.is_active ? 'Live' : 'Inactive'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
