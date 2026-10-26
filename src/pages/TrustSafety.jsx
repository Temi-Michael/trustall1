import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const sectionLabels = {
  buyer_rules: '🛡️ Rules for Buyers',
  seller_rules: '🛡️ Rules for Sellers',
  admin_rules: '⚖️ Platform & Admin Rules',
}

export default function TrustSafety() {
  const [rules, setRules] = useState({ buyer_rules: [], seller_rules: [], admin_rules: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadRules() {
      const { data, error } = await supabase
        .from('platform_rules')
        .select('*')
        .order('display_order', { ascending: true })

      if (error) {
        console.error('Failed to load platform rules:', error)
        setRules({ buyer_rules: [], seller_rules: [], admin_rules: [] })
        setLoading(false)
        return
      }

      const grouped = { buyer_rules: [], seller_rules: [], admin_rules: [] }
      ;(data || []).forEach((rule) => {
        if (grouped[rule.section]) grouped[rule.section].push(rule)
      })
      setRules(grouped)
      setLoading(false)
    }

    loadRules()
  }, [])

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-10">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">Trust & Safety</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-ink">The Trustall rules that protect every transaction.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          These rules are the foundation of how we protect buyers, sellers, and the platform. Read them before you start a dispute or publish a listing.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-hairline bg-white p-8 text-sm text-muted">Loading the policy…</div>
      ) : (
        <div className="space-y-10">
          {Object.entries(sectionLabels).map(([section, label]) => (
            <details key={section} className="group rounded-3xl border border-hairline bg-white p-6 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <span className="font-display text-2xl font-bold text-ink">{label}</span>
                <ChevronDown size={20} aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-6 space-y-5">
                {rules[section]?.length ? rules[section].map((rule) => (
                  <article key={rule.id} className="rounded-2xl border border-hairline bg-surfacealt p-4">
                    <h3 className="font-display text-lg font-semibold text-ink">{rule.title}</h3>
                    <div className="mt-3 prose prose-sm max-w-none text-sm leading-7 text-muted whitespace-pre-line">
                      {rule.body}
                    </div>
                  </article>
                )) : (
                  <p className="text-sm text-muted">No rules are available for this section yet.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/" className="rounded-full bg-ink px-5 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-inksoft">Back home</Link>
        <Link to="/support" className="rounded-full border border-hairline px-5 py-2.5 font-mono text-xs text-ink hover:border-seal hover:text-seal">Need help?</Link>
      </div>
    </section>
  )
}
