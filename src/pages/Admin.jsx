import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Activity, BookOpenText, ChevronDown, CircleDollarSign, ClipboardCheck, FileWarning, LayoutDashboard, Megaphone, Pause, Play, Scale, Search, ShieldCheck, Store, Users, Wallet, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { LISTING_CATEGORIES } from '../lib/listingCategories.js'
import { NIGERIAN_BANKS } from '../lib/nigerianBanks.js'
import { escapeLikePattern, safeFileName } from '../lib/inputSafety.js'
import { sanitizeHtml } from '../lib/sanitizeHtml.js'
import { useBalanceVisibility } from '../lib/useBalanceVisibility.js'
import { formatBalance } from '../lib/balanceDisplay.js'
import BalanceToggle from '../components/BalanceToggle.jsx'

export default function Admin() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Supabase re-emits auth events (token refresh, SIGNED_IN) whenever the tab
  // regains focus. Only a different user should reload the profile; otherwise
  // the dashboard would unmount and lose its place.
  const loadedUserIdRef = useRef(null)

  useEffect(() => {
    async function hydrateSession(nextSession) {
      setSession(nextSession)

      const nextUserId = nextSession?.user?.id || null
      if (nextUserId && nextUserId === loadedUserIdRef.current) return
      loadedUserIdRef.current = nextUserId

      if (!nextUserId) {
        setProfile(null)
        setProfileLoading(false)
        setChecking(false)
        return
      }

      setProfileLoading(true)
      const { data: profileRow, error } = await supabase
        .from('profiles')
        .select('role, full_name, business_name')
        .eq('id', nextSession.user.id)
        .single()

      if (error) {
        console.error('Admin profile lookup failed:', error)
        setProfile(null)
      } else {
        setProfile(profileRow)
      }

      setProfileLoading(false)
      setChecking(false)
    }

    supabase.auth.getSession().then(({ data }) => {
      hydrateSession(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      hydrateSession(s)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); return }
    setInfo(
      data.session
        ? 'Account created — ask your developer to grant admin access, then sign in.'
        : 'Account created — confirm your email, then ask your developer to grant admin access.'
    )
    setMode('signin')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (checking || profileLoading) return null

  if (!session) {
    return (
      <section className="mx-auto max-w-sm px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">Admin</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-ink">
          {mode === 'signin' ? 'Sign in' : 'Create your admin account'}
        </h1>
        <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="mt-8 space-y-4">
          <input
            required type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink placeholder:text-muted focus:border-seal outline-none"
          />
          <input
            required type="password" minLength={6} placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink placeholder:text-muted focus:border-seal outline-none"
          />
          {error && <p className="text-sm text-marigold-deep">{error}</p>}
          {info && <p className="text-sm text-ink">{info}</p>}
          <button type="submit" className="w-full rounded-full bg-seal py-3 font-body text-sm font-semibold text-surface hover:bg-seal-deep">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo('') }}
          className="mt-6 font-mono text-xs text-muted hover:text-seal"
        >
          {mode === 'signin' ? 'First time here? Create your admin account →' : '← Back to sign in'}
        </button>
      </section>
    )
  }

  if (profile?.role !== 'admin') {
    return (
      <section className="mx-auto max-w-2xl px-6 py-24">
        <div className="rounded-2xl border border-hairline bg-white p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Admin access</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-ink">Access restricted</h1>
          <p className="mt-4 text-sm text-muted">
            This account is not linked to the Trustall admin role. Sign in with an admin profile that has a `role` set to `admin` in your Supabase profiles table.
          </p>
          <button onClick={handleLogout} className="mt-6 rounded-full bg-ink px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-inksoft">
            Sign out
          </button>
        </div>
      </section>
    )
  }

  return <AdminHome onLogout={handleLogout} email={session.user.email} />
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function getReadingTimeMinutes(content, excerpt = '') {
  const text = `${content || ''} ${excerpt || ''}`.replace(/<[^>]*>/g, ' ')
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function RichTextEditor({ value, onChange, placeholder = 'Start writing…' }) {
  const editorRef = useRef(null)

  useEffect(() => {
    if (!editorRef.current) return
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = sanitizeHtml(value)
    }
  }, [value])

  const applyCommand = (command, valueArg) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    document.execCommand(command, false, valueArg)
    onChange(editor.innerHTML)
  }

  return (
    <div className="rounded-2xl border border-hairline bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-hairline bg-surfacealt p-2">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('bold')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Bold</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('italic')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Italic</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'h2')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">H2</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('insertUnorderedList')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Bullets</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('insertOrderedList')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Numbered</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'blockquote')} className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink">Quote</button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const url = window.prompt('Paste a link URL')
            if (!url) return
            applyCommand('createLink', url)
          }}
          className="rounded-md border border-hairline bg-white px-2 py-1 text-xs font-semibold text-ink"
        >
          Link
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        data-placeholder={placeholder}
        className="min-h-[260px] w-full bg-white px-4 py-4 text-sm leading-7 text-ink outline-none empty:before:text-muted empty:before:content-[attr(data-placeholder)] empty:before:opacity-60"
      />
    </div>
  )
}

const ADMIN_SECTIONS = [
  { group: 'Workspace', items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard, title: 'Operations overview', description: 'Marketplace health, activity and review queues.' }] },
  { group: 'Trust & safety', items: [
    { id: 'verification', label: 'Seller verification', icon: ShieldCheck, title: 'Seller verification', description: 'Review identity and seller verification requests.' },
    { id: 'reports', label: 'Reports & moderation', icon: FileWarning, title: 'Reports & moderation', description: 'Review reports and manage marketplace safety.' },
    { id: 'disputes', label: 'Disputes', icon: Scale, title: 'Dispute resolution', description: 'Investigate and resolve buyer and seller cases.' },
    { id: 'listings', label: 'Listings', icon: Store, title: 'Listing moderation', description: 'Review listings and manage marketplace visibility.' },
    { id: 'audit', label: 'Audit log', icon: ClipboardCheck, title: 'Audit log', description: 'Every change made by an admin, with who made it and when.' },
  ] },
  { group: 'Finance & people', items: [
    { id: 'payouts', label: 'Pending payouts', icon: Wallet, title: 'Pending payouts', description: 'Review payout requests and transfer status.' },
    { id: 'earnings', label: 'Trustall earnings', icon: CircleDollarSign, title: 'Trustall earnings', description: 'Platform commission, withdrawals and available balance.' },
    { id: 'members', label: 'Users, sellers & buyers', icon: Users, title: 'People directory', description: 'Search and filter Trustall user profiles.' },
    { id: 'users', label: 'Mediators', icon: Users, title: 'Mediator management', description: 'Manage the people supporting dispute resolution.' },
  ] },
  { group: 'Communications', items: [
    { id: 'marketing', label: 'Promotions', icon: Megaphone, title: 'Promotion review', description: 'Review seller campaigns and promotion revenue.' },
    { id: 'broadcast', label: 'Broadcast', icon: Megaphone, title: 'Broadcast center', description: 'Send targeted updates to Trustall members.' },
    { id: 'blog', label: 'Blog', icon: BookOpenText, title: 'Editorial', description: 'Manage Trustall articles and publishing.' },
    { id: 'catalog', label: 'Service catalog', icon: ClipboardCheck, title: 'Service catalog', description: 'Manage the service categories and catalog.' },
  ] },
]

const ADMIN_SECTION_IDS = new Set(ADMIN_SECTIONS.flatMap((group) => group.items.map((item) => item.id)))

function AdminHome({ onLogout, email }) {
  // The open section lives in the URL (?section=...), so a reload or a shared
  // link reopens the same place instead of the overview.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const tab = ADMIN_SECTION_IDS.has(requestedSection) ? requestedSection : 'overview'
  const setTab = (id) => setSearchParams(id === 'overview' ? {} : { section: id })
  const [mobileSectionsOpen, setMobileSectionsOpen] = useState(false)
  const currentSection = ADMIN_SECTIONS.flatMap((group) => group.items).find((item) => item.id === tab) || ADMIN_SECTIONS[0].items[0]
  const renderPanel = () => {
    if (tab === 'overview') return <AdminOverview onNavigate={setTab} />
    if (tab === 'verification') return <VerificationQueue />
    if (tab === 'reports') return <ReportsQueue />
    if (tab === 'disputes') return <DisputesQueue />
    if (tab === 'listings') return <ListingModeration />
    if (tab === 'broadcast') return <BroadcastPanel />
    if (tab === 'users') return <MediatorManagement />
    if (tab === 'members') return <ProfileDirectory />
    if (tab === 'marketing') return <AdminPromotions />
    if (tab === 'payouts') return <PendingPayouts />
    if (tab === 'earnings') return <TrustallEarnings />
    if (tab === 'blog') return <BlogDashboard />
    if (tab === 'audit') return <AuditLog />
    return <ServiceCatalogManager />
  }

  return (
    <div className="admin-page min-h-screen bg-[#f3f5f2] text-ink">
      <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#e2e8e2] bg-[#172c25] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:self-start">
          <div className="border-b border-white/10 px-5 py-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2f6e51] text-white"><ShieldCheck size={21} /></span>
              <div><p className="font-display text-sm font-bold">Trustall</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/55">Operations</p></div>
            </div>
          </div>
          <nav aria-label="Admin sections" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-5">
            {ADMIN_SECTIONS.map((group) => (
              <div key={group.group}>
                <p className="px-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{group.group}</p>
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-xs font-medium transition ${tab === item.id ? 'bg-white/12 text-white shadow-inner' : 'text-white/65 hover:bg-white/6 hover:text-white'}`}>
                        <Icon size={16} className={tab === item.id ? 'text-[#a9e3c1]' : 'text-white/45'} />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-white/10 p-3">
            <button onClick={onLogout} className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-xs font-medium text-white/65 transition hover:bg-white/6 hover:text-white">Sign out</button>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="sticky top-0 z-40 border-b border-[#e2e8e2] bg-white/95 px-4 py-5 backdrop-blur sm:px-7 lg:px-9">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-seal">Trustall operations / {currentSection.label}</p>
                <h1 className="mt-1 font-display text-xl font-bold text-ink sm:text-2xl">{currentSection.title}</h1>
                <p className="mt-1 text-xs text-muted">{currentSection.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden max-w-[240px] truncate rounded-full border border-hairline bg-surface px-3 py-2 font-mono text-[10px] text-muted sm:inline-flex">{email}</span>
                <button onClick={onLogout} className="rounded-full border border-hairline px-4 py-2 font-mono text-[10px] font-semibold text-muted transition hover:border-seal hover:text-seal lg:hidden">Sign out</button>
                <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-seal/10 text-seal sm:flex"><Activity size={17} /></span>
              </div>
            </div>
          </header>

          <div className="border-b border-[#e2e8e2] bg-white px-4 py-3 lg:hidden">
            <button type="button" onClick={() => setMobileSectionsOpen(true)} aria-haspopup="dialog" className="flex min-h-12 w-full items-center justify-between rounded-xl border border-hairline bg-surface px-4 text-left">
              <span className="flex items-center gap-3">
                {(() => { const Icon = currentSection.icon; return <Icon size={17} className="text-seal" /> })()}
                <span><span className="block font-mono text-[9px] uppercase tracking-[0.17em] text-muted">Current section</span><span className="mt-0.5 block text-sm font-semibold text-ink">{currentSection.label}</span></span>
              </span>
              <ChevronDown size={17} className="text-muted" />
            </button>
          </div>

          {mobileSectionsOpen && (
            <div className="fixed inset-0 z-[80] flex items-end bg-ink/35 p-0 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileSectionsOpen(false) }}>
              <section role="dialog" aria-modal="true" aria-labelledby="admin-section-picker-title" className="max-h-[82dvh] w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 shadow-2xl">
                <div className="mb-4 flex items-center justify-between border-b border-hairline pb-4">
                  <div><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-seal">Trustall operations</p><h2 id="admin-section-picker-title" className="mt-1 font-display text-lg font-bold text-ink">Choose a workspace</h2></div>
                  <button type="button" onClick={() => setMobileSectionsOpen(false)} aria-label="Close workspace selector" className="flex h-10 w-10 items-center justify-center rounded-full border border-hairline text-muted"><X size={18} /></button>
                </div>
                <nav aria-label="Admin sections" className="space-y-5">
                  {ADMIN_SECTIONS.map((group) => (
                    <div key={group.group}>
                      <p className="mb-2 px-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">{group.group}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {group.items.map((item) => {
                          const Icon = item.icon
                          return <button key={item.id} type="button" onClick={() => { setTab(item.id); setMobileSectionsOpen(false) }} aria-current={tab === item.id ? 'page' : undefined} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold ${tab === item.id ? 'border-seal bg-seal/5 text-seal' : 'border-hairline text-ink'}`}><Icon size={15} className="shrink-0" /><span>{item.label}</span></button>
                        })}
                      </div>
                    </div>
                  ))}
                </nav>
              </section>
            </div>
          )}

          <div className="min-w-0 py-2 sm:py-4">
            {renderPanel()}
          </div>
        </main>
      </div>
    </div>
  )
}

