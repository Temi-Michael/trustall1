import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useProfile } from '../lib/useProfile.js'
import { buildAuthCallbackUrl, clearAuthIntent, getAuthIntent, getEmailSignupOutcome, saveAuthIntent, shouldCompleteGoogleSignup } from '../lib/authFlow.js'
import { safeFileName } from '../lib/inputSafety.js'

async function uploadAvatar(file, userId) {
  if (!file || !userId) return null
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

export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { session, profile, loading } = useProfile()
  const intent = getAuthIntent(searchParams, typeof window !== 'undefined' ? window.sessionStorage : null)
  const redirectTo = location.state?.redirectTo || intent.redirectTo
  const refCode = searchParams.get('ref')
  const isGoogleSignupCompletion = shouldCompleteGoogleSignup(intent.flow, session)

  useEffect(() => {
    if (!loading && session?.user?.id && !isGoogleSignupCompletion) {
      clearAuthIntent(window.sessionStorage)
      navigate(redirectTo, { replace: true })
    }
  }, [loading, session?.user?.id, isGoogleSignupCompletion, redirectTo, navigate])

  useEffect(() => {
    if (!isGoogleSignupCompletion || loading) return
    const providerName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || ''
    setFullName((current) => current || profile?.full_name || providerName)
  }, [isGoogleSignupCompletion, loading, profile?.full_name, session?.user?.id])

  useEffect(() => {
    if (!loading && !session?.user?.id) {
      clearAuthIntent(window.sessionStorage)
    }
  }, [loading, session?.user?.id])

  async function handleSignIn(e) {
    e.preventDefault()
    clearAuthIntent(window.sessionStorage)
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) { setError(error.message); return }
    navigate(redirectTo)
  }

  async function handleGoogleSignIn() {
    setError('')
    setBusy(true)
    saveAuthIntent(window.sessionStorage, mode, redirectTo)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: buildAuthCallbackUrl(window.location.origin, redirectTo, mode),
      },
    })
    if (error) {
      clearAuthIntent(window.sessionStorage)
      setBusy(false)
      setError(error.message)
    }
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    clearAuthIntent(window.sessionStorage)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, ref_code: refCode || null },
          emailRedirectTo: buildAuthCallbackUrl(window.location.origin, redirectTo),
        },
      })

      const outcome = getEmailSignupOutcome(data, error)
      if (outcome === 'error') {
        setError(error.message)
        setBusy(false)
        return
      }

      if (outcome === 'unexpected') {
        setError('Supabase did not return account details. Please try again.')
        setBusy(false)
        return
      }

      if (outcome === 'existing-account') {
        setInfo('If this address can be registered, check your email for a confirmation link. If it already has an account, log in or reset your password.')
        setMode('signin')
        setBusy(false)
        return
      }

      if (data.user?.id && avatarFile) {
        try {
          const avatarUrl = await uploadAvatar(avatarFile, data.user.id)
          if (avatarUrl) {
            await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', data.user.id)
          }
        } catch (uploadErr) {
          console.error('Failed to upload account avatar:', uploadErr)
        }
      }

      setBusy(false)
      if (outcome === 'authenticated') {
        navigate(redirectTo)
      } else {
        setInfo('Account created — check your email to confirm, then sign in.')
        setMode('signin')
      }
    } catch (err) {
      setBusy(false)
      setError(err.message || 'Something went wrong while creating your account.')
    }
  }

  async function handleGoogleSignupCompletion(event) {
    event.preventDefault()
    const name = fullName.trim()
    if (!name) {
      setError('Enter your full name to complete registration.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const updates = { full_name: name }
      if (avatarFile) {
        updates.avatar_url = await uploadAvatar(avatarFile, session.user.id)
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', session.user.id)
        .select('id')
        .single()

      if (profileError) throw profileError
      clearAuthIntent(window.sessionStorage)
      navigate(redirectTo, { replace: true })
    } catch (completionError) {
      console.error('Failed to complete Google signup:', completionError)
      setError(completionError.message || 'Unable to complete registration. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || (session?.user?.id && !isGoogleSignupCompletion)) {
    return (
      <section className="mx-auto max-w-sm px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">Trustall</p>
        <p className="mt-3 text-sm text-muted">Finishing sign-in…</p>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-sm px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">
        {redirectTo !== '/' ? 'One step first' : 'Welcome'}
      </p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">
        {isGoogleSignupCompletion ? 'Complete your registration' : mode === 'signin' ? 'Log in to Trustall' : 'Create your account'}
      </h1>
      {isGoogleSignupCompletion && (
        <>
          <p className="mt-3 text-sm leading-6 text-muted">
            Your Google account{session.user.email ? ` (${session.user.email})` : ''} will be used to set up your Trustall profile. Confirm your full name to continue; a profile photo is optional.
          </p>
          <form onSubmit={handleGoogleSignupCompletion} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-muted">Full name</span>
              <input
                required
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink placeholder:text-muted focus:border-seal outline-none"
              />
            </label>
            <div className="rounded-xl border border-hairline bg-white p-3">
              <label className="block text-xs uppercase tracking-[0.2em] text-muted">Profile photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setAvatarFile(event.target.files?.[0] || null)}
                className="mt-2 w-full text-sm text-muted"
              />
            </div>
            {error && <p role="alert" className="text-sm text-marigold-deep">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-seal py-3 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50"
            >
              {busy ? 'Saving your profile…' : 'Complete registration'}
            </button>
          </form>
        </>
      )}
      {mode === 'signup' && refCode && (
        <p className="mt-2 rounded-lg bg-marigold/10 px-3 py-2 font-mono text-xs text-marigold-deep">
          You were invited by a Trustall member 🎉
        </p>
      )}

      {!isGoogleSignupCompletion && <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="mt-8 space-y-4">
        {mode === 'signup' && (
          <>
            <input
              required placeholder="Full name" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink placeholder:text-muted focus:border-seal outline-none"
            />
            <div className="rounded-xl border border-hairline bg-white p-3">
              <label className="block text-xs uppercase tracking-[0.2em] text-muted">Profile photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                className="mt-2 w-full text-sm text-muted"
              />
            </div>
          </>
        )}
        <input
          required type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink placeholder:text-muted focus:border-seal outline-none"
        />
        <div className="relative">
          <input
            required type={showPassword ? 'text' : 'password'} minLength={6} placeholder="Password" value={password}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-hairline bg-white px-4 py-3 pr-12 text-ink placeholder:text-muted focus:border-seal outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surfacealt hover:text-ink"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {error && <p className="text-sm text-marigold-deep">{error}</p>}
        {info && <p className="text-sm text-ink">{info}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full rounded-full bg-seal py-3 font-body text-sm font-semibold text-surface hover:bg-seal-deep disabled:opacity-50"
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Log in' : 'Create account'}
        </button>
      </form>}

      {!isGoogleSignupCompletion && mode === 'signin' && (
        <div className="mt-4 text-right">
            <Link to="/forgot-password" className="font-mono text-xs text-muted hover:text-seal">
              Forgot password?
            </Link>
        </div>
      )}

      {!isGoogleSignupCompletion && <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-hairline" />
        <span>{mode === 'signin' ? 'or log in with' : 'or sign up with'}</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>}
      {!isGoogleSignupCompletion && <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-hairline bg-white py-3 font-body text-sm font-semibold text-ink transition hover:border-seal hover:text-seal disabled:opacity-50"
      >
        <span className="font-display text-base font-bold">G</span>
        {mode === 'signin' ? 'Continue with Google' : 'Sign up with Google'}
      </button>}

      {!isGoogleSignupCompletion && <button
        onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo('') }}
        className="mt-6 font-mono text-xs text-muted hover:text-seal"
      >
        {mode === 'signin' ? "New to Trustall? Create an account →" : '← Already have an account? Log in'}
      </button>}
    </section>
  )
}
