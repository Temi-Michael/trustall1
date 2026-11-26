// Sending a chat message that has photos or videos (the text-only path stays
// in Messages.jsx). Upload and check every file first, then save the message
// and its files in one server call, so leaving part way through never leaves a
// half-sent message for the other person. The rules for where files go are in
// supabase/functions/_shared/chatMedia.js; the server side is the
// screen-chat-image function (its "check" and "send" actions).
import { safeFileName } from './inputSafety.js'
import {
  MAX_FILES_PER_MESSAGE,
  SEND_FAILED_MESSAGE,
  isColumnPermissionError,
  pendingPathFor,
} from '../../supabase/functions/_shared/chatMedia.js'

export { MAX_FILES_PER_MESSAGE, isColumnPermissionError }

const BUCKET = 'message-attachments'
const FUNCTION_NAME = 'screen-chat-image'
const UPLOAD_FAILED_MESSAGE = "A photo or video didn't finish uploading, so nothing was sent. Check your connection and tap send again."
const CHECK_FAILED_MESSAGE = "We couldn't check a photo or video right now, so nothing was sent. Please try again in a moment."

/**
 * Remembers which files of the message being written have already passed the
 * check, so sending again (after a lost connection, or after fixing the text)
 * doesn't upload and check them a second time. Keyed by the File object; each
 * entry is tied to its conversation.
 */
export function createCheckedFiles() {
  const entries = new Map()
  return {
    get(file, conversationId) {
      const entry = entries.get(file)
      return entry && entry.conversationId === conversationId ? entry.path : null
    },
    set(file, conversationId, path) {
      entries.set(file, { conversationId, path })
    },
    forgetPath(path) {
      for (const [file, entry] of entries) if (entry.path === path) entries.delete(file)
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/**
 * Sends one message with files.
 *
 * @param {object} options
 * @param {object} options.client       the Supabase client
 * @param {string} options.conversationId
 * @param {string} options.userId
 * @param {string} options.messageId    chosen by the browser; the same ID when
 *   sending the same message again, so a lost reply can't make a second copy
 * @param {string} options.text         already trimmed
 * @param {File[]} options.files
 * @param {ReturnType<typeof createCheckedFiles>} options.checked
 * @param {(index: number, total: number) => void} [options.onProgress]
 * @param {() => number} [options.now]
 * @returns {Promise<
 *   | { status: 'sent', message: object, attachments: object[], notices: string[], blockedFiles: File[] }
 *   | { status: 'not_sent', reason: 'failed' | 'blocked' | 'contact_details', notice: string, blockedFiles: File[] }
 * >}
 *   not_sent keeps the text and files in the message box, except blockedFiles
 *   (files that can never be sent, such as one showing a phone number).
 */
export async function sendMessageWithFiles({ client, conversationId, userId, messageId, text, files, checked, onProgress, now = Date.now }) {
  const notices = []
  const blockedFiles = []
  const checkedPaths = []
  const notSent = (reason, notice) => ({ status: 'not_sent', reason, notice, blockedFiles })

  if (files.length > MAX_FILES_PER_MESSAGE) {
    return notSent('blocked', `You can send up to ${MAX_FILES_PER_MESSAGE} photos or videos in one message.`)
  }

  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length)
    let path = checked.get(file, conversationId)
    if (!path) {
      const pendingPath = pendingPathFor(conversationId, userId, `${now()}_${index}_${safeFileName(file.name)}`)
      const { error: uploadError } = await client.storage.from(BUCKET).upload(pendingPath, file, { upsert: true })
      if (uploadError) {
        console.error('Chat upload failed:', uploadError)
        return notSent('failed', UPLOAD_FAILED_MESSAGE)
      }

      const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body: { action: 'check', path: pendingPath } })
      if (error || !data) {
        console.error('Chat media check failed:', error)
        return notSent('failed', CHECK_FAILED_MESSAGE)
      }
      if (data.status === 'blocked') {
        blockedFiles.push(file)
        notices.push(data.message)
        continue
      }
      if (data.status !== 'clean' || typeof data.path !== 'string') return notSent('failed', data.message || CHECK_FAILED_MESSAGE)
      path = data.path
      checked.set(file, conversationId, path)
    }
    checkedPaths.push(path)
  }

  // Every file was refused and there's no text: nothing to send.
  if (!text && checkedPaths.length === 0) return notSent('blocked', notices[0] || CHECK_FAILED_MESSAGE)

  const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
    body: { action: 'send', conversation_id: conversationId, message_id: messageId, body: text, paths: checkedPaths },
  })
  if (error || !data) {
    console.error('Sending the message failed:', error)
    return notSent('failed', SEND_FAILED_MESSAGE)
  }
  if (data.code === 'TC001') return notSent('contact_details', data.message)
  if (!data.sent || !data.message) {
    // Files the server couldn't find are uploaded and checked again next time.
    for (const path of Array.isArray(data.missing_paths) ? data.missing_paths : []) checked.forgetPath(path)
    return notSent('failed', data.message || SEND_FAILED_MESSAGE)
  }

  checked.clear()
  return { status: 'sent', message: data.message, attachments: data.attachments || [], notices, blockedFiles }
}

/** A new message ID. Chosen in the browser so a repeat send is recognised. */
export function newMessageId() {
  return globalThis.crypto.randomUUID()
}

export { SEND_FAILED_MESSAGE }