function DisputesQueue() {
  const [disputes, setDisputes] = useState([])
  const [statusFilter, setStatusFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDisputes()
  }, [statusFilter])

  async function loadDisputes() {
    setLoading(true)
    setError('')

    let query = supabase
      .from('disputes')
      .select(`
        id, reason, status, created_at, resolved_at, assigned_judge_id,
        order:order_id (id, amount, buyer:buyer_id(business_name, full_name), seller:seller_id(business_name, full_name)),
        filer:filed_by (business_name, full_name),
        judge:assigned_judge_id (business_name, full_name)
      `)
      .order('created_at', { ascending: false })

    if (statusFilter === 'active') {
      query = query.in('status', ['open', 'under_review'])
    } else if (statusFilter === 'open') {
      query = query.eq('status', 'open')
    } else if (statusFilter === 'under_review') {
      query = query.eq('status', 'under_review')
    } else if (statusFilter === 'resolved') {
      query = query.like('status', 'resolved%')
    }

    const { data, error: queryError } = await query
    if (queryError) {
      setError(queryError.message || 'Unable to load disputes.')
      setDisputes([])
    } else {
      setDisputes(data || [])
    }
    setLoading(false)
  }

  function formatStatus(status) {
    return String(status || 'open').replace(/_/g, ' ')
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Disputes</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Platform disputes</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {['active', 'open', 'under_review', 'resolved'].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`rounded-full px-3 py-1.5 font-mono text-[10px] font-semibold ${statusFilter === filter ? 'bg-ink text-surface' : 'border border-hairline text-muted'}`}
            >
              {filter === 'active' ? 'Open + under review' : filter === 'under_review' ? 'Under review' : filter === 'resolved' ? 'Resolved' : 'Open'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-hairline bg-surfacealt text-xs text-muted">
            <tr>
              <th className="p-3">Dispute</th>
              <th className="p-3">Filed by</th>
              <th className="p-3">Order</th>
              <th className="p-3">Buyer</th>
              <th className="p-3">Seller</th>
              <th className="p-3">Status</th>
              <th className="p-3">Assigned</th>
              <th className="p-3">Age</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="p-5 text-muted">Loading disputes…</td>
              </tr>
            ) : disputes.length === 0 ? (
              <tr>
                <td colSpan="8" className="p-5 text-muted">No disputes match this filter.</td>
              </tr>
            ) : (
              disputes.map((dispute) => (
                <tr key={dispute.id} className="border-b border-hairline/70 align-top">
                  <td className="p-3">
                    <Link to={`/disputes/${dispute.id}`} className="font-semibold text-ink hover:text-seal">
                      #{String(dispute.id).slice(0, 8)}
                    </Link>
                    <div className="mt-1 text-xs text-muted">{dispute.reason || 'No reason provided'}</div>
                  </td>
                  <td className="p-3 text-ink">
                    {dispute.filer?.business_name || dispute.filer?.full_name || 'Unknown'}
                  </td>
                  <td className="p-3 text-ink">{Number(dispute.order?.amount || 0).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })}</td>
                  <td className="p-3 text-ink">
                    {dispute.order?.buyer?.business_name || dispute.order?.buyer?.full_name || 'Unknown'}
                  </td>
                  <td className="p-3 text-ink">
                    {dispute.order?.seller?.business_name || dispute.order?.seller?.full_name || 'Unknown'}
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${dispute.status === 'resolved' ? 'bg-seal/10 text-seal' : dispute.status === 'under_review' ? 'bg-marigold/10 text-marigold-deep' : 'bg-ink/5 text-ink'}`}>
                      {formatStatus(dispute.status)}
                    </span>
                  </td>
                  <td className="p-3 text-ink">
                    {dispute.judge?.business_name || dispute.judge?.full_name || 'Unassigned'}
                  </td>
                  <td className="p-3 text-muted">{formatAge(dispute.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ServiceCatalogManager() {
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [subcategories, setSubcategories] = useState([])
  const [attributes, setAttributes] = useState([])
  const [subcategoryName, setSubcategoryName] = useState('')
  const [attribute, setAttribute] = useState({ name: '', label: '', attribute_type: 'text', options: '', is_required: false })
  const [editingSubcategory, setEditingSubcategory] = useState(null)
  const [editingAttribute, setEditingAttribute] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    supabase.from('categories').select('*').order('name').then(({ data, error: queryError }) => {
      setCategories(data || [])
      if (queryError) setError(queryError.message)
    })
  }, [])

  useEffect(() => {
    if (!categoryId) { setSubcategories([]); setAttributes([]); return }
    loadCategoryItems()
  }, [categoryId])

  async function loadCategoryItems() {
    const [{ data: subcategoryRows, error: subcategoryError }, { data: attributeRows, error: attributeError }] = await Promise.all([
      supabase.from('subcategories').select('*').eq('category_id', categoryId).order('name'),
      supabase.from('category_attributes').select('*').eq('category_id', categoryId).order('display_order'),
    ])
    setSubcategories(subcategoryRows || [])
    setAttributes(attributeRows || [])
    setError(subcategoryError?.message || attributeError?.message || '')
  }

  async function saveSubcategory(event) {
    event.preventDefault()
    if (!categoryId || !subcategoryName.trim()) return
    const payload = { category_id: categoryId, name: subcategoryName.trim(), is_active: editingSubcategory?.is_active ?? true }
    const query = editingSubcategory ? supabase.from('subcategories').update(payload).eq('id', editingSubcategory.id) : supabase.from('subcategories').insert(payload)
    const { error: saveError } = await query
    if (saveError) { setError(saveError.message); return }
    setSubcategoryName(''); setEditingSubcategory(null); setStatus('Subcategory saved.'); loadCategoryItems()
  }

  async function saveAttribute(event) {
    event.preventDefault()
    if (!categoryId || !attribute.name.trim() || !attribute.label.trim()) return
    const payload = { category_id: categoryId, name: attribute.name.trim(), label: attribute.label.trim(), attribute_type: attribute.attribute_type, options: attribute.options.split(',').map((item) => item.trim()).filter(Boolean), is_required: attribute.is_required, is_active: editingAttribute?.is_active ?? true }
    const query = editingAttribute ? supabase.from('category_attributes').update(payload).eq('id', editingAttribute.id) : supabase.from('category_attributes').insert(payload)
    const { error: saveError } = await query
    if (saveError) { setError(saveError.message); return }
    setAttribute({ name: '', label: '', attribute_type: 'text', options: '', is_required: false }); setEditingAttribute(null); setStatus('Attribute saved.'); loadCategoryItems()
  }

  async function toggle(table, row) {
    const { error: updateError } = await supabase.from(table).update({ is_active: !row.is_active }).eq('id', row.id)
    if (updateError) setError(updateError.message)
    else loadCategoryItems()
  }

  return <section className="mx-auto max-w-6xl px-6 py-10"><p className="font-mono text-xs uppercase tracking-widest text-seal">Service catalog</p><h1 className="mt-2 font-display text-2xl font-bold text-ink">Categories, subcategories, and attributes</h1><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-6 rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink"><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}{status && <p className="mt-4 text-sm text-seal">{status}</p>}{categoryId && <div className="mt-6 grid gap-6 lg:grid-cols-2"><div className="rounded-2xl border border-hairline bg-white p-5"><h2 className="font-display text-lg font-bold text-ink">Subcategories</h2><form onSubmit={saveSubcategory} className="mt-4 flex gap-2"><input required value={subcategoryName} onChange={(event) => setSubcategoryName(event.target.value)} placeholder="Subcategory name" className="min-w-0 flex-1 rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink" /><button type="submit" className="rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-white">{editingSubcategory ? 'Update' : 'Add'}</button></form><div className="mt-5 space-y-2">{subcategories.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surfacealt p-3"><span className={`text-sm ${row.is_active ? 'text-ink' : 'text-muted line-through'}`}>{row.name}</span><div className="flex gap-2"><button type="button" onClick={() => { setEditingSubcategory(row); setSubcategoryName(row.name) }} className="text-xs text-seal">Edit</button><button type="button" onClick={() => toggle('subcategories', row)} className="text-xs text-muted">{row.is_active ? 'Deactivate' : 'Activate'}</button></div></div>)}</div></div><div className="rounded-2xl border border-hairline bg-white p-5"><h2 className="font-display text-lg font-bold text-ink">Category attributes</h2><form onSubmit={saveAttribute} className="mt-4 space-y-2"><div className="grid gap-2 sm:grid-cols-2"><input required value={attribute.name} onChange={(event) => setAttribute({ ...attribute, name: event.target.value })} placeholder="Key name" className="rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink" /><input required value={attribute.label} onChange={(event) => setAttribute({ ...attribute, label: event.target.value })} placeholder="Display label" className="rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink" /></div><select value={attribute.attribute_type} onChange={(event) => setAttribute({ ...attribute, attribute_type: event.target.value })} className="w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink"><option value="text">Text</option><option value="number">Number</option><option value="select">Select</option><option value="boolean">Boolean</option></select>{attribute.attribute_type === 'select' && <input value={attribute.options} onChange={(event) => setAttribute({ ...attribute, options: event.target.value })} placeholder="Options separated by commas" className="w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2 text-sm text-ink" />}<label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={attribute.is_required} onChange={(event) => setAttribute({ ...attribute, is_required: event.target.checked })} /> Required</label><button type="submit" className="rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-white">{editingAttribute ? 'Update attribute' : 'Add attribute'}</button></form><div className="mt-5 space-y-2">{attributes.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surfacealt p-3"><span className={`text-sm ${row.is_active ? 'text-ink' : 'text-muted line-through'}`}>{row.label} <span className="text-xs text-muted">({row.attribute_type})</span></span><div className="flex gap-2"><button type="button" onClick={() => { setEditingAttribute(row); setAttribute({ name: row.name, label: row.label, attribute_type: row.attribute_type, options: (row.options || []).join(', '), is_required: row.is_required }) }} className="text-xs text-seal">Edit</button><button type="button" onClick={() => toggle('category_attributes', row)} className="text-xs text-muted">{row.is_active ? 'Deactivate' : 'Activate'}</button></div></div>)}</div></div></div>}</section>
}

function BroadcastPanel() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('all')
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, business_name, handle, is_seller').order('business_name').then(({ data, error: profileError }) => {
      if (profileError) setError(profileError.message)
      else setProfiles(data || [])
    })
  }, [])

  const recipients = audience === 'buyers'
    ? profiles.filter((profile) => !profile.is_seller)
    : audience === 'sellers'
      ? profiles.filter((profile) => profile.is_seller)
      : audience === 'individual' && selectedProfileId
        ? profiles.filter((profile) => profile.id === selectedProfileId)
        : profiles

  async function sendBroadcast(event) {
    event.preventDefault()
    if (!title.trim() || !body.trim() || (audience === 'individual' && !selectedProfileId)) return
    if (!window.confirm(`Send this message to ${recipients.length} selected recipient${recipients.length === 1 ? '' : 's'}?`)) return
    setSending(true); setError(''); setStatus('')
    if (recipients.length === 0) { setError('No profiles match this audience.'); setSending(false); return }
    if (audience === 'all') {
      const { data, error: sendError } = await supabase.rpc('broadcast_marketing_notification', { p_title: title.trim(), p_body: body.trim() })
      if (sendError) setError(sendError.message)
      else { setStatus(`${Number(data || 0)} notifications inserted.`); setTitle(''); setBody('') }
    } else {
      const rows = recipients.map((profile) => ({ recipient_id: profile.id, type: 'marketing', title: title.trim(), message: body.trim() }))
      const { error: sendError } = await supabase.from('notifications').insert(rows)
      if (sendError) setError(sendError.message)
      else { setStatus(`${rows.length} targeted notification${rows.length === 1 ? '' : 's'} inserted.`); setTitle(''); setBody(''); setSelectedProfileId('') }
    }
    setSending(false)
  }

  return (
    <section className="mx-auto max-w-2xl px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Broadcast</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-ink">Send a notification</h1>
      <p className="mt-2 text-sm text-muted">Choose all users, buyers, sellers, or one specific profile.</p>
      <form onSubmit={sendBroadcast} className="mt-8 space-y-4 rounded-2xl border border-hairline bg-white p-6">
        <select value={audience} onChange={(event) => { setAudience(event.target.value); setSelectedProfileId('') }} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink">
          <option value="all">All users ({profiles.length})</option>
          <option value="buyers">Buyers ({profiles.filter((profile) => !profile.is_seller).length})</option>
          <option value="sellers">Sellers ({profiles.filter((profile) => profile.is_seller).length})</option>
          <option value="individual">One specific user</option>
        </select>
        {audience === 'individual' && <select required value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink"><option value="">Choose a user</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.business_name || profile.full_name || profile.handle || profile.id}{profile.handle ? ` (@${profile.handle})` : ''}</option>)}</select>}
        <input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" />
        <textarea required value={body} onChange={(event) => setBody(event.target.value)} rows={6} placeholder="Write your announcement…" className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" />
        <p className="text-xs text-muted">Selected recipients: {recipients.length}</p>
        <button type="submit" disabled={sending || profiles.length === 0 || (audience === 'individual' && !selectedProfileId)} className="rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-surface disabled:opacity-50">{sending ? 'Sending…' : 'Send notification'}</button>
        {error && <p className="text-sm text-marigold-deep">{error}</p>}
        {status && <p className="text-sm text-seal">{status}</p>}
      </form>
    </section>
  )
}

function ListingModeration() {
  const [listings, setListings] = useState([]); const [category, setCategory] = useState(''); const [status, setStatus] = useState('all'); const [search, setSearch] = useState(''); const [page, setPage] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { load() }, [category, status, search, page])
  async function load() {
    setLoading(true); setError('')
    let query = supabase.from('listings').select('id, title, category, price, product_type, status, is_active, created_at, seller:seller_id(full_name, business_name), removed_reason, moderation_reason, removed_by, removed_at, remover:removed_by(full_name, business_name)').order('created_at', { ascending: false }).range(page * 25, page * 25 + 24)
    if (category) query = query.eq('category', category)
    if (status === 'active') query = query.eq('is_active', true)
    if (status === 'inactive') query = query.eq('is_active', false)
    if (status === 'pending_review') query = query.eq('status', 'pending_review')
    if (search.trim()) query = query.ilike('title', `%${escapeLikePattern(search.trim())}%`)
    const { data, error: queryError } = await query
    if (queryError) setError(queryError.message)
    setListings(data || []); setLoading(false)
  }
  async function reviewListing(listing, approved) {
    const reason = approved ? null : window.prompt('Reason for rejecting this listing:')
    if (!approved && !reason?.trim()) return
    const changes = approved
      ? { status: 'published', is_active: true, moderation_reason: null }
      : { status: 'rejected', is_active: false, moderation_reason: reason.trim() }
    const { error: updateError } = await supabase.from('listings').update(changes).eq('id', listing.id)
    if (updateError) { setError(updateError.message); return }
    setListings((current) => current.map((item) => item.id === listing.id ? { ...item, ...changes } : item))
  }
  function renderModerationActions(listing) {
    const isPending = listing.status === 'pending_review'
    return (
      <div className="flex flex-wrap gap-2">
        {isPending && (
          <button type="button" onClick={() => reviewListing(listing, true)} className="whitespace-nowrap rounded-full bg-seal px-3 py-1.5 font-mono text-[10px] font-bold text-surface">Approve</button>
        )}
        {isPending && (
          <button type="button" onClick={() => reviewListing(listing, false)} className="whitespace-nowrap rounded-full border border-marigold/40 px-3 py-1.5 font-mono text-[10px] font-bold text-marigold-deep">Reject</button>
        )}
        {!isPending && (
          <button type="button" onClick={() => toggleListing(listing)} className="whitespace-nowrap rounded-full border border-hairline px-3 py-1.5 font-mono text-[10px] text-ink">{listing.is_active ? 'Remove' : 'Restore'}</button>
        )}
      </div>
    )
  }
  async function toggleListing(listing) {
    const removalReason = listing.is_active ? window.prompt('Required reason for removing this listing:') : null
    if (listing.is_active && !removalReason?.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    const changes = listing.is_active ? { is_active: false, removed_reason: removalReason.trim(), removed_by: user.id, removed_at: new Date().toISOString() } : { is_active: true, removed_reason: null, removed_by: null, removed_at: null }
    const { error: updateError } = await supabase.from('listings').update(changes).eq('id', listing.id)
    if (updateError) { setError(updateError.message); return }
    setListings((current) => current.map((item) => item.id === listing.id ? { ...item, ...changes, remover: listing.remover } : item))
  }
  return <section className="mx-auto max-w-6xl px-6 py-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-widest text-seal">Moderation</p><h1 className="mt-2 font-display text-2xl font-bold text-ink">Listings</h1></div><div className="flex flex-wrap gap-2"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Search title" className="rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink" /><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0) }} className="rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink"><option value="">All categories</option>{LISTING_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }} className="rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink"><option value="all">All status</option><option value="pending_review">Pending review</option><option value="active">Active</option><option value="inactive">Removed</option></select></div></div>{error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}<div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-white"><table className="min-w-full text-left text-sm"><thead className="border-b border-hairline bg-surfacealt text-xs text-muted"><tr><th className="p-3">Listing</th><th className="p-3">Seller</th><th className="p-3">Category</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Audit</th><th className="p-3"></th></tr></thead><tbody>{loading ? <tr><td colSpan="7" className="p-5 text-muted">Loading listings…</td></tr> : listings.map((listing) => <tr key={listing.id} className="border-b border-hairline/70 align-top"><td className="p-3 font-semibold text-ink">{listing.title}<div className="mt-1 text-xs font-normal text-muted">{new Date(listing.created_at).toLocaleDateString()}</div></td><td className="p-3 text-muted">{listing.seller?.business_name || listing.seller?.full_name || 'Unknown'}</td><td className="p-3 text-muted">{listing.category || 'Uncategorized'}</td><td className="p-3 text-xs text-muted">{listing.product_type || 'physical'}</td><td className="p-3">{listing.status || (listing.is_active ? 'Active' : 'Removed')}</td><td className="max-w-xs p-3 text-xs text-muted">{listing.moderation_reason || listing.removed_reason || '—'}</td><td className="p-3"><div className="flex flex-wrap gap-2">{listing.status === 'pending_review' && <><button type="button" onClick={() => reviewListing(listing, true)} className="whitespace-nowrap rounded-full bg-seal px-3 py-1.5 font-mono text-xs font-semibold text-white">Approve</button><button type="button" onClick={() => reviewListing(listing, false)} className="whitespace-nowrap rounded-full border border-marigold/40 px-3 py-1.5 font-mono text-xs text-marigold-deep">Reject</button></>}{listing.status !== 'pending_review' && <button type="button" onClick={() => toggleListing(listing)} className="whitespace-nowrap rounded-full border border-hairline px-3 py-1.5 font-mono text-xs text-ink hover:border-seal">{listing.is_active ? 'Remove' : 'Restore'}</button>}</div></td></tr>)}</tbody></table></div><div className="mt-4 flex justify-between"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Previous</button><button disabled={listings.length < 25} onClick={() => setPage((value) => value + 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Next</button></div><p className="mt-3 text-xs text-muted">Pending service gigs appear under Pending review for approval before becoming public.</p></section>
}

function MediatorManagement() {
  const [profiles, setProfiles] = useState([]); const [error, setError] = useState('')
  useEffect(() => { supabase.from('profiles').select('id, full_name, business_name, role, is_dispute_judge').order('created_at', { ascending: false }).range(0, 99).then(({ data, error: queryError }) => { setProfiles(data || []); if (queryError) setError(queryError.message) }) }, [])
  async function toggle(profile) { const { error: updateError } = await supabase.from('profiles').update({ is_dispute_judge: !profile.is_dispute_judge }).eq('id', profile.id); if (updateError) setError(updateError.message); else setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, is_dispute_judge: !profile.is_dispute_judge } : item)) }
  return <section className="mx-auto max-w-3xl px-6 py-10"><p className="font-mono text-xs uppercase tracking-widest text-seal">Access</p><h1 className="mt-2 font-display text-2xl font-bold text-ink">Mediator eligibility</h1><p className="mt-2 text-sm text-muted">Designate trusted non-admin profiles to mediate disputes. The database policy remains the enforcement boundary.</p>{error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}<div className="mt-6 space-y-2">{profiles.map((profile) => <div key={profile.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white p-4"><div><p className="font-semibold text-ink">{profile.business_name || profile.full_name || 'Unnamed profile'}</p><p className="text-xs text-muted">{profile.role} · {profile.is_dispute_judge ? 'Eligible mediator' : 'Not designated'}</p></div><button type="button" onClick={() => toggle(profile)} className="rounded-full border border-hairline px-3 py-1.5 font-mono text-xs">{profile.is_dispute_judge ? 'Remove eligibility' : 'Make mediator'}</button></div>)}</div></section>
}

const DIRECTORY_FILTERS = [['all', 'All'], ['sellers', 'Sellers'], ['buyers', 'Buyers'], ['suspended', 'Suspended']]

function ProfileDirectory() {
  const [profiles, setProfiles] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim())
      setPage(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  // The database searches every user (name, business, handle, email or ID), not just a loaded page.
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    supabase.rpc('admin_search_users', {
      p_query: query, p_filter: filter, p_limit: ADMIN_PAGE_SIZE, p_offset: page * ADMIN_PAGE_SIZE,
    }).then(({ data, error: queryError }) => {
      if (!active) return
      if (queryError) setError(queryError.message)
      setProfiles(data || [])
      setLoading(false)
    })
    return () => { active = false }
  }, [query, filter, page])

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-seal">People</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Users, sellers & buyers</h1>
          <p className="mt-1 text-sm text-muted">Search everyone on Trustall. Select a person to see their full details.</p>
        </div>
        <label className="flex min-h-11 min-w-[240px] items-center gap-2 rounded-lg border border-hairline bg-white px-3">
          <Search size={16} className="text-muted" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, handle, email or ID" aria-label="Search users" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {DIRECTORY_FILTERS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => { setFilter(id); setPage(0) }} aria-pressed={filter === id} className={`rounded-full px-4 py-2 text-xs font-semibold ${filter === id ? 'bg-seal text-white' : 'border border-hairline text-muted'}`}>{label}</button>
        ))}
      </div>
      {error && <p className="mt-5 text-sm text-marigold-deep">{error}</p>}
      {loading && <p className="mt-6 text-sm text-muted">Loading profiles…</p>}
      {!loading && !error && profiles.length === 0 && <p className="mt-6 rounded-xl border border-hairline bg-white p-5 text-sm text-muted">No one matches this search.</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {profiles.map((profile) => (
          <button key={profile.id} type="button" onClick={() => setSelectedId(profile.id)} className="rounded-xl border border-hairline bg-white p-4 text-left transition hover:border-seal focus-visible:border-seal focus-visible:outline-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{profile.business_name || profile.full_name || 'Unnamed profile'}</p>
                <p className="mt-1 truncate text-xs text-muted">{profile.email || (profile.handle ? `@${profile.handle}` : profile.id)}</p>
              </div>
              <span className="rounded-full bg-surfacealt px-2.5 py-1 font-mono text-[9px] uppercase text-muted">{profile.is_seller ? 'Seller' : 'Buyer'}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-xs">
              <span className={profile.verified_seller ? 'font-semibold text-seal' : 'text-muted'}>{profile.verified_seller ? 'Verified seller' : profile.role || 'Member'}</span>
              <span className={profile.status === 'suspended' ? 'font-semibold text-marigold-deep' : 'text-muted'}>{profile.status || 'active'}</span>
              <span className="w-full text-[10px] text-muted">Joined {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'date unavailable'}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Previous</button>
        <button type="button" disabled={profiles.length < ADMIN_PAGE_SIZE || loading} onClick={() => setPage((value) => value + 1)} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs disabled:opacity-40">Next</button>
      </div>
      <UserDetailsPanel userId={selectedId} onClose={() => setSelectedId(null)} />
    </section>
  )
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{children}</dd>
    </div>
  )
}

function DetailSection({ title, children }) {
  return (
    <section className="mt-5 rounded-xl border border-hairline p-4">
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-seal">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

// Full picture of one user for admins: account, contact, money, activity,
// verification history and warnings. Private fields come from an admin-only RPC.
function UserDetailsPanel({ userId, onClose }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { hidden: balancesHidden, toggle: toggleBalances } = useBalanceVisibility()

  useEffect(() => {
    if (!userId) return undefined
    let active = true
    setDetails(null)
    setError('')
    setLoading(true)
    supabase.rpc('admin_get_user_details', { p_user_id: userId }).then(({ data, error: queryError }) => {
      if (!active) return
      if (queryError) setError(queryError.message)
      else if (!data) setError('This user no longer exists.')
      setDetails(data || null)
      setLoading(false)
    })
    return () => { active = false }
  }, [userId])

  useEffect(() => {
    if (!userId) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [userId, onClose])

  if (!userId) return null

  const profile = details?.profile || {}
  const account = details?.account || {}
  const name = profile.business_name || profile.full_name || 'Unnamed profile'
  const publicPath = profile.is_seller ? `/seller/${profile.handle || profile.id}` : `/buyer/${profile.handle || profile.id}`

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="user-details-title" onClick={(event) => event.stopPropagation()} className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-seal">User details</p>
            <h2 id="user-details-title" className="mt-1 truncate font-display text-xl font-bold text-ink">{loading ? 'Loading…' : name}</h2>
            {profile.handle && <p className="text-xs text-muted">@{profile.handle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close user details" className="rounded-full border border-hairline p-2 text-muted hover:text-ink"><X size={16} /></button>
        </div>

        {error && <p className="mt-5 text-sm text-marigold-deep">{error}</p>}

        {details && (
          <>
            <DetailSection title="Account">
              <dl>
                <DetailRow label="Email">{account.email || '—'}</DetailRow>
                <DetailRow label="Email confirmed">{account.email_confirmed_at ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="Phone">{details.phone || '—'}</DetailRow>
                <DetailRow label="Signed up">{formatDateTime(account.signed_up_at || profile.created_at)}</DetailRow>
                <DetailRow label="Last sign-in">{formatDateTime(account.last_sign_in_at)}</DetailRow>
                <DetailRow label="Last seen">{formatDateTime(profile.last_seen_at)}</DetailRow>
                <DetailRow label="User ID"><span className="font-mono text-xs">{profile.id}</span></DetailRow>
              </dl>
            </DetailSection>

            <DetailSection title="Standing">
              <dl>
                <DetailRow label="Role">{profile.role || 'user'}</DetailRow>
                <DetailRow label="Status">{profile.status || 'active'}</DetailRow>
                <DetailRow label="Seller">{profile.is_seller ? `Yes · level ${profile.seller_level ?? 0}` : 'No'}</DetailRow>
                <DetailRow label="Verified seller">{profile.verified_seller ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="Pro vendor">{profile.pro_vendor ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="Warnings">{profile.warning_count ?? 0} of 3</DetailRow>
                <DetailRow label="Reports against them">{details.reports_against} ({details.open_reports_against} open)</DetailRow>
              </dl>
            </DetailSection>

            <DetailSection title="Money">
              <div className="flex justify-end">
                <BalanceToggle hidden={balancesHidden} onToggle={toggleBalances} className="border border-hairline text-muted hover:text-ink" />
              </div>
              <dl>
                <DetailRow label="Wallet available">{formatBalance(profile.wallet_cleared, balancesHidden)}</DetailRow>
                <DetailRow label="Wallet pending">{formatBalance(profile.wallet_pending, balancesHidden)}</DetailRow>
                <DetailRow label="Confirmed seller payouts">{formatBalance(details.orders?.seller_payouts_confirmed, balancesHidden)}</DetailRow>
                <DetailRow label="Payout account connected">{profile.payout_connected ? 'Yes' : 'No'}</DetailRow>
              </dl>
            </DetailSection>

            <DetailSection title="Activity">
              <dl>
                <DetailRow label="Listings">{details.listings?.total ?? 0} ({details.listings?.live ?? 0} live)</DetailRow>
                <DetailRow label="Orders as buyer">{details.orders?.as_buyer ?? 0}</DetailRow>
                <DetailRow label="Orders as seller">{details.orders?.as_seller ?? 0}</DetailRow>
                <DetailRow label="Completed sales">{profile.completed_sales_count ?? 0}</DetailRow>
                <DetailRow label="Completed purchases">{profile.completed_purchases_count ?? 0}</DetailRow>
              </dl>
            </DetailSection>

            <DetailSection title="Verification history">
              {details.verification.length === 0 && <p className="text-sm text-muted">No verification requests.</p>}
              <ul className="space-y-2">
                {details.verification.map((request) => (
                  <li key={request.id} className="rounded-lg bg-surfacealt p-3 text-sm">
                    <p className="font-semibold capitalize text-ink">{request.status} · {request.id_type} ••••{request.id_number_last4 || '????'}</p>
                    <p className="mt-1 text-xs text-muted">Submitted {formatDateTime(request.submitted_at)}{request.reviewed_at ? ` · reviewed ${formatDateTime(request.reviewed_at)}` : ''}</p>
                    {request.rejection_reason && <p className="mt-1 text-xs text-marigold-deep">Reason: {request.rejection_reason}</p>}
                    {request.document_deleted && <p className="mt-1 text-xs text-muted">Document deleted after rejection.</p>}
                  </li>
                ))}
              </ul>
            </DetailSection>

            <DetailSection title="Warnings">
              {details.warnings.length === 0 && <p className="text-sm text-muted">No warnings.</p>}
              <ul className="space-y-2">
                {details.warnings.map((warning, index) => (
                  <li key={`${warning.issued_at}-${index}`} className="rounded-lg bg-surfacealt p-3 text-sm">
                    <p className="text-ink">{warning.reason}</p>
                    <p className="mt-1 text-xs text-muted">{formatDateTime(warning.issued_at)}</p>
                  </li>
                ))}
              </ul>
            </DetailSection>

            <Link to={publicPath} target="_blank" rel="noreferrer" className="mt-5 inline-block rounded-full border border-ink px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal">
              View public profile
            </Link>
          </>
        )}
      </aside>
    </div>
  )
}

function AdminPromotions() {
  const [promotions, setPromotions] = useState([])
  const [profiles, setProfiles] = useState([])
  const [listings, setListings] = useState([])
  const [revenue, setRevenue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { loadPromotions() }, [])

  async function loadPromotions() {
    setLoading(true)
    setError('')
    const [promotionResult, revenueResult] = await Promise.all([
      supabase.from('promotions').select('*').order('created_at', { ascending: false }),
      supabase.from('promotions').select('amount').eq('payment_status', 'successful'),
    ])
    // Only look up the sellers and listings these promotions point at.
    const rows = promotionResult.data || []
    const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter(Boolean))]
    const listingIds = [...new Set(rows.filter((row) => row.target_type !== 'storefront').map((row) => row.target_id).filter(Boolean))]
    const [profileResult, listingResult] = await Promise.all([
      sellerIds.length ? supabase.from('profiles').select('id, full_name, business_name').in('id', sellerIds) : { data: [] },
      listingIds.length ? supabase.from('listings').select('id, title').in('id', listingIds) : { data: [] },
    ])
    const queryError = promotionResult.error || revenueResult.error || profileResult.error || listingResult.error
    if (queryError) setError(queryError.message || 'Promotion data could not be loaded.')
    setPromotions(promotionResult.data || [])
    setProfiles(profileResult.data || [])
    setListings(listingResult.data || [])
    setRevenue(revenueResult.error ? null : (revenueResult.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))
    setLoading(false)
  }

  async function updatePromotion(promotion, status) {
    setBusyId(promotion.id)
    setError('')
    const changes = { status }
    if (status === 'active' && promotion.status === 'pending_review') {
      const { data: { user } } = await supabase.auth.getUser()
      changes.approved_by = user?.id
      changes.approved_at = new Date().toISOString()
    }
    const { error: updateError } = await supabase.from('promotions').update(changes).eq('id', promotion.id)
    if (updateError) setError(updateError.message)
    else await loadPromotions()
    setBusyId(null)
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const listingById = new Map(listings.map((listing) => [listing.id, listing]))

  return <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-widest text-seal">Marketing</p><h1 className="mt-2 font-display text-2xl font-bold text-ink">Seller promotions</h1><p className="mt-1 text-sm text-muted">Review and manage campaigns across the marketplace.</p></div><div className="rounded-xl border border-hairline bg-white px-4 py-3"><p className="font-mono text-[9px] uppercase tracking-widest text-muted">Successful promotion payments</p><p className="mt-1 font-display text-xl font-bold text-ink">{revenue === null ? 'Unavailable' : money(revenue)}</p></div></div>{error && <p className="mt-5 text-sm text-marigold-deep">{error}</p>}{loading && <p className="mt-6 text-sm text-muted">Loading promotion records…</p>}{!loading && !error && promotions.length === 0 && <p className="mt-6 rounded-xl border border-hairline bg-white p-5 text-sm text-muted">No promotions yet.</p>}<div className="mt-5 grid gap-3">{promotions.map((promotion) => { const seller = profileById.get(promotion.seller_id); const listing = listingById.get(promotion.target_id); const target = promotion.target_type === 'storefront' ? seller?.business_name || seller?.full_name : listing?.title; return <article key={promotion.id} className="rounded-xl border border-hairline bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-ink">{promotion.campaign_name || target || 'Promotion'}</p><p className="mt-1 text-xs text-muted">{seller?.business_name || seller?.full_name || promotion.seller_id || 'Seller unavailable'} · {target || promotion.target_type || 'Target unavailable'}</p></div><span className="rounded-full bg-surfacealt px-3 py-1 font-mono text-[10px] uppercase text-ink">{String(promotion.status || 'unknown').replace(/_/g, ' ')}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3"><p className="font-mono text-sm font-semibold text-ink">{promotion.amount == null ? 'Amount unavailable' : money(promotion.amount)} · {promotion.payment_status || 'payment status unavailable'}</p><div className="flex flex-wrap gap-2">{promotion.status === 'pending_review' && <><button type="button" disabled={busyId === promotion.id} onClick={() => updatePromotion(promotion, 'active')} className="min-h-10 rounded-lg bg-seal px-3 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busyId === promotion.id} onClick={() => updatePromotion(promotion, 'rejected')} className="min-h-10 rounded-lg border border-marigold/40 px-3 text-xs font-semibold text-marigold-deep disabled:opacity-50">Reject</button></>}{promotion.status === 'active' && <button type="button" disabled={busyId === promotion.id} onClick={() => updatePromotion(promotion, 'paused')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-semibold text-ink disabled:opacity-50"><Pause size={14} /> Pause</button>}{promotion.status === 'paused' && <button type="button" disabled={busyId === promotion.id} onClick={() => updatePromotion(promotion, 'active')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-xs font-semibold text-ink disabled:opacity-50"><Play size={14} /> Resume</button>}{!['stopped', 'rejected', 'expired'].includes(promotion.status) && <button type="button" disabled={busyId === promotion.id} onClick={() => updatePromotion(promotion, 'stopped')} className="min-h-10 rounded-lg border border-hairline px-3 text-xs font-semibold text-muted disabled:opacity-50">Stop</button>}</div></div></article>})}</div></section>
}

const ADMIN_PAGE_SIZE = 25

function money(value) {
  return `₦${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

async function loadOrderFeeTotals() {
  const totals = { protectionFees: 0, commission: 0 }
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase.from('orders').select('buyer_fee, seller_fee').order('created_at', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) return { data: null, error }
    for (const order of data || []) {
      totals.protectionFees += Number(order.buyer_fee || 0)
      totals.commission += Number(order.seller_fee || 0)
    }
    if (!data || data.length < pageSize) return { data: totals, error: null }
    offset += pageSize
  }
}

function Metric({ label, value, detail }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  )
}

function AttentionRequired({ onNavigate }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    async function loadCounts() {
      const results = await Promise.all([
        supabase.from('verification_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('promotions').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
        supabase.from('disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
        supabase.from('payout_transfers').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'reviewing']),
      ])
      setItems([
        { label: 'Pending verification requests', tab: 'verification', result: results[0] },
        { label: 'Pending promotion approvals', tab: 'marketing', result: results[1] },
        { label: 'Open disputes', tab: 'disputes', result: results[2] },
        { label: 'Failed payouts', tab: 'payouts', result: results[3] },
        { label: 'Open reports', tab: 'reports', result: results[4] },
      ])
    }
    loadCounts()
  }, [])

  return <section className="mt-6 rounded-xl border border-marigold/30 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="font-mono text-[10px] uppercase tracking-widest text-marigold-deep">Live queues</p><h2 className="mt-1 font-display text-lg font-bold text-ink">Attention required</h2></div><p className="text-xs text-muted">Counts are queried directly from operational tables.</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{(items || ['Pending verification requests', 'Pending promotion approvals', 'Open disputes', 'Failed payouts', 'Open reports'].map((label) => ({ label, result: null }))).map((item) => { const count = item.result?.error ? null : item.result?.count; return <button key={item.label} type="button" onClick={() => item.tab && onNavigate(item.tab)} className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 text-left transition hover:border-seal"><span className="text-xs font-medium text-ink">{item.label}</span><span className={`font-display text-xl font-bold ${count === null || count === undefined ? 'text-muted' : count > 0 ? 'text-marigold-deep' : 'text-seal'}`}>{count === null || count === undefined ? 'Unavailable' : count}</span></button> })}</div></section>
}

