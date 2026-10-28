import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { safeFileName } from '../lib/inputSafety.js'

export default function DisputePage() {
  const { disputeId } = useParams()
  const navigate = useNavigate()
  const { session, profile, loading } = useProfile()
  const [dispute, setDispute] = useState(null)
  const [messages, setMessages] = useState([])
  const [judges, setJudges] = useState([])
  const [judgement, setJudgement] = useState('')
  const [winnerId, setWinnerId] = useState('')
  const [body, setBody] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [sending, setSending] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [showGatekeeper, setShowGatekeeper] = useState(true)
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!loading && !session) {
      navigate('/auth', { state: { redirectTo: `/disputes/${disputeId}` } })
      return
    }

    if (!disputeId) return
    loadDispute()
    loadJudges()

    const channel = supabase
      .channel(`dispute-thread-${disputeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dispute_messages', filter: `dispute_id=eq.${disputeId}` }, () => loadDispute())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [disputeId, loading, session, navigate])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadDispute() {
    setLoadingData(true)

    const [{ data: disputeData }, { data: messagesData }] = await Promise.all([
      supabase.from('disputes').select('*, order:order_id(buyer_id, seller_id, buyer:buyer_id(id, full_name, business_name, handle), seller:seller_id(id, full_name, business_name, handle)), filed_by_profile:filed_by(full_name, business_name, role), assigned_judge:assigned_judge_id(full_name, business_name, role)').eq('id', disputeId).single(),
      supabase.from('dispute_messages').select('*, sender:sender_id(full_name, business_name, role), dispute_evidence(*)').eq('dispute_id', disputeId).order('created_at', { ascending: true }),
    ])

    setDispute(disputeData)
    setMessages(messagesData || [])
    setLoadingData(false)
  }

  async function loadJudges() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, business_name, role, is_dispute_judge')
      .or('is_dispute_judge.eq.true,role.eq.admin')
      .order('business_name', { ascending: true })

    setJudges(data || [])
  }

  const isParticipant = useMemo(() => {
    if (!dispute || !session) return false
    return [dispute.filed_by, dispute.order?.buyer_id, dispute.order?.seller_id].includes(session.user.id)
  }, [dispute, session])

  async function onSendMessage(event) {
    event.preventDefault()
    if (!body.trim() && selectedFiles.length === 0) return
    setSending(true)
    setError('')

    try {
      const { data: msg, error: messageError } = await supabase
        .from('dispute_messages')
        .insert({ dispute_id: disputeId, sender_id: session.user.id, body: body.trim() || '' })
        .select()
        .single()

      if (messageError) throw messageError

      if (selectedFiles.length > 0) {
        const uploaded = []
        for (const file of selectedFiles) {
          const safeName = `${Date.now()}_${safeFileName(file.name)}`
          const path = `dispute-evidence/${disputeId}/${safeName}`
          const { error: uploadError } = await supabase.storage.from('dispute-evidence').upload(path, file, { upsert: true })
          if (uploadError) throw uploadError
          const { data: urlData } = supabase.storage.from('dispute-evidence').getPublicUrl(path)
          uploaded.push({
            dispute_message_id: msg.id,
            file_url: urlData.publicUrl,
            file_type: file.type.startsWith('video/') ? 'video' : 'image',
          })
        }

        if (uploaded.length > 0) {
          const { error: evidenceError } = await supabase.from('dispute_evidence').insert(uploaded)
          if (evidenceError) throw evidenceError
        }
      }

      setBody('')
      setSelectedFiles([])
      await loadDispute()
    } catch (err) {
      console.error('Failed to send dispute message:', err)
      setError(err.message || 'Unable to send your dispute message right now.')
    } finally {
      setSending(false)
    }
  }

  async function assignJudge() {
    if (!winnerId) return
    setProcessing(true)
    const { error } = await supabase.from('disputes').update({
      assigned_judge_id: winnerId,
      status: 'under_review',
    }).eq('id', disputeId)

    if (error) {
      setError(error.message)
    } else {
      await loadDispute()
    }
    setProcessing(false)
  }

  async function resolveDispute() {
    if (!judgement.trim()) return
    setProcessing(true)
    setError('')

    try {
      const isFavorBuyer = winnerId === dispute.order?.buyer_id
      const { data: { session } } = await supabase.auth.getSession()

      if (isFavorBuyer) {
        // Task 5: Call resolve-dispute-refund-buyer edge function instead of RPC
        const refundRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-dispute-refund-buyer`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              dispute_id: disputeId,
              resolution_text: judgement.trim(),
            }),
          }
        )
        const refundData = await refundRes.json()

        if (!refundRes.ok) {
          throw new Error(refundData.error || refundData.message || 'Failed to resolve dispute')
        }

        if (refundData.needs_manual_admin_action && refundData.message) {
          alert(`⚠️ Manual action required:\n\n${refundData.message}`)
        } else if (refundData.refunded) {
          alert('✓ Dispute resolved in buyer\'s favor. Refund has been processed.')
        }
      } else {
        // Task 4: Call favor_seller RPC, then chain payout processing
        const { error } = await supabase.rpc('resolve_dispute_favor_seller', {
          p_dispute_id: disputeId,
          p_resolution_text: judgement.trim(),
        })

        if (error) throw error

        // Chain payout processing after resolution succeeds
        const payoutRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-process-payout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ order_id: dispute.order?.id }),
          }
        )
        const payoutData = await payoutRes.json()

        if (!payoutRes.ok) {
          console.error('Payout processing error:', payoutData)
          alert(`✓ Dispute resolved in seller's favor. ⚠️ Payout processing encountered an issue. Admin team has been notified. Details: ${payoutData.error || payoutData.message || 'Unknown error'}`)
        } else if (payoutData.otp_required) {
          alert(`✓ Dispute resolved in seller's favor. ⚠️ Seller's payout requires verification:\n\n${payoutData.message || 'The seller must verify this transfer in their Paystack dashboard within 24 hours.'}\n\nOur admin team has been notified.`)
        } else {
          alert('✓ Dispute resolved in seller\'s favor. Seller will receive payment within 24 hours.')
        }
      }

      await loadDispute()
      setJudgement('')
      setWinnerId('')
    } catch (err) {
      setError(err.message)
    }
    setProcessing(false)
  }

  if (loading || loadingData) return <div className="px-6 py-24 text-center text-muted">Loading dispute…</div>
  if (!dispute) return <div className="px-6 py-24 text-center text-muted">Dispute not found.</div>

  const isAdmin = profile?.role === 'admin'
  const isJudge = isAdmin || dispute.assigned_judge_id === session?.user?.id
  const isResolved = Boolean(dispute.resolution || dispute.resolved_at || String(dispute.status || '').startsWith('resolved'))
  const viewerRole = isAdmin ? 'Admin' : dispute.assigned_judge_id === session?.user?.id ? 'Mediator' : dispute.filed_by === session?.user?.id ? 'Complainant' : dispute.order?.buyer_id === session?.user?.id || dispute.order?.seller_id === session?.user?.id ? 'Order party' : 'Viewer'
  const participantName = dispute.filed_by_profile?.business_name || dispute.filed_by_profile?.full_name || 'User'

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      {showGatekeeper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-3xl border border-hairline bg-white p-6 shadow-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-seal">Dispute reminder</p>
            <h2 className="mt-3 font-display text-2xl font-bold text-ink">To ensure a fast resolution, please follow these rules:</h2>
            <ul className="mt-5 min-h-0 flex-1 list-decimal space-y-3 overflow-y-auto pl-5 text-sm leading-7 text-muted">
              <li>Upload clear evidence. Unboxing videos are prioritized.</li>
              <li>Keep it professional. Insults will result in account suspension.</li>
              <li>The Trustall Admin's decision based on the evidence provided here is final.</li>
            </ul>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3">
              <a href="/trust-safety" target="_blank" rel="noreferrer" className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal">Read full rules</a>
              <button type="button" onClick={() => setShowGatekeeper(false)} className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep">I Understand</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Dispute</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Case #{String(dispute.id).slice(0, 8)}</h1>
        </div>
        <Link to="/orders" className="rounded-full border border-hairline px-4 py-2 font-mono text-xs text-ink hover:border-seal hover:text-seal">Back to orders</Link>
      </div>

      <div className="mb-6 rounded-2xl border border-hairline bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Filed by: <span className="font-semibold text-ink">{participantName}</span></p>
            <p className="mt-1 text-xs text-muted">Status: <span className="font-semibold text-ink">{isResolved ? 'Resolved · archived' : dispute.status}</span> · You are viewing as <span className="font-semibold text-ink">{viewerRole}</span></p>
            <p className="mt-2 text-xs text-muted">Buyer: <span className="font-semibold text-ink">{dispute.order?.buyer?.business_name || dispute.order?.buyer?.full_name || 'Buyer'}</span> · Seller: <span className="font-semibold text-ink">{dispute.order?.seller?.business_name || dispute.order?.seller?.full_name || 'Seller'}</span></p>
          </div>
          <a href="/trust-safety" className="rounded-full bg-surfacealt px-4 py-2 font-mono text-xs font-semibold text-ink hover:bg-surface">Read the Trustall dispute rules before continuing</a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl border border-hairline bg-white">
          <div className="border-b border-hairline p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Case reason</p>
            <p className="mt-2 text-sm leading-7 text-ink">{dispute.reason || 'No reason provided.'}</p>
          </div>

          <div className="max-h-[560px] space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && <p className="text-sm text-muted">No evidence or messages yet.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.sender_id === session?.user?.id ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl border p-3 ${message.sender_id === session?.user?.id ? 'bg-seal text-surface border-seal' : 'bg-surfacealt text-ink border-hairline'}`}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-wide opacity-80">
                    <span>{message.sender?.business_name || message.sender?.full_name || 'User'}</span>
                    <span>{message.sender?.role || 'User'}</span>
                  </div>
                  {message.body && <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>}
                  {message.dispute_evidence?.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {message.dispute_evidence.map((file) => (
                        <div key={file.id} className="overflow-hidden rounded-xl border border-current/20 bg-white/10">
                          {file.file_type === 'video' ? (
                            <video controls src={file.file_url} className="h-36 w-full object-cover" />
                          ) : (
                            <img src={file.file_url} alt="Dispute evidence" className="h-36 w-full object-cover" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {isResolved ? (
            <div className="border-t border-hairline bg-surfacealt p-4 text-sm text-muted">This dispute is resolved. The conversation is archived and read-only.</div>
          ) : !isParticipant && !isJudge ? (
            <div className="border-t border-hairline bg-surfacealt p-4 text-sm text-muted">Only the complainant, order party, assigned mediator, or an admin can post in this conversation.</div>
          ) : (
          <form onSubmit={onSendMessage} className="border-t border-hairline p-4">
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} placeholder="Add evidence, context, or a reply…" className="w-full rounded-2xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-ink outline-none focus:border-seal" />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input type="file" multiple accept="image/*,video/*" onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))} className="text-sm text-muted" />
              <button type="submit" disabled={sending} className="rounded-full bg-seal px-5 py-2 font-mono text-xs font-semibold text-surface hover:bg-seal-deep disabled:opacity-50">{sending ? 'Sending…' : 'Send message'}</button>
            </div>
            {error && <p className="mt-3 text-sm text-marigold-deep">{error}</p>}
          </form>
          )}
        </div>

        <aside className="space-y-6">
          {isAdmin && !isResolved && <div className="rounded-3xl border border-hairline bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Judge assignment</p>
            <select value={winnerId} onChange={(event) => setWinnerId(event.target.value)} className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2.5 text-sm text-ink outline-none focus:border-seal">
              <option value="">Select judge / admin</option>
              {judges.map((judge) => (
                <option key={judge.id} value={judge.id}>{judge.business_name || judge.full_name || 'Staff'} — {judge.role}</option>
              ))}
            </select>
            <button type="button" disabled={processing || !winnerId} onClick={assignJudge} className="mt-3 w-full rounded-full bg-ink px-4 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-inksoft disabled:opacity-50">Assign judge</button>
            {dispute.assigned_judge_id && (
              <p className="mt-3 text-xs text-muted">Assigned judge: {dispute.assigned_judge?.business_name || dispute.assigned_judge?.full_name || 'Staff'}</p>
            )}
          </div>}

          {isJudge && !isResolved && <div className="rounded-3xl border border-hairline bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Resolve dispute</p>
            <textarea value={judgement} onChange={(event) => setJudgement(event.target.value)} rows={4} placeholder="Explain the final decision…" className="mt-3 w-full rounded-2xl border border-hairline bg-surfacealt px-3 py-2.5 text-sm text-ink outline-none focus:border-seal" />
            <select value={winnerId} onChange={(event) => setWinnerId(event.target.value)} className="mt-3 w-full rounded-xl border border-hairline bg-surfacealt px-3 py-2.5 text-sm text-ink outline-none focus:border-seal">
              <option value="">Winner</option>
              {dispute.order ? (
                <>
                  <option value={dispute.order.buyer_id}>Buyer</option>
                  <option value={dispute.order.seller_id}>Seller</option>
                </>
              ) : null}
            </select>
            <div className="mt-3 grid gap-2">
              <button type="button" disabled={processing || !judgement.trim() || winnerId !== dispute.order?.buyer_id} onClick={resolveDispute} className="w-full rounded-full bg-seal px-4 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-seal-deep disabled:opacity-50">Resolve in buyer's favor / refund buyer</button>
              <button type="button" disabled={processing || !judgement.trim() || winnerId !== dispute.order?.seller_id} onClick={resolveDispute} className="w-full rounded-full bg-ink px-4 py-2.5 font-mono text-xs font-semibold text-surface hover:bg-inksoft disabled:opacity-50">Resolve in seller's favor / release payment</button>
            </div>
          </div>}

          {dispute.resolution && (
            <div className="rounded-3xl border border-seal/30 bg-seal/5 p-5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-seal">Decision</p>
              <p className="mt-2 text-sm leading-7 text-ink">{dispute.resolution}</p>
            </div>
          )}
        </aside>
      </div>

      {!isParticipant && !isJudge && (
        <div className="mt-6 rounded-2xl border border-marigold/30 bg-marigold/10 p-4 text-sm text-marigold-deep">You are not a participant in this dispute.</div>
      )}
    </section>
  )
}

export function MyDisputes() {
  const { session, loading } = useProfile()
  const navigate = useNavigate()
  const [disputes, setDisputes] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/disputes' } })
  }, [loading, session, navigate])

  useEffect(() => {
    if (!session?.user?.id) return
    supabase
      .from('disputes')
      .select('id, status, reason, created_at, order:order_id(buyer_id, seller_id, buyer:buyer_id(full_name, business_name), seller:seller_id(full_name, business_name))')
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (queryError) {
          console.error('Failed to load disputes:', queryError)
          setError(queryError.message || 'Unable to load disputes.')
          return
        }
        setDisputes((data || []).filter((item) => item.order?.buyer_id === session.user.id || item.order?.seller_id === session.user.id))
      })
      .catch((queryError) => {
        console.error('Failed to load disputes:', queryError)
        setError(queryError.message || 'Unable to load disputes.')
      })
  }, [session?.user?.id])

  if (loading || !session) return <div className="px-6 py-24 text-center text-muted">Loading disputes…</div>
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Trust & Safety</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">My disputes</h1>
      {error && <p className="mt-4 text-sm text-marigold-deep">{error}</p>}
      <div className="mt-8 space-y-3">
        {disputes.length === 0 && !error && <p className="text-sm text-muted">You have no disputes.</p>}
        {disputes.map((item) => (
          <Link key={item.id} to={`/disputes/${item.id}`} className="block rounded-2xl border border-hairline bg-white p-5 hover:border-seal">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-ink">Case #{String(item.id).slice(0, 8)}</p>
              <span className="font-mono text-xs uppercase text-seal">{item.status}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{item.reason || 'No reason provided.'}</p>
            <p className="mt-2 text-xs text-muted">Buyer: {item.order?.buyer?.business_name || item.order?.buyer?.full_name || 'Buyer'} · Seller: {item.order?.seller?.business_name || item.order?.seller?.full_name || 'Seller'}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
