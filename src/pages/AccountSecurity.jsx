import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../lib/useProfile.js'
import { signOutOtherDevices, signOutThisDevice } from '../lib/signOut.js'

const PROVIDER_LABELS = { email: 'Email and password', google: 'Google' }

// How this account signs in, e.g. "Google" or "Email and password, Google".
function describeSignInMethods(user) {
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean)
  return providers.map((provider) => PROVIDER_LABELS[provider] || provider).join(', ') || 'Unknown'
}

const CARD_CLASS = 'rounded-[24px] border border-hairline bg-white p-5 sm:p-7'

// "Sign-in & security": reachable by buyers and sellers from the account menu.
// (It is its own route because /account sends sellers to their storefront.)
export default function AccountSecurity() {
  const { session, loading } = useSession()
  const navigate = useNavigate()
  // idle -> confirming -> working -> done | failed
  const [othersState, setOthersState] = useState('idle')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/account/security' } })
  }, [loading, session, navigate])

  async function handleSignOutOthers() {
    setOthersState('working')
    const { error } = await signOutOtherDevices()
    if (error) console.error('Sign out of other devices failed:', error)
    setOthersState(error ? 'failed' : 'done')
  }

  function handleSignOutHere() {
    setSigningOut(true)
    signOutThisDevice({ navigate })
  }

  if (loading || !session) return <div className="px-6 py-24 text-center text-muted">Loading…</div>

  return (
    <section className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-14">
      <div className="border-b border-hairline pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-seal">Account</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Sign-in & security</h1>
        <p className="mt-2 text-sm text-muted">How you sign in, and where your account is signed in.</p>
      </div>

      <div className="mt-7 space-y-5">
        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-bold text-ink">Signed in as</h2>
          <p className="mt-2 break-all text-sm text-ink">{session.user.email}</p>
          <p className="mt-1 font-mono text-xs text-muted">Sign-in method: {describeSignInMethods(session.user)}</p>
        </section>

        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-bold text-ink">This device</h2>
          <p className="mt-2 text-sm text-muted">Log out here only. You stay signed in on your other devices.</p>
          <button
            type="button"
            onClick={handleSignOutHere}
            disabled={signingOut}
            className="mt-4 rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-seal hover:text-seal disabled:opacity-50"
          >
            {signingOut ? 'Logging out…' : 'Log out of this device'}
          </button>
        </section>

        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-bold text-ink">Other devices</h2>
          <p className="mt-2 text-sm text-muted">
            Lost a phone or used a shared computer? Sign out everywhere else and stay signed in here.
            Other devices are signed out within about an hour.
          </p>

          {othersState === 'done' && (
            <p role="status" className="mt-4 text-sm text-seal">Done. Your other devices will be signed out within about an hour.</p>
          )}
          {othersState === 'failed' && (
            <p role="alert" className="mt-4 text-sm text-marigold-deep">That didn't work. Check your connection and try again.</p>
          )}

          {othersState === 'confirming' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSignOutOthers}
                className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-seal-deep"
              >
                Yes, sign out other devices
              </button>
              <button
                type="button"
                onClick={() => setOthersState('idle')}
                className="rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-surfacealt"
              >
                Cancel
              </button>
            </div>
          ) : othersState !== 'done' && (
            <button
              type="button"
              onClick={() => setOthersState('confirming')}
              disabled={othersState === 'working'}
              className="mt-4 rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-seal hover:text-seal disabled:opacity-50"
            >
              {othersState === 'working' ? 'Signing out other devices…' : 'Sign out of other devices'}
            </button>
          )}
        </section>
      </div>
    </section>
  )
}