function AdminOverview({ onNavigate }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadOverview() }, [days])

  async function loadOverview() {
    setLoading(true)
    setError('')
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const { data: overview, error: overviewError } = await supabase.rpc('get_admin_dashboard', { p_since: since, p_limit: ADMIN_PAGE_SIZE })
    if (overviewError) {
      setError(overviewError.code === 'PGRST202'
        ? 'Admin analytics is not deployed yet. Apply supabase/migrations/0021_admin_dashboard_audit.sql in Supabase SQL Editor, then reload this page.'
        : overviewError.message || 'Dashboard data could not be loaded.')
      setLoading(false)
      return
    }

    const profileRows = overview?.profiles || []
    const platformTotals = overview?.platform_totals || {}
    const listingRows = overview?.listings || []
    const orderRows = overview?.orders || []
    const disputeRows = overview?.disputes || []
    const referralRows = overview?.referrals || []
    const verificationRows = overview?.verification || []
    const reportRows = overview?.reports || []
    const warningRows = overview?.warnings || []
    const notificationRows = overview?.notifications || []
    const escrow = orderRows.filter((order) => ['paid', 'fulfilled', 'disputed'].includes(order.status) && !order.released_at)
    const commission = orderRows.reduce((sum, order) => sum + Number(order.seller_fee || 0), 0)
    const protectionFees = orderRows.reduce((sum, order) => sum + Number(order.buyer_fee || 0), 0)
    const gmv = orderRows.reduce((sum, order) => sum + Number(order.amount || 0) + Number(order.delivery_fee || 0), 0)
    const pendingReferrals = referralRows.filter((row) => row.status === 'pending')
    const openDisputes = disputeRows.filter((row) => !String(row.status || '').startsWith('resolved'))
    const resolvedDisputes = disputeRows.filter((row) => row.resolved_at)
    const averageResolutionHours = resolvedDisputes.length
      ? resolvedDisputes.reduce((sum, row) => sum + (new Date(row.resolved_at) - new Date(row.created_at)) / 3600000, 0) / resolvedDisputes.length
      : 0
    const emailSent = notificationRows.filter((row) => row.delivery_status?.email === 'sent' || row.is_email_sent).length
    const pushSent = notificationRows.filter((row) => row.delivery_status?.push === 'sent' || row.is_push_sent).length
    const emailFailed = notificationRows.filter((row) => row.delivery_status?.email === 'failed').length
    const pushFailed = notificationRows.filter((row) => row.delivery_status?.push === 'failed').length

    setData({
      profiles: profileRows, listings: listingRows, orders: orderRows, disputes: disputeRows, referrals: referralRows,
      verification: verificationRows, reports: reportRows, warnings: warningRows,
      platformTotals,
      metrics: { commission, protectionFees, gmv, escrow: escrow.reduce((sum, order) => sum + Number(order.amount || 0) + Number(order.delivery_fee || 0), 0), averageOrder: orderRows.length ? gmv / orderRows.length : 0, pendingReferrals: pendingReferrals.reduce((sum, row) => sum + Number(row.amount || 0), 0), openDisputes: openDisputes.length, averageResolutionHours, emailSent, pushSent, emailFailed, pushFailed },
    })
    setLoading(false)
  }

  if (loading && !data) return <section className="mx-auto max-w-6xl px-6 py-10 text-sm text-muted">Loading admin overview…</section>
  if (!data) return <section className="mx-auto max-w-6xl px-6 py-10 text-sm text-marigold-deep">Unable to load dashboard data.</section>

  const { metrics } = data
  const statusCounts = data.orders.reduce((counts, order) => ({ ...counts, [order.status]: (counts[order.status] || 0) + 1 }), {})
  const categoryCounts = data.listings.reduce((counts, listing) => ({ ...counts, [listing.category || 'Uncategorized']: (counts[listing.category || 'Uncategorized'] || 0) + 1 }), {})
  const agingDisputes = data.disputes.filter((dispute) => !String(dispute.status || '').startsWith('resolved') && Date.now() - new Date(dispute.created_at).getTime() > 48 * 3600000)
  const pendingVerification = data.verification.filter((request) => request.status === 'pending')
  const dailyTrend = buildDailyTrend(data.profiles, data.orders, days)
  const topReferrers = Object.entries(data.referrals.reduce((counts, row) => ({ ...counts, [row.referrer_id]: (counts[row.referrer_id] || 0) + 1 }), {})).sort(([, first], [, second]) => second - first).slice(0, 5)

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Reporting window <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="ml-2 rounded-lg border border-hairline bg-white px-3 py-2 font-body text-xs normal-case tracking-normal text-ink"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
      </div>
      {error && <p className="mt-4 rounded-xl border border-marigold/30 bg-marigold/10 p-3 text-xs text-marigold-deep">{error} Check that the latest Supabase migration is applied.</p>}

      <AttentionRequired onNavigate={onNavigate} />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Users in window" value={data.profiles.length} detail={`${data.profiles.filter((row) => row.is_seller).length} sellers · ${data.profiles.filter((row) => !row.is_seller).length} buyers`} />
        <Metric label="All-time users" value={Number(data.platformTotals.total_users || 0).toLocaleString()} detail={`${Number(data.platformTotals.total_sellers || 0).toLocaleString()} sellers · ${Number(data.platformTotals.total_buyers || 0).toLocaleString()} buyers · ${Number(data.platformTotals.total_verified_sellers || 0).toLocaleString()} verified`} />
        <Metric label="Orders in window" value={data.orders.length} detail={`${money(metrics.averageOrder)} average order value`} />
        <Metric label="GMV" value={money(metrics.gmv)} detail="Order value + delivery fees" />
        <Metric label="Commission fees" value={money(metrics.commission)} detail="Sum of seller_fee on orders in window" />
        <Metric label="Protection fees" value={money(metrics.protectionFees)} detail="Sum of buyer_fee on orders in window" />
        <Metric label="Escrow liability" value={money(metrics.escrow)} detail="Funds held in paid / fulfilled / disputed orders" />
        <Metric label="Open disputes" value={metrics.openDisputes} detail={`${agingDisputes.length} older than 48 hours`} />
        <Metric label="Referral liability" value={money(metrics.pendingReferrals)} detail="Pending bonuses only" />
        <Metric label="Verification queue" value={pendingVerification.length} detail="Pending seller requests" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <DashboardPanel title="Users & listings">
          <DashboardLine label="Verified sellers" value={data.profiles.filter((row) => row.verified_seller).length} />
          <DashboardLine label="Pro vendors / buyers" value={`${data.profiles.filter((row) => row.pro_vendor).length} / ${data.profiles.filter((row) => row.pro_buyer).length}`} />
          <DashboardLine label="Suspended / warned" value={`${data.profiles.filter((row) => row.status === 'suspended').length} / ${data.profiles.filter((row) => row.status === 'warned').length}`} />
          <DashboardLine label="Active / inactive listings" value={`${data.listings.filter((row) => row.is_active).length} / ${data.listings.filter((row) => !row.is_active).length}`} />
          <DashboardLine label="Categories" value={Object.entries(categoryCounts).map(([name, count]) => `${name}: ${count}`).join(' · ') || 'None'} />
        </DashboardPanel>
        <DashboardPanel title="Orders, escrow & revenue">
          {Object.entries(statusCounts).map(([status, count]) => <DashboardLine key={status} label={status} value={count} />)}
          <DashboardLine label="Escrow stages" value={`paid ${statusCounts.paid || 0} · fulfilled ${statusCounts.fulfilled || 0} · disputed ${statusCounts.disputed || 0}`} />
          <DashboardLine label="Seller commission fees" value={money(metrics.commission)} />
          <DashboardLine label="Buyer protection fees" value={money(metrics.protectionFees)} />
          <p className="mt-3 text-xs text-muted">Fee totals are separate persisted order fields; escrow liability is unsettled order value.</p>
        </DashboardPanel>
        <DashboardPanel title="Disputes & moderation">
          <DashboardLine label="Open / under review" value={`${data.disputes.filter((row) => row.status === 'open').length} / ${data.disputes.filter((row) => row.status === 'under_review').length}`} />
          <DashboardLine label="Aged over 48 hours" value={agingDisputes.length} />
          <DashboardLine label="Average time to resolution" value={metrics.averageResolutionHours ? `${metrics.averageResolutionHours.toFixed(1)} hours` : 'No resolved cases in window'} />
          <DashboardLine label="Reports in queue" value={data.reports.filter((row) => ['open', 'reviewing'].includes(row.status)).length} />
          <DashboardLine label="Warnings issued" value={data.warnings.length} />
          <div className="mt-4 border-t border-hairline pt-3 text-xs text-muted">Recent reports are limited to {ADMIN_PAGE_SIZE}. Select a report in Reports & moderation to drill into its linked order.</div>
        </DashboardPanel>
        <DashboardPanel title="Referrals, verification & notifications">
          <DashboardLine label="Referral pending / cleared / paid" value={['pending', 'cleared', 'paid'].map((status) => `${status} ${data.referrals.filter((row) => row.status === status).length}`).join(' · ')} />
          <DashboardLine label="Top referrers" value={topReferrers.length ? topReferrers.map(([id, count]) => `${String(id).slice(0, 8)}: ${count}`).join(' · ') : 'None'} />
          <DashboardLine label="Verification pending" value={pendingVerification.length} />
          <DashboardLine label="Email sent / failed" value={`${metrics.emailSent} / ${metrics.emailFailed}`} />
          <DashboardLine label="Push sent / failed" value={`${metrics.pushSent} / ${metrics.pushFailed}`} />
          <p className="mt-3 text-xs text-muted">Delivery failures are counted only from persisted delivery_status values, never inferred from an unset success flag.</p>
        </DashboardPanel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DashboardPanel title={`Daily activity · last ${days} days`}>
          <div className="flex h-32 items-end gap-1 border-b border-l border-hairline px-2 pb-0">
            {dailyTrend.map((day) => <div key={day.date} title={`${day.date}: ${day.signups} signups, ${money(day.gmv)} GMV`} className="min-w-0 flex-1 bg-seal/70 hover:bg-seal" style={{ height: `${Math.max(4, day.max ? (day.gmv / day.max) * 100 : 4)}%` }} />)}
          </div>
          <p className="text-xs text-muted">Bars show GMV by day. Signup counts are available in each bar tooltip.</p>
        </DashboardPanel>
        <DashboardPanel title="Review queue detail">
          <DashboardLine label="Pending verification oldest" value={pendingVerification.length ? formatAge(pendingVerification.reduce((oldest, row) => new Date(row.created_at) < new Date(oldest.created_at) ? row : oldest).created_at) : 'None'} />
          <DashboardLine label="Open reports" value={data.reports.filter((row) => ['open', 'reviewing'].includes(row.status)).length} />
          <DashboardLine label="Flag status" value="Human review signals only" />
        </DashboardPanel>
      </div>

      <div className="mt-6 rounded-2xl border border-hairline bg-white p-5">
        <h2 className="font-display text-lg font-bold text-ink">Human-review flags</h2>
        <p className="mt-2 text-sm text-muted">Explainable signals only. These are review queues, not automated verdicts.</p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><DashboardLine label="Disputes older than 48h" value={agingDisputes.length} /><DashboardLine label="Open moderation reports" value={data.reports.filter((row) => ['open', 'reviewing'].includes(row.status)).length} /><DashboardLine label="Unreviewed seller checks" value={pendingVerification.length} /></div>
      </div>
    </section>
  )
}

