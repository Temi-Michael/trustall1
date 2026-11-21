export function isMessageUnread(message, lastReadAt) {
  if (!message?.created_at) return false
  if (!lastReadAt) return true
  return new Date(message.created_at).getTime() > new Date(lastReadAt).getTime()
}

export function getUnreadCount(messages, lastReadAt) {
  if (!Array.isArray(messages)) return 0
  return messages.filter((message) => isMessageUnread(message, lastReadAt)).length
}

export function shouldAutoScroll(pane) {
  if (!pane) return true
  const distanceFromBottom = pane.scrollHeight - (pane.scrollTop + pane.clientHeight)
  return distanceFromBottom <= 80
}

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('').slice(0, 2)
}

export function getRelativeTimeLabel(timestamp, now = new Date()) {
  if (!timestamp) return 'just now'

  const diffMs = Math.max(0, new Date(now).getTime() - new Date(timestamp).getTime())
  const minutes = Math.floor(diffMs / 60000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} mins ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`

  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function getPresenceLabel(isOnline, lastSeenAt, now = new Date()) {
  if (isOnline) return 'Online'
  if (!lastSeenAt) return 'Offline'
  return `Offline • Last seen ${getRelativeTimeLabel(lastSeenAt, now)}`
}

/**
 * Whether Enter in the message box should send the message.
 *
 * - On a computer, Enter sends and Shift+Enter (or Alt+Enter) starts a new line.
 * - On a phone or tablet, Enter always starts a new line and the send button
 *   sends: touch keyboards have no Shift+Enter, so that is the only way to
 *   write on more than one line.
 * - Never while a word is still being composed (keyboards for accents and
 *   other scripts use Enter to pick the word).
 *
 * @param {{ key: string, shiftKey?: boolean, altKey?: boolean, isComposing?: boolean, keyCode?: number }} event
 * @param {{ touchKeyboard?: boolean }} [options]
 */
export function shouldSendOnEnter(event, { touchKeyboard = false } = {}) {
  if (event?.key !== 'Enter') return false
  if (event.isComposing || event.keyCode === 229) return false
  if (event.shiftKey || event.altKey) return false
  return !touchKeyboard
}

/** True on phones and tablets (the main pointer is a finger, not a mouse). */
export function hasTouchKeyboard() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
}
