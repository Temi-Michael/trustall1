import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useRole } from '../lib/RoleContext.jsx'
import { enablePushNotifications, pushIsSupported } from '../lib/useRegisterPush.js'

// "Not now" hides the prompt in this browser for two weeks.
const DISMISS_STORAGE_KEY = 'trustall.push-prompt-dismissed-at'
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000

// Sign-in and password pages, and the chat, whose layout fills the screen.
const HIDDEN_ON_PATHS = ['/auth', '/forgot-password', '/reset-password', '/admin', '/messages']

function dismissedRecently() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY))
    return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_FOR_MS
  } catch {
    return false
  }
}

function saveDismissed() {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()))
  } catch {
    // Storage unavailable: the prompt stays hidden until the page reloads.
  }
}

function currentPermission() {
  return pushIsSupported() ? Notification.permission : 'unsupported'
}

/**
 * Offers to turn on notifications to a signed-in user who hasn't decided yet
 * (permission "default"). Browsers only show their permission question after
 * a tap, so the question is asked from the "Turn on" button, never on load.
 * Permission belongs to the site address, so after a move to a new address
 * (www.trustall.online) everyone is asked again; this is how.
 */
export function NotificationPrompt() {
  const { session } = useRole()
  const { pathname } = useLocation()
  const [permission, setPermission] = useState(currentPermission)
  const [dismissed, setDismissed] = useState(dismissedRecently)
  const [busy, setBusy] = useState(false)

  const userId = session?.user?.id
  const hiddenHere = HIDDEN_ON_PATHS.some((path) => pathname.startsWith(path))
  if (!userId || permission !== 'default' || dismissed || hiddenHere) return null

  function turnOn() {
    setBusy(true)
    // Called straight from the tap, before anything is awaited.
    enablePushNotifications(userId)
      .then((result) => {
        setPermission(result)
        // Closed the browser's question without answering: don't ask again soon.
        if (result === 'default') {
          saveDismissed()
          setDismissed(true)
        }
      })
      .catch(() => setPermission(currentPermission()))
      .finally(() => setBusy(false))
  }

  function notNow() {
    saveDismissed()
    setDismissed(true)
  }

  return (
    <div role="region" aria-label="Notifications" className="border-b border-seal/20 bg-seal/5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6">
        <p className="text-sm text-ink">
          <span className="font-semibold">Turn on notifications?</span>{' '}
          <span className="text-muted">Hear about new messages, offers and order updates, even when Trustall is closed.</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="rounded-full bg-seal px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-seal-deep disabled:opacity-60"
          >
            {busy ? 'Turning on…' : 'Turn on'}
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