function buildDailyTrend(profiles, orders, days) {
  const byDate = {}
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
    byDate[date] = { date, signups: 0, gmv: 0 }
  }
  profiles.forEach((profile) => { const date = profile.created_at?.slice(0, 10); if (byDate[date]) byDate[date].signups += 1 })
  orders.forEach((order) => { const date = order.created_at?.slice(0, 10); if (byDate[date]) byDate[date].gmv += Number(order.amount || 0) + Number(order.delivery_fee || 0) })
  const trend = Object.values(byDate)
  const max = Math.max(...trend.map((day) => day.gmv), 0)
  return trend.map((day) => ({ ...day, max }))
}

function formatAge(dateString) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 3600000))
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function DashboardPanel({ title, children }) { return <div className="rounded-2xl border border-hairline bg-white p-5"><h2 className="font-display text-lg font-bold text-ink">{title}</h2><div className="mt-4 space-y-3">{children}</div></div> }
function DashboardLine({ label, value }) { return <div className="flex items-start justify-between gap-4 border-b border-hairline/70 pb-2 text-sm"><span className="text-muted">{label}</span><span className="text-right font-semibold text-ink">{value}</span></div> }

function BlogDashboard() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [content, setContent] = useState('')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [category, setCategory] = useState('General')
  const [tagsText, setTagsText] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    loadPosts()
  }, [])

  async function loadPosts() {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('blog_posts')
      .select('*')
      .order('updated_at', { ascending: false })

    if (!fetchError) setPosts(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!title) return
    if (!selectedId || slug.trim() === '') {
      const nextSlug = slugify(title)
      setSlug(nextSlug)
    }
  }, [title, selectedId, slug])

  const readingTime = getReadingTimeMinutes(content, excerpt)

  function resetForm(post = null) {
    setSelectedId(post?.id || null)
    setTitle(post?.title || '')
    setSlug(post?.slug || '')
    setExcerpt(post?.excerpt || '')
    setContent(post?.content || '')
    setCoverImageUrl(post?.cover_image_url || '')
    setCategory(post?.category || 'General')
    setTagsText((post?.tags || []).join(', '))
    setMetaDescription(post?.meta_description || '')
    setIsPublished(Boolean(post?.is_published))
    setError('')
    setStatusMessage('')
  }

  async function handleCoverUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    setError('')

    const path = `blog-images/${Date.now()}-${safeFileName(file.name)}`
    const { data: uploadData, error: uploadError } = await supabase.storage.from('blog-images').upload(path, file, { upsert: true })
    if (uploadError) {
      setError('Cover image upload failed. Please try again.')
      setUploadingCover(false)
      return
    }

    const { data: publicData } = supabase.storage.from('blog-images').getPublicUrl(uploadData.path)
    setCoverImageUrl(publicData.publicUrl)
    setUploadingCover(false)
    setStatusMessage('Cover image uploaded.')
  }

  async function savePost() {
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required before saving.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const nextTags = tagsText.split(',').map((item) => item.trim()).filter(Boolean)
      const isNew = !selectedId
      const existing = posts.find((post) => post.id === selectedId)
      const publishedAt = isPublished && !existing?.published_at ? new Date().toISOString() : existing?.published_at || null

      const payload = {
        id: selectedId || undefined,
        title: title.trim(),
        slug: slugify(slug || title),
        excerpt: excerpt.trim(),
        content,
        cover_image_url: coverImageUrl,
        author_id: user?.id,
        category: category || 'General',
        tags: nextTags,
        meta_description: metaDescription.trim(),
        reading_time_minutes: readingTime,
        is_published: isPublished,
        published_at: publishedAt,
      }

      const { error: saveError } = await supabase.from('blog_posts').upsert(payload)
      if (saveError) throw saveError

      setStatusMessage(isNew ? 'Post created successfully.' : 'Post saved successfully.')
      await loadPosts()
      const created = posts.find((post) => post.slug === payload.slug)
      if (!selectedId && created) setSelectedId(created.id)
      const refreshed = await supabase.from('blog_posts').select('*').eq('slug', payload.slug).single()
      if (refreshed.data) resetForm(refreshed.data)
    } catch (saveErr) {
      console.error('Failed to save blog post:', saveErr)
      setError(saveErr.message || 'Unable to save the post.')
    } finally {
      setSaving(false)
    }
  }

  async function deletePost(postId) {
    if (!window.confirm('Delete this blog post?')) return
    const { error: deleteError } = await supabase.from('blog_posts').delete().eq('id', postId)
    if (!deleteError) {
      setStatusMessage('Post deleted.')
      if (selectedId === postId) resetForm()
      await loadPosts()
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Blog</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Premium editor</h1>
        </div>
        <button type="button" onClick={() => resetForm()} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-muted hover:text-ink">New post</button>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6 rounded-3xl border border-hairline bg-white p-5 shadow-sm">
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Title</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-2xl border border-hairline bg-surfacealt px-4 py-3 text-2xl font-display font-bold text-ink outline-none focus:border-seal" placeholder="Post title" />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Slug</label>
            <input value={slug} onChange={(event) => setSlug(event.target.value)} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" placeholder="example-post" />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Excerpt</label>
            <textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} rows={3} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" placeholder="Short summary for cards and previews" />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Category</label>
            <input value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" placeholder="General" />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Tags</label>
            <input value={tagsText} onChange={(event) => setTagsText(event.target.value)} className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" placeholder="trust, marketplace, sellers" />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Content</label>
            <RichTextEditor value={content} onChange={setContent} placeholder="Write your article here…" />
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-hairline bg-white p-5 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Cover image</p>
            {coverImageUrl && (
              <img src={coverImageUrl} alt="Cover preview" className="mt-3 aspect-video w-full rounded-2xl object-cover border border-hairline" />
            )}
            <label className="mt-4 block cursor-pointer rounded-full border border-seal bg-seal/10 px-4 py-2 text-center font-mono text-xs font-semibold text-seal hover:bg-seal/15">
              {uploadingCover ? 'Uploading…' : 'Upload cover image'}
              <input type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
            </label>
          </div>

          <div className="rounded-3xl border border-hairline bg-white p-5 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">SEO</p>
            <textarea value={metaDescription} onChange={(event) => setMetaDescription(event.target.value)} rows={5} className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" placeholder="Meta description for search snippets" />
            <p className="mt-2 text-[10px] text-muted">{metaDescription.length}/160 characters</p>
          </div>

          <div className="rounded-3xl border border-hairline bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Publishing</p>
              <label className="inline-flex items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={isPublished} onChange={(event) => setIsPublished(event.target.checked)} />
                Published
              </label>
            </div>
            <p className="mt-4 text-sm text-muted">Estimated reading time: {readingTime} min</p>
            <p className="mt-2 text-xs text-muted">Word count: {stripHtml(content).split(/\s+/).filter(Boolean).length}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={savePost} disabled={saving} className="flex-1 rounded-full bg-seal px-4 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-seal-deep disabled:opacity-60">{saving ? 'Saving…' : 'Save post'}</button>
            </div>
            {error && <p className="mt-3 rounded-xl border border-marigold/30 bg-marigold/10 px-3 py-2 text-xs text-marigold-deep">{error}</p>}
            {statusMessage && <p className="mt-3 rounded-xl border border-seal/30 bg-seal/10 px-3 py-2 text-xs text-seal">{statusMessage}</p>}
          </div>
        </aside>
      </div>

      <div className="mt-8 rounded-3xl border border-hairline bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-ink">All posts</h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{posts.length} total</span>
        </div>

        {loading ? (
          <p className="text-muted">Loading posts…</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <div key={post.id} className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surfacealt p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base font-bold text-ink">{post.title}</span>
                    {post.category && <span className="rounded-full bg-seal/10 px-2 py-0.5 font-mono text-[10px] uppercase text-seal">{post.category}</span>}
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${post.is_published ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      {post.is_published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted">Views: {post.view_count || 0} · Updated: {post.updated_at ? new Date(post.updated_at).toLocaleDateString() : '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => resetForm(post)} className="rounded-full border border-hairline px-3 py-1.5 font-mono text-[10px] font-semibold text-ink hover:border-seal">Edit</button>
                  <button type="button" onClick={() => deletePost(post.id)} className="rounded-full border border-marigold/30 bg-marigold/10 px-3 py-1.5 font-mono text-[10px] font-semibold text-marigold-deep hover:bg-marigold/20">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function AuditLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('admin_audit_log').select('id, action, table_name, record_id, changes, created_at, actor:actor_id(full_name, business_name)')
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message)
        setEntries(data || [])
        setLoading(false)
      })
  }, [])

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Accountability</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-ink">Audit log</h1>
      <p className="mt-1 text-sm text-muted">The latest 200 changes made by admins. Entries are written by the database and can't be edited.</p>
      {error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}
      {loading && <p className="mt-6 text-sm text-muted">Loading audit log…</p>}
      {!loading && !error && entries.length === 0 && <p className="mt-6 rounded-xl border border-hairline bg-white p-5 text-sm text-muted">No admin changes recorded yet.</p>}
      <div className="mt-5 space-y-2">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-xl border border-hairline bg-white p-4 text-sm">
            <p className="font-semibold text-ink">
              {entry.actor?.business_name || entry.actor?.full_name || 'Unknown admin'} · {entry.action} · {entry.table_name}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted">{new Date(entry.created_at).toLocaleString()} · record {entry.record_id || '—'}</p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surfacealt p-2 font-mono text-[11px] text-ink">{JSON.stringify(entry.changes, null, 2)}</pre>
          </article>
        ))}
      </div>
    </section>
  )
}

