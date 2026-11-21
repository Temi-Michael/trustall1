import { supabase } from './supabaseClient.js'
import { CHAT_TAG_PREFIX, isUuid } from '../../supabase/functions/_shared/notificationRoutes.js'
import { nextChatGroup } from './notificationFormat.js'

const CHAT_TAG_PATTERN = new RegExp(`^${CHAT_TAG_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'i')

// Asks the bell to show one notification's full message. public/sw.js posts
// it after a tap on a marketing push; a pop-up shown by the app dispatches it.
export const SHOW_NOTIFICATION_EVENT = 'trustall:show-notification'

export function supportsNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window
}

// Call it straight from a tap or click: iPhones and Safari ignore a request
// that isn't, and Chrome hides it behind a quiet icon.
export async function ensureNotificationPermission() {
  if (!supportsNotifications()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result || Notification.permission
  } catch (error) {
    return 'unsupported'
  }
}

function navigateWithinApp(path) {
  if (typeof window === 'undefined') return

  const nextUrl = path.startsWith('/') ? path : `/${path}`
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

  if (currentUrl === nextUrl) {
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }

  window.history.pushState({}, '', nextUrl)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Whether the person is looking at the app. The bell and the page then update
// in place, and a pop-up on top would only repeat them.
function appIsInView() {
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * A browser pop-up from the open app, only while it is out of view and only
 * if permission was already given (this never asks).
 * notificationId: the notifications row, when there is one. Its tag is the one
 *   public/sw.js gives the push for the same row, so the push and this pop-up
 *   replace each other instead of showing twice.
 * path: the page a tap opens; with a notificationId and no path, a tap shows
 *   the full message in the bell (marketing).
 * tag: a chat's tag (getNotificationTag) joins that chat's one tile, as
 *   public/sw.js does for pushes. Without a notification, any name.
 */
export async function showAppNotification({ title, body, notificationId = null, path = null, tag = 'trustall' } = {}) {
  if (!supportsNotifications() || Notification.permission !== 'granted' || appIsInView()) return

  const id = isUuid(notificationId) ? notificationId.toLowerCase() : null
  const chatTag = typeof tag === 'string' && CHAT_TAG_PATTERN.test(tag) ? tag.toLowerCase() : null
  const inAppOnly = Boolean(id) && !path
  const options = {
    body: body || 'You have a new notification',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: chatTag || (id ? `trustall-${id}` : tag),
    data: { url: path, notificationId: id, inAppOnly },
  }

  // Through the service worker where possible: Android refuses new
  // Notification(), and the worker sends the tap to the right page.
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/')
    if (registration?.active) {
      if (chatTag && typeof registration.getNotifications === 'function') {
        const [current] = await registration.getNotifications({ tag: chatTag })
        const group = nextChatGroup(current?.data, id)
        // Already on screen (the push got there first).
        if (group.repeat) return
        if (group.count > 1) {
          options.body = `${group.count} new messages\n${options.body}`
          options.renotify = true
        }
        options.data = { ...options.data, count: group.count, ids: group.ids }
      }
      await registration.showNotification(title || 'Trustall', options)
      return
    }
  } catch (error) {
    console.warn('Service worker notification failed', error)
  }

  try {
    const notification = new Notification(title || 'Trustall', options)
    notification.onclick = () => {
      window.focus()
      notification.close()
      if (inAppOnly) window.dispatchEvent(new CustomEvent(SHOW_NOTIFICATION_EVENT, { detail: { notificationId: id } }))
      else if (path) navigateWithinApp(path)
    }
  } catch (error) {
    console.warn('Browser notification failed', error)
  }
}

// Clears a chat's tile from the phone or computer once the chat is open, so
// it doesn't linger with messages already read (and its count starts again).
export async function closeChatNotifications(conversationId) {
  if (!isUuid(conversationId)) return
  try {
    const registration = await navigator.serviceWorker?.getRegistration('/')
    if (typeof registration?.getNotifications !== 'function') return
    const tiles = await registration.getNotifications({ tag: `${CHAT_TAG_PREFIX}${conversationId.toLowerCase()}` })
    tiles.forEach((tile) => tile.close())
  } catch {
    // No service worker or no permission: nothing on screen to clear.
  }
}

// Emails the signed-in user only. The function looks up their address and
// builds the HTML itself from this plain text.
export async function sendNotificationEmail({ subject, body }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification-email`
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ subject, body }),
    })
  } catch (error) {
    console.warn('Notification email could not be sent:', error)
  }
}

export async function notifyConversationEvent({ emailSelf = false, title, body, preview, path = null }) {
  showAppNotification({ title, body: preview || body, path, tag: 'conversation' })
  if (emailSelf) {
    await sendNotificationEmail({ subject: title, body })
  }
}
