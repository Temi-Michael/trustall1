import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_FILES_PER_MESSAGE,
  checkedPathFor,
  finalPathFor,
  parseCheckedPath,
  parsePendingPath,
  pendingPathFor,
  readSendRequest,
} from './chatMedia.js'

const CONVO = '11111111-1111-4111-8111-111111111111'
const ME = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const MESSAGE = '44444444-4444-4444-8444-444444444444'

test('pending uploads must be in the sender’s own holding folder', () => {
  const path = pendingPathFor(CONVO, ME, '1700000000000_0_photo.jpg')
  assert.equal(path, `${CONVO}/pending/${ME}/1700000000000_0_photo.jpg`)
  assert.deepEqual(parsePendingPath(path, ME), { conversationId: CONVO, fileName: '1700000000000_0_photo.jpg' })
  assert.equal(parsePendingPath(path, OTHER), null)
  assert.equal(parsePendingPath(`${CONVO}/pending/${ME}/../x.jpg`, ME), null)
  assert.equal(parsePendingPath(`${CONVO}/pending/${ME}/sub/x.jpg`, ME), null)
  assert.equal(parsePendingPath(null, ME), null)
})

test('checked files are outside every conversation folder and tied to sender and conversation', () => {
  const path = checkedPathFor(CONVO, ME, 'image', 'a.jpg')
  assert.equal(path, `checked/${CONVO}/${ME}/image/a.jpg`)
  // The storage rules need a conversation ID as the first folder, so no user
  // can read or write under "checked/".
  assert.ok(path.startsWith('checked/'))
  assert.deepEqual(parseCheckedPath(path, { conversationId: CONVO, userId: ME }), { kind: 'image', fileName: 'a.jpg' })
  assert.equal(parseCheckedPath(path, { conversationId: CONVO, userId: OTHER }), null)
  assert.equal(parseCheckedPath(path, { conversationId: OTHER, userId: ME }), null)
  assert.equal(parseCheckedPath(`checked/${CONVO}/${ME}/audio/a.mp3`, { conversationId: CONVO, userId: ME }), null)
  assert.equal(parseCheckedPath(`${CONVO}/pending/${ME}/a.jpg`, { conversationId: CONVO, userId: ME }), null)
  assert.equal(finalPathFor(CONVO, 'a.jpg'), `${CONVO}/a.jpg`)
})

test('a send request needs a conversation, a message ID, and text or checked files', () => {
  const good = readSendRequest({
    conversation_id: CONVO,
    message_id: MESSAGE,
    body: '  hello  ',
    paths: [checkedPathFor(CONVO, ME, 'video', 'v.mp4')],
  }, ME)
  assert.equal(good.ok, true)
  assert.equal(good.body, 'hello')
  assert.deepEqual(good.files, [{ path: `checked/${CONVO}/${ME}/video/v.mp4`, kind: 'video', fileName: 'v.mp4' }])

  assert.equal(readSendRequest({ conversation_id: CONVO, message_id: MESSAGE, body: 'hi' }, ME).ok, true)
  assert.equal(readSendRequest({ conversation_id: CONVO, message_id: MESSAGE, body: '   ', paths: [] }, ME).ok, false)
  assert.equal(readSendRequest({ conversation_id: 'x', message_id: MESSAGE, body: 'hi' }, ME).ok, false)
  assert.equal(readSendRequest({ conversation_id: CONVO, message_id: 'temp-1', body: 'hi' }, ME).ok, false)
  assert.equal(readSendRequest({ conversation_id: CONVO, message_id: MESSAGE, body: 5 }, ME).ok, false)
  assert.equal(readSendRequest(null, ME).ok, false)
})

test('a send request refuses files that weren’t checked for this sender and chat', () => {
  const base = { conversation_id: CONVO, message_id: MESSAGE, body: '' }
  // Straight from the holding folder (never checked).
  assert.equal(readSendRequest({ ...base, paths: [`${CONVO}/pending/${ME}/a.jpg`] }, ME).ok, false)
  // Someone else's checked file.
  assert.equal(readSendRequest({ ...base, paths: [checkedPathFor(CONVO, OTHER, 'image', 'a.jpg')] }, ME).ok, false)
  // Checked for another conversation.
  assert.equal(readSendRequest({ ...base, paths: [checkedPathFor(OTHER, ME, 'image', 'a.jpg')] }, ME).ok, false)
  // The same file twice.
  const one = checkedPathFor(CONVO, ME, 'image', 'a.jpg')
  assert.equal(readSendRequest({ ...base, paths: [one, one] }, ME).ok, false)
  // Too many.
  const many = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, (_, i) => checkedPathFor(CONVO, ME, 'image', `${i}.jpg`))
  assert.equal(readSendRequest({ ...base, paths: many }, ME).ok, false)
  assert.equal(readSendRequest({ ...base, paths: 'not a list' }, ME).ok, false)
})

test('a send request refuses text over the database limit', () => {
  const request = readSendRequest({ conversation_id: CONVO, message_id: MESSAGE, body: 'a'.repeat(5001) }, ME)
  assert.equal(request.ok, false)
})

test('only a column refusal falls back to saving without a chosen ID', async () => {
  const { isColumnPermissionError } = await import('./chatMedia.js')
  assert.equal(isColumnPermissionError({ code: '42501', message: 'permission denied for table messages' }), true)
  assert.equal(isColumnPermissionError({ code: '42501', message: 'new row violates row-level security policy for table "messages"' }), false)
  assert.equal(isColumnPermissionError({ code: '23505', message: 'duplicate key' }), false)
  assert.equal(isColumnPermissionError(null), false)
})
