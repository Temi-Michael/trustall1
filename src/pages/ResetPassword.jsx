import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { completeEmailLinkSignIn } from '../lib/emailLinkSession.js'
import { recoveryLinkStatus } from '../lib/authFlow.js'
import { signOutOtherDevices } from '../lib/signOut.js'

const INVALID_LINK_MESSAGE = 'This password reset link is invalid or has expired. Please request a new one.'
const USED_LINK_MESSAGE = 'This reset link has already been used or has expired. Request a new one if you still need to reset your password.'

function PasswordInput({ label, value, onChange, visible, onToggle, autoComplete }) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">{label}</span>
      <span className="relative block">
        <input
          required
          type={visible ? 'text' : 'password'}
          minLength={8}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-hairline bg-white px-4 py-3 pr-12 text-ink placeholder:text-muted focus:border-seal outline-none"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted hover:bg-surfacealt hover:text-ink"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  )
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [checkingLink, setCheckingLink] = useState(true)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let mounted = true
    let recoveryEventReceived = false

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        recoveryEventReceived = true
        setRecoveryReady(true)
        setError('')
        setCheckingLink(false)
      }
    })

    async function checkRecoverySession() {
      // Reset links sign the user in first (emailLinkSession.js), which also
      // removes the link's secrets from the address, so its type comes from there.
      const emailLink = await completeEmailLinkSignIn()
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (!mounted) return

      const linkStatus = recoveryLinkStatus(emailLink)

      // Each reset link works once. Supabase refuses a used or expired one;
      // that answer wins even if this browser is still signed in from the
      // first use, otherwise the old link would open the form again.
      if (linkStatus === 'used') {
        setError(USED_LINK_MESSAGE)
        setCheckingLink(false)
        return
      }

      if (sessionError || (!data.session && !recoveryEventReceived)) {
        setError(INVALID_LINK_MESSAGE)
        setCheckingLink(false)
        return
      }

      if (linkStatus === 'valid' || recoveryEventReceived) {
        setRecoveryReady(true)
      } else {
        // A PKCE reset link (?code=, sent before the email template change)
        // opened in the browser that asked for it: Supabase signs in during
        // start-up and signals PASSWORD_RECOVERY just after, which the
        // listener above handles. Give it a moment before showing the
        // "invalid link" message.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (!mounted || recoveryEventReceived) return
      }
      setCheckingLink(false)
    }

    checkRecoverySession()

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  function validatePassword() {
    if (password.length < 8) return 'Your new password must be at least 8 characters.'
    if (!/[A-Z]/.test(password)) return 'Your new password must include at least one uppercase letter.'
    if (!/[a-z]/.test(password)) return 'Your new password must include at least one lowercase letter.'
    if (!/\d/.test(password)) return 'Your new password must include at least one number.'
    if (password !== confirmation) return 'The passwords do not match.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validationError = validatePassword()
    if (validationError) {
      setError(validationError)
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message || 'Unable to update your password. Please request a new reset link.')
      setBusy(false)
      return
    }

    // Anyone else signed in to this account (e.g. whoever made the reset
    // necessary) is signed out; this device stays signed in.
    const { error: othersError } = await signOutOtherDevices()
    if (othersError) console.warn('Could not sign out other devices after the password reset:', othersError)

    setSuccess(othersError
      ? 'Your password has been updated. You can now log in with your new password.'
      : 'Your password has been updated, and you have been signed out on your other devices.')
    setPassword('')
    setConfirmation('')
    setBusy(false)
  }

  if (checkingLink) {
    return (
      <section className="mx-auto max-w-sm px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">Account recovery</p>
        <p className="mt-3 text-sm text-muted">Checking your reset link…</p>
      </section>
    )
  }

  if (!recoveryReady) {
    return (
      <section className="mx-auto max-w-sm px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-widest text-marigold-deep">Reset link unavailable</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-ink">This link cannot be used</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{error || 'The reset link is invalid or has expired.'}</p>
        <Link to="/forgot-password" className="mt-6 inline-block rounded-full bg-seal px-5 py-3 font-mono text-xs font-semibold text-surface hover:bg-seal-deep">
          Request a new link
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-sm px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">Account recovery</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">Set a new password</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Use at least 8 characters, including uppercase, lowercase, and a number.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          visible={showPassword}
          onToggle={() => setShowPassword((current) => !current)}
          autoComplete="new-password"
        />
        <PasswordInput
          label="Confirm new password"
          value={confirmation}
          onChange={setConfirmation}
          visible={showConfirmation}
          onToggle={() => setShowConfirmation((current) => !current)}
          autoComplete="new-password"
        />

        {error && <p className="text-sm text-marigold-deep">{error}</p>}
        {success && <p className="rounded-xl border border-seal/30 bg-seal/10 px-3 py-3 text-sm text-seal">{success}</p>}

        <button
          type="submit"
          disabled={busy || Boolean(success)}
          className="w-full rounded-full bg-seal py-3 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50"
        >
          {busy ? 'Updating password…' : 'Update password'}
        </button>
      </form>

      {success ? (
        <button onClick={() => navigate('/auth', { replace: true })} className="mt-6 font-mono text-xs text-muted hover:text-seal">
          Continue to log in →
        </button>
      ) : (
        <Link to="/auth" className="mt-6 inline-block font-mono text-xs text-muted hover:text-seal">
          ← Back to log in
        </Link>
      )}
    </section>
  )
}
