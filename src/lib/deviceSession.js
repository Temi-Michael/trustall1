// Main device and sign-out after inactivity (migration 0042). Pure helpers and
// small storage wrappers, so the timing rules can be tested without a browser.

const MINUTE_MS = 60 * 1000

// How long a device may sit unused before it's signed out.
export const MAIN_DEVICE_IDLE_MS = 3 * 60 * MINUTE_MS
export const OTHER_DEVICE_IDLE_MS = 15 * MINUTE_MS
// The admin dashboard always uses the shorter limit, even on the main device.
export const ADMIN_IDLE_MS = 15 * MINUTE_MS
// The "You'll be signed out" warning appears this long before sign-out.
export const IDLE_WARNING_MS = MINUTE_MS
// How often the app reports activity to the server while it's being used.
export const ACTIVITY_REPORT_INTERVAL_MS = 2 * MINUTE_MS

const DEVICE_ID_KEY = 'trustall.device-id'
const LAST_ACTIVITY_KEY = 'trustall.last-activity'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The idle limit for this device and page. */
export function idleLimitMs({ isMain = false, isAdminRoute = false } = {}) {
  if (isAdminRoute) return ADMIN_IDLE_MS
  return isMain ? MAIN_DEVICE_IDLE_MS : OTHER_DEVICE_IDLE_MS
}

/**
 * Where the countdown stands: 'active', 'warning' (within IDLE_WARNING_MS of
 * the limit) or 'expired', plus the milliseconds left before sign-out.
 * A missing last-activity time counts as active now.
 */
export function idleState(lastActivityAt, limitMs, now = Date.now()) {
  const last = Number.isFinite(lastActivityAt) ? lastActivityAt : now
  const remainingMs = Math.max(0, last + limitMs - now)
  if (remainingMs === 0) return { status: 'expired', remainingMs }
  if (remainingMs <= IDLE_WARNING_MS) return { status: 'warning', remainingMs }
  return { status: 'active', remainingMs }
}

/** A short, human label for the device list, e.g. "Chrome on Android". */
export function describeDevice(userAgent = '') {
  const ua = String(userAgent)
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : 'Browser'
  const system = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
          : /Linux/.test(ua) ? 'Linux'
            : 'unknown system'
  return `${browser} on ${system}`
}

// localStorage can be missing or throw (private mode, blocked site data);
// these rules must keep working, just without memory across reloads.
function readStorage(storage, key) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, value)
  } catch {
    // Nothing to do: the value only helps across reloads and tabs.
  }
}

/** This browser's device ID, created once and kept in storage. */
export function getDeviceId(storage, createId = () => globalThis.crypto.randomUUID()) {
  const existing = readStorage(storage, DEVICE_ID_KEY)
  if (existing && UUID_PATTERN.test(existing)) return existing
  const id = createId()
  writeStorage(storage, DEVICE_ID_KEY, id)
  return id
}

/** Last use of the app in any tab of this browser (ms), or null. */
export function readLastActivity(storage) {
  const value = Number(readStorage(storage, LAST_ACTIVITY_KEY))
  return Number.isFinite(value) && value > 0 ? value : null
}

export function writeLastActivity(storage, at) {
  writeStorage(storage, LAST_ACTIVITY_KEY, at === null ? null : String(at))
}

// ---------------------------------------------------------------------------
// Pausing the countdown (e.g. while the Paystack payment window is open: the
// app can't see taps inside it, and nobody should be signed out mid-payment).
// ---------------------------------------------------------------------------
const holds = new Set()

/** Pause (on = true) or resume the countdown for one reason. */
export function holdInactivity(reason, on) {
  if (on) holds.add(reason)
  else holds.delete(reason)
}

export function isInactivityHeld() {
  return holds.size > 0
}

/**
 * When this login started (ms), from the "amr" claim in the access token.
 * Renewed tokens keep the original sign-in time. Null if it can't be read.
 * Used so a last-activity time left over from an earlier login on this
 * browser never signs out a fresh one.
 */
export function sessionSignedInAt(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1]
    if (!payload) return null
    const json = JSON.parse(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const times = (Array.isArray(json.amr) ? json.amr : [])
      .map((entry) => Number(entry?.timestamp))
      .filter((value) => Number.isFinite(value) && value > 0)
    return times.length ? Math.max(...times) * 1000 : null
  } catch {
    return null
  }
}
