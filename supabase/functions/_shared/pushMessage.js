// Builds what send-push-notification sends to Firebase, and reads Firebase's
// errors. Plain JavaScript so Node can test it and Deno can import it.
import { getInAppMessagePath, getNotificationPath, isUuid } from './notificationRoutes.js'

export const DEFAULT_SITE_ORIGIN = 'https://www.trustall.online'

// A push carries a preview; the full text is in the app. Firebase refuses a
// message over 4 KB, so long messages (marketing) are cut well short of that.
const TITLE_LIMIT = 100
const BODY_LIMIT = 240

// The site push taps open (PUBLIC_SITE_URL, e.g. a dev site for the dev
// project). Only an https address, or http on this computer, is accepted, and
// only its origin is kept; anything else falls back to the live site.
export function resolveSiteOrigin(value) {
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol === 'https:' || (local && url.protocol === 'http:')) return url.origin
  } catch {
    // Not set, or not an address.
  }
  return DEFAULT_SITE_ORIGIN
}

// Cuts by characters, not bytes, so an emoji is never split in half.
export function truncateText(value, limit) {
  const characters = Array.from(String(value ?? '').trim())
  if (characters.length <= limit) return characters.join('')
  return `${characters.slice(0, limit - 1).join('').trimEnd()}…`
}

// The Firebase (FCM v1) message for one device.
// Data-only on purpose: with a "notification" block, Firebase shows the
// notification itself AND runs public/sw.js, which showed a second one, and
// Firebase's own tap handling focuses the app without opening the page.
// public/sw.js now shows each push exactly once and handles the tap.
// Every data value must be a string.
export function buildPushMessage(notification, token, { siteOrigin = DEFAULT_SITE_ORIGIN, unreadCount } = {}) {
  const path = getNotificationPath(notification)
  const inAppOnly = path === null
  const data = {
    title: truncateText(notification.title, TITLE_LIMIT) || 'Trustall',
    body: truncateText(notification.message, BODY_LIMIT) || 'You have a new notification',
    // Full address: a tap can open the app from nothing, so the site must be in it.
    actionUrl: new URL(inAppOnly ? getInAppMessagePath(notification.id) : path, siteOrigin).href,
    notificationId: isUuid(notification.id) ? notification.id : '',
    inAppOnly: String(inAppOnly),
  }
  if (Number.isInteger(unreadCount) && unreadCount >= 0) data.unreadCount = String(unreadCount)

  return {
    token,
    data,
    // High urgency: phones deliver it now instead of batching it for later.
    webpush: { headers: { Urgency: 'high' } },
  }
}

// Whether Firebase said this device token is dead, so its device_tokens row
// can go. Only these answers mean that. Firebase also says INVALID_ARGUMENT
// for a bad message (too big, say); deleting on any INVALID_ARGUMENT removed
// devices that were fine. Other errors (wrong project or key) are not the
// device's fault either, so they never delete anything.
export function isDeadTokenResponse(bodyText) {
  let error
  try {
    error = JSON.parse(bodyText)?.error
  } catch {
    return false
  }
  if (!error || typeof error !== 'object') return false

  const codes = (Array.isArray(error.details) ? error.details : []).map((detail) => detail?.errorCode)
  if (codes.includes('UNREGISTERED')) return true
  const invalidArgument = codes.includes('INVALID_ARGUMENT') || error.status === 'INVALID_ARGUMENT'
  return invalidArgument && /registration token/i.test(String(error.message || ''))
}
