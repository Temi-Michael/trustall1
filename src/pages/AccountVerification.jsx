import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { usePaymentReadiness } from '../lib/usePaymentReadiness.js'
import { PAYMENT_REQUIREMENTS } from '../lib/paymentReadiness.js'
import { saveProfileSetup, withProfileSetupApplied } from '../lib/profileSetup.js'
import { buildAuthCallbackUrl, getAuthIntent, safeRedirectPath } from '../lib/authFlow.js'
import { isValidPhone } from '../lib/inputSafety.js'
import { getSupportEmail } from '../lib/authRedirect.js'

const REQUIREMENT_BY_CODE = Object.fromEntries(PAYMENT_REQUIREMENTS.map((requirement) => [requirement.code, requirement]))

const CARD_CLASS = 'rounded-[24px] border border-hairline bg-white p-5 sm:p-6'
const INPUT_CLASS = 'w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-seal outline-none'
const BUTTON_CLASS = 'rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-seal-deep disabled:opacity-50'

function RequirementCard({ requirement, done, children }) {
  const Icon = done ? CheckCircle2 : Circle
  return (
    <section className={CARD_CLASS}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${done ? 'text-seal' : 'text-muted'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink">
            {requirement.label}
            <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
          </h2>
          {!done && <p className="mt-1 text-sm text-muted">{requirement.help}</p>}
          {children}
        </div>
      </div>
    </section>
  )
}

/**
 * "Verification": what an account needs before it can pay (migration 0040),
 * with a way to fix each item here. Reached from the account menu, the
 * setup reminder banner and the checkout's "Verify to pay" link, which passes
 * ?redirectTo= so the user can go straight back.
 */
export default function AccountVerification() {
  const { session, profile, setProfile, loading } = useProfile()
  const { readiness, refresh } = usePaymentReadiness()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('redirectTo') ? safeRedirectPath(searchParams.get('redirectTo')) : null

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [busyStep, setBusyStep] = useState(null)
  const [messages, setMessages] = useState({})

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/account/verification' } })
  }, [loading, session, navigate])

  // Prefill from the profile (or the Google account's name) once it loads.
  useEffect(() => {
    if (!profile) return
    const providerName = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || ''
    setFullName((current) => current || profile.full_name || providerName)
    setPhone((current) => current || profile.phone || '')
  }, [profile, session?.user?.user_metadata])

  if (loading || !session) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  const missing = new Set(readiness?.missing || [])
  const isDone = (code) => Boolean(readiness?.checked) && !missing.has(code)
  const stepsLeft = readiness?.checked ? readiness.missing.length : null

  function setMessage(step, text, isError = false) {
    setMessages((current) => ({ ...current, [step]: text ? { text, isError } : null }))
  }

  async function saveName(event) {
    event.preventDefault()
    const name = fullName.trim()
    if (!name) return setMessage('profile_setup', 'Enter your full name.', true)
    setBusyStep('profile_setup')
    setMessage('profile_setup', '')
    try {
      // The invite code may still be in this tab from a Google sign-up.
      const { refCode } = getAuthIntent(new URLSearchParams(), window.sessionStorage)
      const updates = await saveProfileSetup(supabase, { userId: session.user.id, fullName: name, refCode })
      setProfile((current) => withProfileSetupApplied(current, updates))
      setMessage('profile_setup', 'Saved.')
      await refresh()
    } catch (error) {
      console.error('Saving the profile name failed:', error)
      setMessage('profile_setup', 'Could not save your name. Please try again.', true)
    } finally {
      setBusyStep(null)
    }
  }

  async function savePhone(event) {
    event.preventDefault()
    const cleanPhone = phone.trim()
    if (!isValidPhone(cleanPhone)) return setMessage('phone_missing', 'Enter a valid phone number: digits, spaces, + and - only.', true)
    setBusyStep('phone_missing')
    setMessage('phone_missing', '')
    // Same private table the seller workspace uses (migration 0028).
    const { error } = await supabase
      .from('profile_contacts')
      .upsert({ id: session.user.id, phone: cleanPhone, updated_at: new Date().toISOString() })
    if (error) {
      console.error('Saving the phone number failed:', error)
      setMessage('phone_missing', error.code === '23514' ? 'Enter a valid phone number: digits, spaces, + and - only.' : 'Could not save your phone number. Please try again.', true)
    } else {
      setProfile((current) => (current ? { ...current, phone: cleanPhone } : current))
      setMessage('phone_missing', 'Saved.')
      await refresh()
    }
    setBusyStep(null)
  }

  async function resendConfirmation() {
    setBusyStep('email_unconfirmed')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: session.user.email,
      options: { emailRedirectTo: buildAuthCallbackUrl(window.location.origin, '/account/verification') },
    })
    setMessage('email_unconfirmed', error ? 'Could not send the email. Please try again in a few minutes.' : `Sent to ${session.user.email}.`, Boolean(error))
    setBusyStep(null)
  }

  const stepFeedback = (step) => messages[step] && (
    <p role={messages[step].isError ? 'alert' : 'status'} className={`mt-2 text-sm ${messages[step].isError ? 'text-marigold-deep' : 'text-seal'}`}>
      {messages[step].text}
    </p>
  )

  return (
    <section className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-14">
      <div className="border-b border-hairline pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Account</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Verification</h1>
        <p className="mt-2 text-sm text-muted">
          Before you can pay for anything on Trustall, your account needs the steps below. It keeps buyers and sellers safe.
        </p>
      </div>

      {readiness?.checked && readiness.ready && (
        <div role="status" className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          You're verified and can pay for orders on Trustall.
          {returnTo && <> <Link to={returnTo} className="font-semibold underline">Go back</Link></>}
        </div>
      )}
      {readiness && !readiness.checked && (
        <p className="mt-6 rounded-2xl border border-hairline bg-surfacealt px-4 py-3 text-sm text-muted">
          Payment checks aren't switched on yet. You can still add your details now.
        </p>
      )}
      {stepsLeft > 0 && (
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-muted">
          {stepsLeft} {stepsLeft === 1 ? 'step' : 'steps'} left
        </p>
      )}

      <div className="mt-4 space-y-4">
        <RequirementCard requirement={REQUIREMENT_BY_CODE.email_unconfirmed} done={isDone('email_unconfirmed')}>
          {missing.has('email_unconfirmed') && (
            <>
              <button type="button" onClick={resendConfirmation} disabled={busyStep === 'email_unconfirmed'} className={`mt-3 ${BUTTON_CLASS}`}>
                {busyStep === 'email_unconfirmed' ? 'Sending…' : 'Resend confirmation email'}
              </button>
              {stepFeedback('email_unconfirmed')}
            </>
          )}
        </RequirementCard>

        <RequirementCard requirement={REQUIREMENT_BY_CODE.profile_setup} done={isDone('profile_setup')}>
          {(missing.has('profile_setup') || !readiness?.checked) && (
            <form onSubmit={saveName} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input required autoComplete="name" placeholder="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} className={INPUT_CLASS} />
              <button type="submit" disabled={busyStep === 'profile_setup'} className={BUTTON_CLASS}>
                {busyStep === 'profile_setup' ? 'Saving…' : 'Save'}
              </button>
            </form>
          )}
          {stepFeedback('profile_setup')}
        </RequirementCard>

        <RequirementCard requirement={REQUIREMENT_BY_CODE.phone_missing} done={isDone('phone_missing')}>
          {/* Always editable: this is also where buyers change their number. */}
          <form onSubmit={savePhone} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input required type="tel" autoComplete="tel" placeholder="e.g. 0803 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} className={INPUT_CLASS} />
            <button type="submit" disabled={busyStep === 'phone_missing'} className={BUTTON_CLASS}>
              {busyStep === 'phone_missing' ? 'Saving…' : profile?.phone ? 'Update' : 'Save'}
            </button>
          </form>
          {stepFeedback('phone_missing')}
        </RequirementCard>

        <RequirementCard requirement={REQUIREMENT_BY_CODE.account_suspended} done={isDone('account_suspended')}>
          {missing.has('account_suspended') && (
            <a href={`mailto:${getSupportEmail()}`} className="mt-3 inline-block text-sm font-semibold text-seal hover:text-seal-deep">
              Email {getSupportEmail()}
            </a>
          )}
        </RequirementCard>
      </div>
    </section>
  )
}
