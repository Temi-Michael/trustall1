import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSession } from '../lib/useProfile.js'
import { makeThisMainDevice, useDeviceStatus } from '../lib/deviceStatus.js'

// "Not now" is remembered in this browser, so the question isn't asked again.
const DISMISS_STORAGE_KEY = 'trustall.main-device-prompt-dismissed'
const HIDDEN_ON_PATHS = ['/auth', '/forgot-password', '/reset-password', '/admin', '/messages']

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissed() {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, '1')
  } catch {
    // Storage unavailable: the prompt stays hidden until the page reloads.
  }
}

/**
 * Asks once, just after signing in, whether this is the user's main device
 * (3 hours before an unused device is signed out, instead of 15 minutes).
 * Only shown while the server would allow it: the user has no main device
 * yet and signed in here within the last 10 minutes (migration 0042).
 */
export function MainDevicePrompt() {
  const { session } = useSession()
  const { pathname } = useLocation()
  const device = useDeviceStatus()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const hiddenHere = HIDDEN_ON_PATHS.some((path) => pathname.startsWith(path))
  const shouldAsk = session && device.checked && !device.hasMain && device.canSetMain
  if (!shouldAsk || dismissed || hiddenHere) return null

  async function makeMain() {
    setBusy(true)
    setError('')
    const { error: saveError } = await makeThisMainDevice()
    setBusy(false)
    if (saveError) setError('That didn\'t work. You can do it later from Sign-in & security.')
  }

  function notNow() {
    saveDismissed()
    setDismissed(true)
  }

  return (
    <div role="region" aria-label="Main device" className="border-b border-seal/20 bg-seal/5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
        <p className="text-sm text-ink">
          <span className="font-semibold">Is this your main device?</span>{' '}
          <span className="text-muted">Your main device stays signed in for 3 hours unused; others sign out after 15 minutes.</span>
          {error && <span role="alert" className="ml-1 text-marigold-deep">{error}</span>}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={makeMain}
            disabled={busy}
            className="rounded-full bg-seal px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-seal-deep disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Yes, it is'}
          </button>
          <button
            type="button"
            onClick={notNow}
            className="rounded-full px-3 py-1.5 text-xs text-muted transition hover:bg-white hover:text-ink"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
