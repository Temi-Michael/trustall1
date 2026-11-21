import test from 'node:test'
import assert from 'node:assert/strict'
import { getChatGroupId, getInAppMessagePath, getNotificationBody, getNotificationPath, getNotificationTag, isUuid } from './notificationRoutes.js'

const ID = '3f2b8c1e-9a4d-4e7f-b6c5-0d1e2f3a4b5c'

test('chat notifications open the conversation', () => {
  for (const type of ['new_message', 'offer_received', 'offer_accepted', 'delivery_address_shared']) {
    assert.equal(getNotificationPath({ type, related_conversation_id: ID }), `/messages/${ID}`, type)
    assert.equal(getNotificationPath({ type }), '/messages', `${type} without a conversation`)
  }
})

test('order notifications open the order', () => {
  for (const type of ['payment_pending', 'payment_confirmed', 'payment_released', 'delivered',
    'order_confirmed', 'delivery_confirmed', 'review_received', 'order_status_updated']) {
    assert.equal(getNotificationPath({ type, related_order_id: ID }), `/orders/${ID}`, type)
    assert.equal(getNotificationPath({ type }), '/orders', `${type} without an order`)
  }
  assert.equal(getNotificationPath({ type: 'payout_completed', related_order_id: ID }), '/orders')
})

test('dispute notifications open the case', () => {
  for (const type of ['dispute_filed', 'dispute_opened', 'dispute_resolved', 'dispute_created', 'dispute_message']) {
    assert.equal(getNotificationPath({ type, related_dispute_id: ID, related_order_id: ID }), `/disputes/${ID}`, type)
    assert.equal(getNotificationPath({ type, related_order_id: ID }), '/disputes', `${type} without a case`)
  }
})

test('a verification decision opens the selling page', () => {
  assert.equal(getNotificationPath({ type: 'verification_decided', related_order_id: ID }), '/sell')
})

test('marketing and unknown types have no page: the app shows the message', () => {
  for (const notification of [{ type: 'marketing' }, { type: 'something_new' }, { type: null }, {}, null, undefined]) {
    assert.equal(getNotificationPath(notification), null, JSON.stringify(notification))
  }
})

test('inherited object keys are not notification types', () => {
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(getNotificationPath({ type, related_order_id: ID }), null, type)
  }
})

test('only a real UUID goes into the address', () => {
  for (const bad of ['../admin', `${ID}/../../admin`, `${ID}?x=1`, '//evil.example', 'javascript:alert(1)', ' ', 42, {}]) {
    assert.equal(getNotificationPath({ type: 'new_message', related_conversation_id: bad }), '/messages', String(bad))
  }
  assert.equal(getNotificationPath({ type: 'new_message', related_conversation_id: ID.toUpperCase() }), `/messages/${ID.toUpperCase()}`)
})

test('the in-app message link carries only a UUID', () => {
  assert.equal(getInAppMessagePath(ID), `/?notification=${ID}`)
  assert.equal(getInAppMessagePath('x&redirectTo=//evil'), '/')
  assert.equal(getInAppMessagePath(undefined), '/')
  assert.equal(isUuid(ID), true)
  assert.equal(isUuid(`${ID}\n`), false)
})

test('chat messages share one tag per conversation; everything else is one per row', () => {
  const CHAT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
  const message = { id: ID, type: 'new_message', related_conversation_id: CHAT.toUpperCase() }
  assert.equal(getChatGroupId(message), CHAT)
  assert.equal(getNotificationTag(message), `trustall-chat-${CHAT}`)
  assert.equal(getNotificationTag({ ...message, id: 'b'.repeat(8) }), `trustall-chat-${CHAT}`, 'the chat decides, not the row')
  // An offer in the same chat is its own row and tile.
  assert.equal(getChatGroupId({ ...message, type: 'offer_received' }), null)
  assert.equal(getNotificationTag({ ...message, type: 'offer_received' }), `trustall-${ID}`)
  // Nothing else can get into a tag.
  assert.equal(getNotificationTag({ type: 'new_message', related_conversation_id: '../x', id: ID }), `trustall-${ID}`)
  assert.equal(getNotificationTag({ type: 'marketing', id: 'nope' }), 'trustall-notification')
  assert.equal(getNotificationTag(null), 'trustall-notification')
})

test('a notification always has text to show', () => {
  assert.equal(getNotificationBody({ type: 'new_message', message: '  Hello  ' }), 'Hello')
  assert.equal(getNotificationBody({ type: 'new_message', message: '' }), 'Sent a photo or video')
  assert.equal(getNotificationBody({ type: 'new_message', message: null }), 'Sent a photo or video')
  assert.equal(getNotificationBody({ type: 'order_confirmed', message: ' ' }), 'You have a new update.')
  assert.equal(getNotificationBody(undefined), 'You have a new update.')
})
