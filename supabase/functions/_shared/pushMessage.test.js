import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SITE_ORIGIN, buildPushMessage, isDeadTokenResponse, resolveSiteOrigin, truncateText } from './pushMessage.js'

const ID = '3f2b8c1e-9a4d-4e7f-b6c5-0d1e2f3a4b5c'
const CONVERSATION = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const DISPUTE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('the site address accepts https, or http on this computer, and keeps only the origin', () => {
  assert.equal(resolveSiteOrigin('https://dev.trustall.online/some/path?x=1'), 'https://dev.trustall.online')
  assert.equal(resolveSiteOrigin('http://localhost:5173/'), 'http://localhost:5173')
  assert.equal(resolveSiteOrigin('https://user:pass@www.trustall.online'), 'https://www.trustall.online')
  for (const bad of [undefined, '', 'not a url', 'http://www.trustall.online', 'javascript:alert(1)', 'ftp://trustall.online', 'data:text/html,hi']) {
    assert.equal(resolveSiteOrigin(bad), DEFAULT_SITE_ORIGIN, String(bad))
  }
})

test('a push is data-only, with a full address to the same page the bell opens', () => {
  const message = buildPushMessage(
    { id: ID, type: 'new_message', title: 'Ada sent you a message', message: 'Is it still available?', related_conversation_id: CONVERSATION },
    'device-token',
    { siteOrigin: 'https://www.trustall.online', unreadCount: 3 },
  )
  assert.equal(message.notification, undefined, 'a notification block makes Firebase show a second copy')
  assert.equal(message.token, 'device-token')
  assert.deepEqual(message.data, {
    title: 'Ada sent you a message',
    body: 'Is it still available?',
    actionUrl: `https://www.trustall.online/messages/${CONVERSATION}`,
    notificationId: ID,
    inAppOnly: 'false',
    tag: `trustall-chat-${CONVERSATION}`,
    unreadCount: '3',
  })
  assert.equal(message.webpush.headers.Urgency, 'high')
  for (const value of Object.values(message.data)) assert.equal(typeof value, 'string', 'Firebase only takes string data')
})

test('dispute pushes open the case', () => {
  const message = buildPushMessage({ id: ID, type: 'dispute_filed', related_dispute_id: DISPUTE, related_order_id: CONVERSATION }, 't')
  assert.equal(message.data.actionUrl, `${DEFAULT_SITE_ORIGIN}/disputes/${DISPUTE}`)
})

test('marketing pushes open the app on the full message', () => {
  const message = buildPushMessage({ id: ID, type: 'marketing', title: 'Sale', message: 'Big sale' }, 't')
  assert.equal(message.data.inAppOnly, 'true')
  assert.equal(message.data.actionUrl, `${DEFAULT_SITE_ORIGIN}/?notification=${ID}`)
})

test('long text is cut to a preview, never past the Firebase size limit', () => {
  const message = buildPushMessage({ id: ID, type: 'marketing', title: 'T'.repeat(500), message: '😀'.repeat(5000) }, 't')
  assert.equal(Array.from(message.data.title).length, 100)
  assert.equal(Array.from(message.data.body).length, 240)
  assert.ok(message.data.body.endsWith('…'))
  assert.ok(!message.data.body.includes('�'), 'no emoji split in half')
  assert.ok(new TextEncoder().encode(JSON.stringify(message)).length < 4096)
})

test('missing text gets a default and empty values stay strings', () => {
  const message = buildPushMessage({ id: 'not-a-uuid', type: 'new_message', title: '  ', message: null }, 't')
  assert.equal(message.data.title, 'Trustall')
  // A chat message without text is a photo or video.
  assert.equal(message.data.body, 'Sent a photo or video')
  assert.equal(message.data.notificationId, '')
  assert.equal(message.data.tag, 'trustall-notification')
  assert.equal(buildPushMessage({ id: ID, type: 'order_confirmed', message: ' ' }, 't').data.body, 'You have a new update.')
  assert.equal(message.data.unreadCount, undefined)
  assert.equal(truncateText('  short  ', 10), 'short')
})

test('only a dead device token is deleted', () => {
  const fcmError = (status, message, errorCode) => JSON.stringify({
    error: { code: 400, status, message, details: errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : [] },
  })
  assert.equal(isDeadTokenResponse(fcmError('NOT_FOUND', 'Requested entity was not found.', 'UNREGISTERED')), true)
  assert.equal(isDeadTokenResponse(fcmError('INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token', 'INVALID_ARGUMENT')), true)

  assert.equal(isDeadTokenResponse(fcmError('INVALID_ARGUMENT', 'Message is too big', 'INVALID_ARGUMENT')), false)
  assert.equal(isDeadTokenResponse(fcmError('PERMISSION_DENIED', 'SenderId mismatch', 'SENDER_ID_MISMATCH')), false)
  assert.equal(isDeadTokenResponse(fcmError('NOT_FOUND', 'Requested entity was not found.')), false, 'a wrong project is not the device')
  assert.equal(isDeadTokenResponse(fcmError('UNAVAILABLE', 'try later', 'UNAVAILABLE')), false)
  for (const body of ['', 'oops UNREGISTERED', '<html>502</html>', 'null', '{"error":"x"}']) {
    assert.equal(isDeadTokenResponse(body), false, body)
  }
})
