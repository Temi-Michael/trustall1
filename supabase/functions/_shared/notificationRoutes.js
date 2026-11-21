// Where a notification takes the user. The in-app bell (src/lib/notificationUtils.js)
// and the push function (send-push-notification) both read this table, so a tap
// lands on the same page whichever way the notification arrived.
// Plain JavaScript with no imports: Node tests it, Vite bundles it, Deno imports it.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CONVERSATION = Object.freeze({ base: '/messages', idField: 'related_conversation_id' })
const ORDER = Object.freeze({ base: '/orders', idField: 'related_order_id' })
const DISPUTE = Object.freeze({ base: '/disputes', idField: 'related_dispute_id' })
const ORDERS_LIST = Object.freeze({ base: '/orders' })
const SELL = Object.freeze({ base: '/sell' })

// A Map, not a plain object, so a type such as "__proto__" or "constructor"
// can never match something inherited.
// A type missing here (marketing, or one added later without a page) has no
// page of its own: the app shows its full message instead.
const DESTINATIONS = new Map([
  // Chat: the conversation.
  ['new_message', CONVERSATION],
  ['offer_received', CONVERSATION],
  ['offer_accepted', CONVERSATION],
  ['delivery_address_shared', CONVERSATION],
  // Orders: the order. A review is about an order, so it opens that order.
  ['payment_pending', ORDER],
  ['payment_confirmed', ORDER],
  ['payment_released', ORDER],
  ['delivered', ORDER],
  ['order_confirmed', ORDER],
  ['delivery_confirmed', ORDER],
  ['order_status_updated', ORDER],
  ['review_received', ORDER],
  // Payouts carry no order id: the orders list.
  ['payout_initiated', ORDERS_LIST],
  ['payout_completed', ORDERS_LIST],
  // Disputes: the case.
  ['dispute_filed', DISPUTE],
  ['dispute_opened', DISPUTE],
  ['dispute_created', DISPUTE],
  ['dispute_message', DISPUTE],
  ['dispute_resolved', DISPUTE],
  // Seller verification: the selling page, which shows the decision.
  ['verification_decided', SELL],
])

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// The page a notification opens: its record's page when the id is a real UUID,
// otherwise that section's list. null when it has no page (see above).
// The id check also means nothing else can end up in the address.
export function getNotificationPath(notification) {
  const destination = DESTINATIONS.get(notification?.type)
  if (!destination) return null
  const id = destination.idField ? notification[destination.idField] : null
  return isUuid(id) ? `${destination.base}/${id}` : destination.base
}

// Opens the app and shows this notification's full message in the bell.
export function getInAppMessagePath(notificationId) {
  return isUuid(notificationId) ? `/?notification=${notificationId}` : '/'
}

// Chat messages from one conversation share a tag: phones then keep one tile
// per chat that updates ("3 new messages") instead of one tile per message,
// and the bell shows one row per chat. Everything else stays one per row.
// public/sw.js accepts only these two shapes of tag.
export const CHAT_TAG_PREFIX = 'trustall-chat-'

export function getChatGroupId(notification) {
  const conversationId = notification?.related_conversation_id
  return notification?.type === 'new_message' && isUuid(conversationId) ? conversationId.toLowerCase() : null
}

export function getNotificationTag(notification) {
  const chatId = getChatGroupId(notification)
  if (chatId) return `${CHAT_TAG_PREFIX}${chatId}`
  return isUuid(notification?.id) ? `trustall-${notification.id.toLowerCase()}` : 'trustall-notification'
}

// The text under the title. A chat message with no text is a photo or video
// (the app sends nothing else without text), so it says so instead of a
// vague "new update".
export function getNotificationBody(notification) {
  const text = String(notification?.message ?? '').trim()
  if (text) return text
  return notification?.type === 'new_message' ? 'Sent a photo or video' : 'You have a new update.'
}
