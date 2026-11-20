import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useSession } from '../lib/useProfile.js'
import { signOutOtherDevices, signOutThisDevice } from '../lib/signOut.js'
import { clearMainDevice, currentDeviceId, makeThisMainDevice, needsRecentSignIn, useDeviceStatus } from '../lib/deviceStatus.js'

const PROVIDER_LABELS = { email: 'Email and password', google: 'Google' }

// How this account signs in, e.g. "Google" or "Email and password, Google".
function describeSignInMethods(user) {
  const providers = user?.app_metadata?.providers || [user?.app_metadata?.provider].filter(Boolean)
  return providers.map((provider) => PROVIDER_LABELS[provider] || provider).join(', ') || 'Unknown'
}

const CARD_CLASS = 'rounded-[24px] border border-hairline bg-white p-5 sm:p-7'
const SECONDARY_BUTTON_CLASS = 'rounded-full border border-hairline px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-seal hover:text-seal disabled:opacity-50'

function formatLastActive(value) {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// "Sign-in & security": reachable by buyers and sellers from the account menu.
// (It is its own route because /account sends sellers to their storefront.)
export default function AccountSecurity() {
  const { session, loading } = useSession()
  const navigate = useNavigate()
  // idle -> confirming -> working -> done | failed
  const [othersState, setOthersState] = useState('idle')
  const [signingOut, setSigningOut] = useState(false)
  // Main device (migration 0042): this device's standing, and the device list.
  const device = useDeviceStatus()
  const [devices, setDevices] = useState([])
  const [mainState, setMainState] = useState({ busy: false, message: '', isError: false })
  const thisDeviceId = currentDeviceId()

  useEffect(() => {
    if (!loading && !session) navigate('/auth', { state: { redirectTo: '/account/security' } })
  }, [loading, session, navigate])

  async function handleSignOutOthers() {
    setOthersState('working')
    const { error } = await signOutOtherDevices()
    if (error) console.error('Sign out of other devices failed:', error)
    setOthersState(error ? 'failed' : 'done')
  }

  // The user's devices, most recently used first. Refreshed when this
  // device's standing changes.
  useEffect(() => {
    if (!session?.user?.id || !device.available) return
    let current = true
    supabase
      .from('user_devices')
      .select('device_id, label, is_main, last_active_at')
      .order('last_active_at', { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (!current) return
        if (error) console.warn('Could not load your devices:', error)
        setDevices(data || [])
      })
    return () => { current = false }
  }, [session?.user?.id, device.available, device.isMain, device.hasMain])

  async function handleMakeMain() {
    setMainState({ busy: true, message: '', isError: false })
    const { error } = await makeThisMainDevice()
    if (!error) {
      setMainState({ busy: false, message: 'This is now your main device.', isError: false })
      return
    }
    setMainState({
      busy: false,
      isError: true,
      message: needsRecentSignIn(error)
        ? 'For your safety, this only works within 10 minutes of signing in on this device. Log out, log in again, then make it your main device.'
        : "That didn't work. Check your connection and try again.",
    })
  }

  async function handleClearMain() {
    setMainState({ busy: true, message: '', isError: false })
    const { error } = await clearMainDevice()
    setMainState(error
      ? { busy: false, message: "That didn't work. Check your connection and try again.", isError: true }
      : { busy: false, message: 'You no longer have a main device. Every device signs out after 15 minutes unused.', isError: false })
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
          {device.checked && (
            <p className="mt-2 text-sm text-ink">
              <span className="font-semibold">{device.isMain ? 'Main device' : 'Other device'}</span>
              <span className="text-muted">{device.isMain ? ': signs out after 3 hours unused.' : ': signs out after 15 minutes unused.'}</span>
            </p>
          )}
          <p className="mt-2 text-sm text-muted">Log out here only. You stay signed in on your other devices.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {device.checked && !device.isMain && (
              <button type="button" onClick={handleMakeMain} disabled={mainState.busy} className={SECONDARY_BUTTON_CLASS}>
                {mainState.busy ? 'Saving…' : 'Make this my main device'}
              </button>
            )}
            {device.checked && device.isMain && (
              <button type="button" onClick={handleClearMain} disabled={mainState.busy} className={SECONDARY_BUTTON_CLASS}>
                {mainState.busy ? 'Saving…' : 'Stop using as main device'}
              </button>
            )}
            <button type="button" onClick={handleSignOutHere} disabled={signingOut} className={SECONDARY_BUTTON_CLASS}>
              {signingOut ? 'Logging out…' : 'Log out of this device'}
            </button>
          </div>
          {mainState.message && (
            <p role={mainState.isError ? 'alert' : 'status'} className={`mt-3 text-sm ${mainState.isError ? 'text-marigold-deep' : 'text-seal'}`}>
              {mainState.message}
            </p>
          )}
        </section>

        {devices.length > 0 && (
          <section className={CARD_CLASS}>
            <h2 className="font-display text-lg font-bold text-ink">Your devices</h2>
            <p className="mt-2 text-sm text-muted">
              Your main device signs out after 3 hours unused; every other device after 15 minutes.
            </p>
            <ul className="mt-4 divide-y divide-hairline">
              {devices.map((item) => (
                <li key={item.device_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {item.label || 'Unknown device'}
                      {item.device_id === thisDeviceId && <span className="ml-2 font-normal text-muted">(this device)</span>}
                    </p>
                    <p className="text-xs text-muted">Last used {formatLastActive(item.last_active_at)}</p>
                  </div>
                  {item.is_main && (
                    <span className="rounded-full bg-seal/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-seal">Main device</span>
                  )}
                </li>
              ))}
            </ul>
            {device.hasMain && !device.isMain && (
              <button type="button" onClick={handleClearMain} disabled={mainState.busy} className={`mt-3 ${SECONDARY_BUTTON_CLASS}`}>
                Remove main device
              </button>
            )}
          </section>
        )}

        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-bold text-ink">Other devices</h2>
          <p className="mt-2 text-sm text-muted">
            Lost a phone or used a shared computer? Sign out everywhere else and stay signed in here.
            Other devices are signed out within 15 minutes.
          </p>

          {othersState === 'done' && (
            <p role="status" className="mt-4 text-sm text-seal">Done. Your other devices will be signed out within 15 minutes.</p>
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
