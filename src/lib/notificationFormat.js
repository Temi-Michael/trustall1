import { getChatGroupId } from '../../supabase/functions/_shared/notificationRoutes.js'

// Pure notification helpers, kept free of the Supabase client so they can be
// unit-tested in Node (the client needs Vite's import.meta.env).

export function getNotificationDisplayTitle(notification, senderName) {
  if (!notification) return 'Notification';

  if (notification.type === 'new_message') {
    const resolvedSenderName = String(senderName || notification.sender_name || 'someone').trim();
    return resolvedSenderName ? `New message from ${resolvedSenderName}` : 'New message';
  }

  return notification.title || 'New update';
}

export function getNotificationBadgeSummary(notifications = []) {
  return (notifications || []).reduce((summary, notification) => {
    if (!notification) return summary;

    if (notification.type === 'new_message') {
      summary.message += 1;
    } else if (
      ['payment_pending', 'payment_confirmed', 'payment_released', 'delivered', 'order_confirmed', 'delivery_confirmed', 'order_status_updated', 'payout_initiated', 'payout_completed'].includes(notification.type)
      || String(notification.type || '').startsWith('order')
    ) {
      summary.order += 1;
    } else {
      summary.other += 1;
    }

    return summary;
  }, { message: 0, order: 0, other: 0 });
}

// The bell's rows: chat messages from one conversation become one row (the
// newest message, with how many there are); everything else is a row each.
// Keeps the order of the list it's given (newest first) by each row's newest.
export function groupNotifications(notifications = []) {
  const groups = []
  const byKey = new Map()
  for (const notification of notifications || []) {
    if (!notification) continue
    const chatId = getChatGroupId(notification)
    const key = chatId ? `chat:${chatId}` : `one:${notification.id}`
    let group = byKey.get(key)
    if (!group) {
      group = { key, conversationId: chatId, latest: notification, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(notification)
    if (new Date(notification.created_at) > new Date(group.latest.created_at)) group.latest = notification
  }
  return groups
}

// The next state of a chat's phone tile, from the one on screen (its data).
// Same rule as nextChatGroup in public/sw.js; keep the two in step. The same
// notification can arrive twice (push and open app), so it counts once.
const GROUP_MEMORY = 50
export function nextChatGroup(previous, notificationId) {
  const ids = Array.isArray(previous?.ids) ? previous.ids.filter((id) => typeof id === 'string') : []
  const before = Number.isInteger(previous?.count) && previous.count > 0 ? previous.count : (previous ? 1 : 0)
  if (notificationId && ids.includes(notificationId)) return { count: Math.max(before, 1), ids, repeat: true }
  return { count: before + 1, ids: notificationId ? [...ids, notificationId].slice(-GROUP_MEMORY) : ids, repeat: false }
}
