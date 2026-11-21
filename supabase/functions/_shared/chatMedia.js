// Where chat photos and videos are stored while they're sent, and the checks on
// a "send" request. Plain JavaScript, shared by the screen-chat-image function
// and the website, so both follow the same rules and Node can test them.
//
// A photo goes through three places in the message-attachments bucket:
//   1. <conversation>/pending/<sender>/<file>   uploaded by the sender's browser;
//      only the sender can read it (migration 0037).
//   2. checked/<conversation>/<sender>/<kind>/<file>   moved there by the server
//      once the photo passed the check. No user can read, upload or change
//      anything under "checked/" (the storage rules need a conversation ID as
//      the first folder), so a file there is proof it was checked.
//   3. <conversation>/<file>   moved there by the server when the message is
//      saved, together with its attachment record. Both people can see it.
// Nothing reaches the other person until step 3, so a sender who leaves part
// way through leaves nothing half-sent behind.

export const MAX_FILES_PER_MESSAGE = 10
// Same limit as the messages_body_length check (migration 0032).
export const MAX_MESSAGE_LENGTH = 5000

// Same words as the contact-details check on messages (migration 0037).
export const CONTACT_DETAILS_MESSAGE =
  "For your safety, phone numbers, emails, links and bank details can't be shared in chat. Keep payments and contact inside Trustall."
export const SEND_FAILED_MESSAGE =
  "Your message wasn't sent. Check your connection and tap send again."

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FILE_NAME = '[\\w.-]{1,150}'
const PENDING_PATH = new RegExp(`^(${UUID})/pending/(${UUID})/(${FILE_NAME})$`, 'i')
const CHECKED_PATH = new RegExp(`^checked/(${UUID})/(${UUID})/(image|video)/(${FILE_NAME})$`, 'i')
const UUID_ONLY = new RegExp(`^${UUID}$`, 'i')

function sameId(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase()
}

/**
 * True when the database refused a column rather than the row: a database
 * that doesn't let users choose a message's ID. The message is then saved
 * without one (losing only the protection against a repeat after a lost
 * reply) instead of not at all. Row-security refusals are real refusals.
 */
export function isColumnPermissionError(error) {
  return error?.code === '42501' && !/row-level security/i.test(String(error.message || ''))
}

/** "<conversation>/pending/<sender>/<file>" for a new upload. */
export function pendingPathFor(conversationId, userId, fileName) {
  return `${conversationId}/pending/${userId}/${fileName}`
}

/**
 * The conversation and file name of the sender's own pending upload, or null
 * if the path is malformed or in someone else's holding folder.
 */
export function parsePendingPath(path, userId) {
  const match = typeof path === 'string' ? path.match(PENDING_PATH) : null
  if (!match || !sameId(match[2], userId)) return null
  return { conversationId: match[1], fileName: match[3] }
}

/** Where a photo waits after passing the check. kind is 'image' or 'video'. */
export function checkedPathFor(conversationId, userId, kind, fileName) {
  return `checked/${conversationId}/${userId}/${kind}/${fileName}`
}

/**
 * The kind and file name of a checked file that belongs to this sender and
 * conversation, or null.
 */
export function parseCheckedPath(path, { conversationId, userId }) {
  const match = typeof path === 'string' ? path.match(CHECKED_PATH) : null
  if (!match || !sameId(match[1], conversationId) || !sameId(match[2], userId)) return null
  return { kind: match[3].toLowerCase(), fileName: match[4] }
}

/** Where a sent file lives: "<conversation>/<file>", visible to both people. */
export function finalPathFor(conversationId, fileName) {
  return `${conversationId}/${fileName}`
}

/**
 * Checks a "send" request from the browser: which conversation, the message ID
 * the browser chose (so sending again after a lost reply can't make a second
 * copy), the text, and the checked files to attach.
 *
 * @returns {{ ok: true, conversationId: string, messageId: string, body: string,
 *   files: Array<{ path: string, kind: string, fileName: string }> } | { ok: false, error: string }}
 */
export function readSendRequest(payload, userId) {
  const conversationId = payload?.conversation_id
  const messageId = payload?.message_id
  if (typeof conversationId !== 'string' || !UUID_ONLY.test(conversationId)) return { ok: false, error: 'A valid conversation_id is required' }
  if (typeof messageId !== 'string' || !UUID_ONLY.test(messageId)) return { ok: false, error: 'A valid message_id is required' }

  const rawBody = payload?.body ?? ''
  if (typeof rawBody !== 'string') return { ok: false, error: 'body must be text' }
  const body = rawBody.trim()
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters` }

  const paths = payload?.paths ?? []
  if (!Array.isArray(paths)) return { ok: false, error: 'paths must be a list' }
  if (paths.length > MAX_FILES_PER_MESSAGE) return { ok: false, error: `Up to ${MAX_FILES_PER_MESSAGE} photos or videos per message` }
  if (!body && paths.length === 0) return { ok: false, error: 'Nothing to send' }

  const files = []
  const seen = new Set()
  for (const path of paths) {
    const parsed = parseCheckedPath(path, { conversationId, userId })
    if (!parsed) return { ok: false, error: 'Every file must be one of your own checked uploads for this conversation' }
    if (seen.has(path)) return { ok: false, error: 'The same file was listed twice' }
    seen.add(path)
    files.push({ path, ...parsed })
  }
  return { ok: true, conversationId, messageId, body, files }
}
