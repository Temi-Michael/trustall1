import { supabase } from './supabaseClient.js'

export function supportsNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function ensureNotificationPermission() {
  if (!supportsNotifications()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
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

export async function sendBrowserNotification(title, body, tag = 'trustall') {
  if (!supportsNotifications()) return

  if (Notification.permission === 'default') {
    const permission = await ensureNotificationPermission()
    if (permission !== 'granted') return
  }

  if (Notification.permission !== 'granted') return

  try {
    const notification = new Notification(title, {
      body,
      icon: '/icon.svg',
      tag,
    })
    notification.onclick = () => {
      window.focus()
      navigateWithinApp('/messages')
    }
  } catch (error) {
    console.warn('Browser notification failed', error)
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

export async function notifyConversationEvent({ emailSelf = false, title, body, preview }) {
  sendBrowserNotification(title, preview || body, 'conversation')
  if (emailSelf) {
    await sendNotificationEmail({ subject: title, body })
  }
}
