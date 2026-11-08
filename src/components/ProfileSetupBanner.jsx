import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useRole } from '../lib/RoleContext.jsx'

// Dismissing hides the banner for this browser tab only; it returns in a new
// tab or visit until setup is done.
const DISMISS_STORAGE_KEY = 'trustall.setup-reminder-dismissed'

// The setup flow itself, and pages with their own layout.
const HIDDEN_ON_PATHS = ['/auth', '/account/verification', '/admin']

function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissed() {
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE_KEY, '1')
  } catch {
    // Storage unavailable: the banner simply stays dismissed until reload.
  }
}

/**
 * Reminds a signed-in user who left "Complete your registration" unfinished
 * (setup_completed_at is null, migration 0038; in practice a new Google
 * account). It never blocks anything; paying is what requires a finished
 * profile, and the checkout says so itself.
 */
export function ProfileSetupBanner() {
  const { session, profile } = useRole()
  const { pathname } = useLocation()
  const [dismissed, setDismissed] = useState(readDismissed)

  // Without migration 0038 the column is absent, so nobody sees the banner.
  const needsSetup = Boolean(session && profile && 'setup_completed_at' in profile && profile.setup_completed_at === null)
  const hiddenHere = HIDDEN_ON_PATHS.some((path) => pathname.startsWith(path))
  if (!needsSetup || dismissed || hiddenHere) return null

  function dismiss() {
    saveDismissed()
    setDismissed(true)
  }

  return (
    <div role="status" className="border-b border-marigold/30 bg-marigold/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
        <p className="text-sm text-ink">
          <span className="font-semibold">Finish setting up your profile.</span>{' '}
          <span className="text-muted">You'll need it before you can pay for anything.</span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            to="/account/verification"
            className="rounded-full bg-seal px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-seal-deep"
          >
            Finish now
          </Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss reminder"
            className="rounded-full px-3 py-1.5 text-xs text-muted transition hover:bg-white hover:text-ink"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
