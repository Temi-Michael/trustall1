import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useProfile } from '../lib/useProfile.js'
import { supabase } from '../lib/supabaseClient.js'
import { NotificationBell } from './NotificationBell.jsx'

function getAvatarUrl(profile) {
  if (!profile) return null
  return profile.avatar_url || null
}

function isSellerProfile(profile) {
  return Boolean(profile?.is_seller || profile?.verified_seller || profile?.seller_level >= 1 || profile?.status === 'seller')
}

function SealMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#2F6E51" />
      <circle cx="20" cy="20" r="19" stroke="#E8A33D" strokeWidth="1.5" strokeDasharray="2 2.4" />
      <path d="M12 20.5l5 5 11-11.5" stroke="#FAF8F4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function MobileNavIcon({ type, active }) {
  const common = `h-5 w-5 transition-transform duration-200 ${active ? 'scale-110' : ''}`

  if (type === 'messages') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} aria-hidden="true">
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v5A2.5 2.5 0 0 1 16.5 14H9l-4 3v-3H7.5A2.5 2.5 0 0 1 5 11.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (type === 'orders') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} aria-hidden="true">
        <rect x="4" y="6" width="16" height="13" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 10h10M7 14h7" strokeLinecap="round" />
      </svg>
    )
  }

  if (type === 'sell') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} aria-hidden="true">
        <path d="M12 4v16M4 12h16" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AccountMenu({ profile }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const isSellerAccount = isSellerProfile(profile)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Open account menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-inksoft font-display text-xs font-bold text-surface"
      >
        {getAvatarUrl(profile) ? (
          <img src={getAvatarUrl(profile)} alt="Profile" className="h-full w-full object-cover" />
        ) : (
          (profile?.business_name || profile?.full_name || '?').slice(0, 2).toUpperCase()
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-hairline bg-white p-1.5 shadow-lg">
          <p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Your account</p>
          <Link to="/account" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">{isSellerAccount ? 'My storefront' : 'My profile'}</Link>
          <Link to="/messages" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Messages</Link>
          <Link to="/orders" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Orders</Link>
          <Link to="/saved" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Saved listings</Link>
          <Link to="/refer" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Refer a friend</Link>
          {isSellerAccount && (
            <>
              <div className="my-1 border-t border-hairline" />
              <p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Seller tools</p>
              <Link to="/sell" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Seller workspace</Link>
            </>
          )}
          {profile?.verified_seller && (
            <Link to="/marketing" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surfacealt">Marketing</Link>
          )}
          <div className="my-1 border-t border-hairline" />
          <button
            onClick={() => { supabase.auth.signOut(); setOpen(false) }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surfacealt"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

const NAV_LINKS = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/sellers', label: 'All sellers' },
  { to: '/trust-safety', label: 'Trust & Safety' },
  { to: '/blog', label: 'Blog' },
]

export function MobileBottomNav() {
  const { session } = useProfile()
  const location = useLocation()
  const [messageBadge, setMessageBadge] = useState(0)
  const isConversationOpen = /^\/messages\/[^/]+/.test(location.pathname)

  useEffect(() => {
    if (!session?.user?.id) return
    let active = true
    const activeConversationId = location.pathname.match(/^\/messages\/([^/]+)/)?.[1] || null

    async function loadBadge() {
      const { data: conversations = [] } = await supabase.from('conversations').select('id, buyer_id, seller_id, buyer_last_read_at, seller_last_read_at').or(`buyer_id.eq.${session.user.id},seller_id.eq.${session.user.id}`)
      const conversationIds = (conversations || []).map((conversation) => conversation.id)
      if (conversationIds.length === 0) {
        if (active) setMessageBadge(0)
        return
      }
      const { data: messages = [] } = await supabase.from('messages').select('conversation_id, created_at, sender_id').in('conversation_id', conversationIds).neq('sender_id', session.user.id)
      const readAtByConversation = (conversations || []).reduce((map, conversation) => {
        const isBuyer = conversation.buyer_id === session.user.id
        map[conversation.id] = isBuyer ? conversation.buyer_last_read_at : conversation.seller_last_read_at
        return map
      }, {})
      const unread = messages.filter((message) => {
        if (message.conversation_id === activeConversationId) return false
        const lastReadAt = readAtByConversation[message.conversation_id]
        return !lastReadAt || new Date(message.created_at).getTime() > new Date(lastReadAt).getTime()
      }).length
      if (active) setMessageBadge(unread)
    }

    loadBadge()
    const handleConversationRead = () => loadBadge()
    window.addEventListener('trustall:conversation-read', handleConversationRead)
    const channel = supabase
      .channel(`mobile-nav-badge-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, loadBadge)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, loadBadge)
      .subscribe()
    return () => {
      active = false
      window.removeEventListener('trustall:conversation-read', handleConversationRead)
      supabase.removeChannel(channel)
    }
  }, [session?.user?.id, location.pathname])

  const mobileLinks = [
    { to: '/', label: 'Home', icon: 'home' },
    { to: '/messages', label: 'Messages', icon: 'messages' },
    { to: '/orders', label: 'Orders', icon: 'orders' },
    { to: '/sell', label: 'Sell', icon: 'sell' },
  ]

  if (isConversationOpen) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/95 px-3 py-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-around rounded-full border border-hairline bg-white/85 p-1.5 shadow-[0_12px_35px_rgba(15,23,42,0.10)]">
        {mobileLinks.map((link) => {
          const active = link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center rounded-full px-2 py-2 text-[10px] font-semibold transition-all duration-200 ${active ? 'bg-seal/12 text-seal shadow-sm' : 'text-muted hover:bg-surfacealt'}`}
            >
              <MobileNavIcon type={link.icon} active={active} />
              <span className="mt-1">{link.label}</span>
              {link.to === '/messages' && messageBadge > 0 && (
                <span className="absolute right-2 top-1 rounded-full bg-marigold px-1.5 py-0.5 text-[9px] font-semibold text-ink">{messageBadge}</span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function Navbar() {
  const { session, profile } = useProfile()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const hideHeaderOnMobileMessageRoute = location.pathname.startsWith('/messages')
  const isSellerAccount = isSellerProfile(profile)
  const visibleNavLinks = session && isSellerAccount ? NAV_LINKS.filter((link) => link.to !== '/sell') : NAV_LINKS

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    setIsOffline(!navigator.onLine)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <header className={`sticky top-0 z-50 border-b border-hairline bg-surface/95 backdrop-blur-md ${hideHeaderOnMobileMessageRoute ? 'hidden md:block' : ''}`}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6 md:py-4">
        <Link to="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <SealMark size={24} />
          <span className="font-display text-lg font-bold text-ink">Trustall</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {visibleNavLinks.map((l) =>
            l.anchor ? (
              <a key={l.label} href={l.to} className="font-body text-sm text-muted hover:text-ink">{l.label}</a>
            ) : (
              <Link key={l.label} to={l.to} className="font-body text-sm text-muted hover:text-ink">{l.label}</Link>
            )
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {isOffline && (
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-marigold bg-marigold/10 px-4 py-2 text-sm font-semibold text-marigold-deep">
                Offline mode
              </span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-hairline bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surfacealt"
              >
                Retry
              </button>
            </div>
          )}
          {session && <NotificationBell userId={session.user.id} />}
          {session ? (
            <AccountMenu profile={profile} />
          ) : (
            <Link
              to="/auth"
              className="rounded-full border border-ink px-3 py-2 font-body text-sm font-medium text-ink transition hover:border-seal hover:text-seal md:px-5"
            >
              Log in
            </Link>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-white text-ink md:hidden"
          >
            {mobileOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="Dismiss navigation menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-ink/20 md:hidden"
          />
          <div className="absolute inset-x-3 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-hairline bg-surface p-4 shadow-[0_20px_60px_rgba(27,31,59,0.2)] md:hidden">
          <div className="flex flex-col gap-1">
            {visibleNavLinks.map((l) =>
              l.anchor ? (
                <a
                  key={l.label} href={l.to} onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-2 py-2.5 font-body text-sm text-ink hover:bg-surfacealt"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label} to={l.to} onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-2 py-2.5 font-body text-sm text-ink hover:bg-surfacealt"
                >
                  {l.label}
                </Link>
              )
            )}

            <div className="my-2 border-t border-hairline" />

            {!session && (
              <Link
                to="/auth" onClick={() => setMobileOpen(false)}
                className="rounded-lg px-2 py-2.5 font-body text-sm text-ink hover:bg-surfacealt"
              >
                Log in
              </Link>
            )}

          </div>
          </div>
        </>
      )}

    </header>
  )
}

export { SealMark }
