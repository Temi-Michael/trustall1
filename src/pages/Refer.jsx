import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { useBalanceVisibility } from '../lib/useBalanceVisibility.js'
import { formatBalance } from '../lib/balanceDisplay.js'
import BalanceToggle from '../components/BalanceToggle.jsx'

export default function Refer() {
  const { session, profile, loading } = useProfile()
  const navigate = useNavigate()
  const [bonuses, setBonuses] = useState([])
  const [copied, setCopied] = useState(false)
  const { hidden: balancesHidden, toggle: toggleBalances } = useBalanceVisibility()

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/refer' } })
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session) return
    supabase.from('referral_bonuses').select('*, referred:referred_id(full_name, business_name)')
      .eq('referrer_id', session.user.id).order('created_at', { ascending: false })
      .then(({ data }) => setBonuses(data || []))
  }, [session])

  if (loading || !profile) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  const link = `${window.location.origin}/auth?ref=${profile.referral_code}`

  function copyLink() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const whatsappMessage = encodeURIComponent(
    `Join me on Trustall — a marketplace where every seller is verified and every payment is protected. Sign up here: ${link}`
  )

  return (
    <section className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Refer a friend</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">
        Earn ₦1,000 for every friend you bring.
      </h1>
      <p className="mt-4 text-sm text-muted">
        Share your link. Once they complete their first purchase or sale on Trustall,
        ₦1,000 lands in your wallet automatically.
      </p>

      <div className="mt-8 flex items-center gap-2 rounded-full border border-hairline bg-white p-2 pl-5">
        <span className="flex-1 truncate text-left font-mono text-sm text-muted">{link}</span>
        <button
          onClick={copyLink}
          className="rounded-full bg-ink px-5 py-2 font-mono text-xs font-medium text-surface hover:bg-inksoft"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <a
        href={`https://wa.me/?text=${whatsappMessage}`}
        target="_blank" rel="noreferrer"
        className="mt-4 inline-block rounded-full bg-marigold px-7 py-3 font-body text-sm font-semibold text-ink hover:bg-marigold-deep"
      >
        Share on WhatsApp
      </a>

      <div className="mt-12 flex justify-end">
        <BalanceToggle hidden={balancesHidden} onToggle={toggleBalances} className="border border-hairline text-muted hover:border-ink hover:text-ink" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <p className="font-mono text-2xl font-semibold text-seal">{formatBalance(profile.wallet_cleared, balancesHidden)}</p>
          <p className="mt-1 text-xs text-muted">Cleared — earned and ready</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-6">
          <p className="font-mono text-2xl font-semibold text-marigold-deep">{formatBalance(profile.wallet_pending, balancesHidden)}</p>
          <p className="mt-1 text-xs text-muted">Pending — waiting on their first order</p>
        </div>
      </div>

      {bonuses.length > 0 && (
        <div className="mt-10 text-left">
          <h2 className="font-display text-base text-ink">Your referrals</h2>
          <div className="mt-3 space-y-2">
            {bonuses.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl border border-hairline bg-white px-4 py-3 text-sm">
                <span className="text-ink">{b.referred?.business_name || b.referred?.full_name || 'A new member'}</span>
                <span className={`font-mono text-xs ${b.status === 'cleared' || b.status === 'paid' ? 'text-seal' : 'text-muted'}`}>
                  ₦{Number(b.amount).toLocaleString()} · {b.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