const VERIFICATION_VIEWS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]

function VerificationQueue() {
  const [view, setView] = useState('pending')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [docUrls, setDocUrls] = useState({})
  const [revealedIds, setRevealedIds] = useState({})
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    loadRequests()

    // Realtime alone keeps the queue current; polling and profile updates
    // (which fire on every presence ping) caused constant reloads.
    const channel = supabase
      .channel(`admin-verification-${view}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'verification_requests' }, loadRequests)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'verification_requests' }, loadRequests)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [view])

  async function loadRequests() {
    setLoading(true)

    // Pending: oldest first, so the queue is worked in order. History: newest first.
    const { data, error } = await supabase
      .from('verification_requests')
      .select('*, seller_profile:seller_id(full_name, business_name, verified_seller, status, seller_level, profile_contacts(phone))')
      .eq('status', view)
      .order(view === 'pending' ? 'created_at' : 'reviewed_at', { ascending: view === 'pending' })
      .limit(100)

    if (error) {
      console.error('Admin verification fetch failed:', error)
      setRequests([])
      setLoading(false)
      return
    }

    const rows = data || []
    setRequests(rows)
    setLoading(false)

    // Rejected documents are deleted, so only sign links for files that still exist.
    const withDocuments = rows.filter((r) => r.document_url && !r.document_deleted_at)
    if (withDocuments.length === 0) {
      setDocUrls({})
      return
    }
    const { data: signed } = await supabase.storage
      .from('verification-docs')
      .createSignedUrls(withDocuments.map((r) => r.document_url), 60 * 10)
    const urlByPath = new Map((signed || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]))
    setDocUrls(Object.fromEntries(withDocuments.map((r) => [r.id, urlByPath.get(r.document_url)]).filter(([, url]) => url)))
  }

  // ID numbers are encrypted at rest; only admins can decrypt them, one request at a time.
  async function revealIdNumber(request) {
    const { data, error } = await supabase.rpc('reveal_verification_id_number', { p_request_id: request.id })
    if (error) {
      alert(error.message || 'Unable to reveal this ID number.')
      return
    }
    setRevealedIds((prev) => ({ ...prev, [request.id]: data || 'not provided' }))
  }

  async function decide(request, approve) {
    const reason = approve ? null : window.prompt('Why is this request rejected? The seller will see this.')
    if (!approve && !reason?.trim()) return
    setBusyId(request.id)

    // One database call updates the request and the seller's badge together.
    const { data, error } = await supabase.rpc('admin_review_verification', {
      p_request_id: request.id, p_approve: approve, p_reason: reason,
    })
    if (error || !data?.success) {
      setBusyId(null)
      alert(error?.message || data?.error || 'This request could not be reviewed.')
      return
    }

    // Rejected ID documents aren't kept: delete the file, then record that it's gone.
    if (!approve && data.document_path) {
      const { error: removeError } = await supabase.storage.from('verification-docs').remove([data.document_path])
      if (removeError) {
        alert(`Rejected, but the document could not be deleted: ${removeError.message}`)
      } else {
        const { error: markError } = await supabase.from('verification_requests').update({ document_deleted_at: new Date().toISOString() }).eq('id', request.id)
        if (markError) console.error('Document deleted, but its deletion time was not recorded:', markError)
      }
    }

    setRequests((prev) => prev.filter((r) => r.id !== request.id))
    setBusyId(null)
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Seller verification</h1>

      <div className="mt-5 flex flex-wrap gap-2">
        {VERIFICATION_VIEWS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} className={`rounded-full px-4 py-2 text-xs font-semibold ${view === id ? 'bg-seal text-white' : 'border border-hairline text-muted'}`}>{label}</button>
        ))}
      </div>

      {loading && <p className="mt-10 text-muted">Loading {view} requests…</p>}

      {!loading && requests.length === 0 && (
        <p className="mt-10 rounded-xl border border-hairline bg-white p-6 text-muted">
          No {view} verification requests{view === 'pending' ? ' right now' : ''}.
        </p>
      )}

      <div className="mt-8 space-y-5">
        {requests.map((r) => {
          const contact = r.seller_profile?.profile_contacts
          const phone = (Array.isArray(contact) ? contact[0] : contact)?.phone
          return (
          <div key={r.id} className="rounded-2xl border border-hairline bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-display text-lg text-ink">{r.legal_name}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {r.id_type} · {revealedIds[r.id] || (r.id_number_last4 ? `••••${r.id_number_last4}` : 'no ID number')}
                  {!revealedIds[r.id] && r.id_number_last4 && (
                    <button type="button" onClick={() => revealIdNumber(r)} className="ml-2 underline hover:text-seal">
                      Reveal
                    </button>
                  )}
                  {' · '}{phone || 'no phone on file'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Submitted {new Date(r.created_at).toLocaleDateString()}
                  {r.reviewed_at && ` · ${r.status} ${new Date(r.reviewed_at).toLocaleDateString()}`}
                </p>
                {r.rejection_reason && <p className="mt-1 text-xs text-marigold-deep">Reason: {r.rejection_reason}</p>}
                {r.document_deleted_at && <p className="mt-1 text-xs text-muted">Document deleted after rejection.</p>}
              </div>
              {docUrls[r.id] && (
                <a
                  href={docUrls[r.id]}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-ink px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal"
                >
                  View document
                </a>
              )}
            </div>

            {r.status === 'pending' && <div className="mt-5 flex gap-3">
              <button
                disabled={busyId === r.id}
                onClick={() => decide(r, true)}
                className="rounded-full bg-seal px-5 py-2 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busyId === r.id}
                onClick={() => decide(r, false)}
                className="rounded-full border border-hairline px-5 py-2 font-body text-sm text-ink hover:border-marigold-deep hover:text-marigold-deep disabled:opacity-50"
              >
                Reject
              </button>
            </div>}
          </div>
          )
        })}
      </div>
    </section>
  )
}

function PendingPayouts() {
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reprocessing, setReprocessing] = useState(null)

  useEffect(() => { loadPayouts() }, [])

  async function loadPayouts() {
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase
      .from('payout_transfers')
      .select('*, order:order_id(id, amount, buyer_id, seller_id), seller:seller_id(full_name, business_name)')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }

    setTransfers(data || [])
    setLoading(false)
  }

  async function retry(transfer) {
    setReprocessing(transfer.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const payoutRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-process-payout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ order_id: transfer.order_id }),
        }
      )
      const payoutData = await payoutRes.json()

      if (!payoutRes.ok) {
        alert(`Error: ${payoutData.error || payoutData.message || 'Unknown error'}`)
      } else if (payoutData.otp_required) {
        alert(`Payout requires verification:\n\n${payoutData.message || 'The seller must verify this transfer in their Paystack dashboard.'}`)
      } else {
        alert('✓ Payout reprocessed successfully.')
        await loadPayouts()
      }
    } catch (err) {
      alert('Failed to retry payout: ' + (err.message || 'Unknown error'))
    } finally {
      setReprocessing(null)
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Finance</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Pending Payouts</h1>
          <p className="mt-2 text-sm text-muted">Monitor and retry seller payout transfers</p>
        </div>
        <button onClick={loadPayouts} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs font-semibold text-ink hover:border-seal hover:text-seal">Refresh</button>
      </div>

      {error && <div className="rounded-2xl border border-marigold bg-marigold/10 p-4"><p className="font-mono text-xs font-semibold text-marigold-deep">{error}</p></div>}

      {loading && <p className="text-muted">Loading payouts…</p>}

      {!loading && transfers.length === 0 && <div className="rounded-2xl border border-hairline bg-white p-8 text-center"><p className="text-muted">All payouts are processing normally.</p></div>}

      {!loading && transfers.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-hairline bg-surfacealt text-xs font-semibold text-muted">
              <tr>
                <th className="p-3">Order ID</th>
                <th className="p-3">Seller</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Error</th>
                <th className="p-3">Created</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id} className="border-b border-hairline/70 align-top hover:bg-surfacealt/30">
                  <td className="p-3 font-mono text-xs text-ink">{transfer.order_id.substring(0, 8)}...</td>
                  <td className="p-3"><p className="font-semibold text-ink">{transfer.seller?.business_name || transfer.seller?.full_name}</p></td>
                  <td className="p-3 font-semibold text-ink">₦{Number(transfer.order?.amount || 0).toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 font-mono text-xs font-semibold ${
                      transfer.status === 'failed' ? 'bg-marigold/20 text-marigold-deep' :
                      transfer.status === 'processing' ? 'bg-amber-100 text-amber-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {transfer.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted">{transfer.failure_reason || '—'}</td>
                  <td className="p-3 text-xs text-muted">{new Date(transfer.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <button
                      onClick={() => retry(transfer)}
                      disabled={reprocessing === transfer.id}
                      className="rounded-full border border-seal px-3 py-1 font-mono text-xs font-semibold text-seal hover:bg-seal/10 disabled:opacity-50"
                    >
                      {reprocessing === transfer.id ? 'Retrying…' : 'Retry'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TrustallEarnings() {
  const [summary, setSummary] = useState({ total_earned: 0, total_withdrawn: 0, available_to_withdraw: 0 })
  const [feeTotals, setFeeTotals] = useState(null)
  const [withdrawals, setWithdrawals] = useState([])
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const availableBalance = Number(summary.available_to_withdraw || 0)

  useEffect(() => { refresh() }, [])
  useEffect(() => {
    if (!loading) setAmount(String(availableBalance))
  }, [availableBalance, loading])

  async function refresh() {
    setLoading(true)
    setError('')
    const [{ data: summaryData, error: summaryError }, { data: history, error: historyError }, feeResult] = await Promise.all([
      supabase.rpc('get_platform_earnings_summary'),
      supabase.from('platform_earnings_withdrawals').select('id, amount, status, created_at, failure_reason').order('created_at', { ascending: false }),
      loadOrderFeeTotals(),
    ])
    if (summaryError || historyError || feeResult.error) setError((summaryError || historyError || feeResult.error).message)
    setFeeTotals(feeResult.data)
    const nextSummary = Array.isArray(summaryData) ? summaryData[0] : summaryData
    if (nextSummary) {
      const nonReversedWithdrawalTotal = (history || []).reduce((total, withdrawal) => {
        const status = String(withdrawal.status || '').toLowerCase()
        return ['failed', 'rejected', 'cancelled', 'canceled', 'reversed'].includes(status)
          ? total
          : total + Number(withdrawal.amount || 0)
      }, 0)
      const effectiveWithdrawn = Math.max(Number(nextSummary.total_withdrawn || 0), nonReversedWithdrawalTotal)
      const reconciledAvailable = Math.max(0, Math.min(
        Number(nextSummary.available_to_withdraw || 0),
        Number(nextSummary.total_earned || 0) - effectiveWithdrawn
      ))
      setSummary({ ...nextSummary, available_to_withdraw: reconciledAvailable })
    }
    setWithdrawals(history || [])
    setLoading(false)
  }

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Your admin session has expired. Please sign in again.')
    return session.access_token
  }

  async function connectPayoutAccount(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const accessToken = await getAccessToken()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-create-platform-recipient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, account_name: accountName }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || data.message || 'The Trustall payout account could not be connected.')
      setMessage('Trustall payout account connected successfully.')
    } catch (connectError) {
      setError(connectError.message)
    } finally {
      setBusy(false)
    }
  }

  async function withdrawEarnings(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const requestedAmount = Number(amount)
      if (!requestedAmount || requestedAmount <= 0) throw new Error('Enter a withdrawal amount greater than zero.')
      if (requestedAmount > availableBalance) throw new Error(`Withdrawal amount exceeds available balance of ${money(availableBalance)}.`)
      const accessToken = await getAccessToken()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-withdraw-platform-earnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ amount: requestedAmount }),
      })
      const data = await response.json()
      if (data.otp_required === true) {
        setMessage(data.message || 'Withdrawal created, but OTP finalization is required in the Paystack dashboard before funds move.')
      } else if (data.success === true) {
        setMessage('Withdrawal request submitted successfully.')
      } else {
        throw new Error(data.error || data.message || 'The withdrawal could not be completed.')
      }
      await refresh()
    } catch (withdrawError) {
      setError(withdrawError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="font-mono text-xs uppercase tracking-widest text-seal">Finance</p><h1 className="mt-2 font-display text-2xl font-bold text-ink">Trustall Earnings</h1><p className="mt-2 text-sm text-muted">Platform commission that has been released from paid-out orders.</p></div>
        <button type="button" onClick={refresh} className="rounded-full border border-hairline px-4 py-2 font-mono text-xs font-semibold text-ink hover:border-seal hover:text-seal">Refresh</button>
      </div>
      {error && <p className="mt-5 rounded-xl border border-marigold/30 bg-marigold/10 p-3 text-sm text-marigold-deep">{error}</p>}
      {message && <p className="mt-5 rounded-xl border border-seal/30 bg-seal/10 p-3 text-sm text-seal">{message}</p>}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Total earned" value={loading ? '…' : money(summary.total_earned)} detail="Released commission earned" />
        <Metric label="Total withdrawn" value={loading ? '…' : money(summary.total_withdrawn)} detail="Completed platform withdrawals" />
        <Metric label="Available to withdraw" value={loading ? '…' : money(availableBalance)} detail="After completed withdrawals" />
        <Metric label="Commission fees" value={feeTotals ? money(feeTotals.commission) : loading ? '…' : 'Unavailable'} detail="Sum of orders.seller_fee" />
        <Metric label="Protection fees" value={feeTotals ? money(feeTotals.protectionFees) : loading ? '…' : 'Unavailable'} detail="Sum of orders.buyer_fee" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-hairline bg-white p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Payout account</p>
          <h2 className="mt-2 font-display text-xl font-bold text-ink">Connect or reconnect Trustall’s account</h2>
          <form onSubmit={connectPayoutAccount} className="mt-5 grid gap-3">
            <select required value={bankCode} onChange={(event) => setBankCode(event.target.value)} className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink"><option value="">Select bank</option>{NIGERIAN_BANKS.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select>
            <input required value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="Trustall account number" className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted" />
            <input required value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Registered account name" className="rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted" />
            <button type="submit" disabled={busy} className="rounded-full bg-ink px-5 py-2.5 font-mono text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Connect payout account'}</button>
          </form>
        </section>
        <section className="rounded-2xl border border-hairline bg-white p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Withdraw</p>
          <h2 className="mt-2 font-display text-xl font-bold text-ink">Move available earnings</h2>
          <p className="mt-2 text-sm text-muted">Maximum available: {money(availableBalance)}</p>
          <form onSubmit={withdrawEarnings} className="mt-5 space-y-3">
            <input required type="number" min="1" max={availableBalance} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount to withdraw" className="w-full rounded-xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink placeholder:text-muted" />
            <button type="submit" disabled={busy || availableBalance <= 0} className="rounded-full bg-seal px-5 py-2.5 font-mono text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Processing…' : 'Withdraw earnings'}</button>
          </form>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-widest text-seal">History</p><h2 className="mt-1 font-display text-xl font-bold text-ink">Platform withdrawals</h2></div><span className="font-mono text-xs text-muted">{withdrawals.length} records</span></div>
        {withdrawals.length === 0 ? <p className="mt-5 text-sm text-muted">No platform withdrawals yet.</p> : <div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-hairline bg-surfacealt text-xs text-muted"><tr><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3">Failure reason</th></tr></thead><tbody>{withdrawals.map((withdrawal) => <tr key={withdrawal.id} className="border-b border-hairline/70"><td className="p-3 font-semibold text-ink">{money(withdrawal.amount)}</td><td className="p-3 text-muted">{withdrawal.status}</td><td className="p-3 text-muted">{new Date(withdrawal.created_at).toLocaleString()}</td><td className="p-3 text-xs text-marigold-deep">{withdrawal.failure_reason || '—'}</td></tr>)}</tbody></table></div>}
      </section>
    </section>
  )
}

function ReportsQueue() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { loadReports() }, [])

  async function loadReports() {
    setLoading(true)
    const { data } = await supabase
      .from('reports')
      .select('*, reporter:reporter_id(business_name, full_name), reported:reported_id(id, business_name, full_name, status)')
      .in('status', ['open', 'reviewing'])
      .order('created_at', { ascending: true })

    // warning_count is private; admins read it through admin_get_profiles.
    const reportedIds = [...new Set((data || []).map((report) => report.reported?.id).filter(Boolean))]
    const { data: privateRows } = reportedIds.length
      ? await supabase.rpc('admin_get_profiles', { p_ids: reportedIds })
      : { data: [] }
    const warningsById = new Map((privateRows || []).map((row) => [row.id, row.warning_count]))
    setReports((data || []).map((report) => report.reported
      ? { ...report, reported: { ...report.reported, warning_count: warningsById.get(report.reported.id) ?? 0 } }
      : report))
    setLoading(false)
  }

  async function issueWarning(report) {
    setBusyId(report.id)
    // Records the warning, updates the count/suspension and closes the report in one step.
    const { data, error } = await supabase.rpc('admin_issue_warning', { p_report_id: report.id })
    if (error || !data?.success) alert(error?.message || data?.error || 'The warning could not be issued.')

    setBusyId(null)
    loadReports()
  }

  async function dismiss(report) {
    setBusyId(report.id)
    const { error } = await supabase.from('reports').update({ status: 'dismissed' }).eq('id', report.id)
    if (error) alert(`The report could not be dismissed: ${error.message}`)
    setBusyId(null)
    loadReports()
  }

  async function reactivate(report) {
    setBusyId(report.id)
    const { error } = await supabase.from('profiles').update({ status: 'active' }).eq('id', report.reported.id)
    if (error) alert(`The account could not be reactivated: ${error.message}`)
    setBusyId(null)
    loadReports()
  }

  return (
    <section className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Reports & moderation</h1>
      <p className="mt-2 text-sm text-muted">
        3 warnings suspends an account automatically. Buyers have up to 2 days from receiving
        an item/service to file a dispute — Trustall mediates directly via WhatsApp or the platform.
      </p>

      {loading && <p className="mt-10 text-muted">Loading reports…</p>}
      {!loading && reports.length === 0 && (
        <p className="mt-10 rounded-xl border border-hairline bg-white p-6 text-muted">No open reports.</p>
      )}

      <div className="mt-8 space-y-4">
        {reports.map((r) => (
          <div key={r.id} className="rounded-2xl border border-hairline bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-display text-base text-ink">
                    {r.reported?.business_name || r.reported?.full_name || 'Unknown user'}
                  </p>
                  {r.is_dispute && (
                    <span className="rounded-full bg-marigold px-2 py-0.5 font-mono text-[10px] font-semibold text-ink">DISPUTE</span>
                  )}
                </div>
                <p className="mt-1 font-mono text-xs text-muted">
                  Reported by {r.reporter?.business_name || r.reporter?.full_name || 'Unknown'} · {r.reason}
                </p>
                {r.details && <p className="mt-2 text-sm text-muted">{r.details}</p>}
                <p className="mt-2 font-mono text-xs text-marigold-deep">
                  {r.reported?.warning_count || 0} prior warning(s) · status: {r.reported?.status}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.reported?.status === 'suspended' ? (
                <button
                  disabled={busyId === r.id} onClick={() => reactivate(r)}
                  className="rounded-full bg-seal px-4 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep disabled:opacity-50"
                >
                  Reactivate account
                </button>
              ) : (
                <button
                  disabled={busyId === r.id} onClick={() => issueWarning(r)}
                  className="rounded-full bg-marigold-deep px-4 py-2 font-mono text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Issue warning ({(r.reported?.warning_count || 0) + 1}/3)
                </button>
              )}
              <button
                disabled={busyId === r.id} onClick={() => dismiss(r)}
                className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
