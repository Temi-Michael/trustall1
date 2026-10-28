import test from 'node:test'
import assert from 'node:assert/strict'

import { getNotificationDisplayTitle, getNotificationBadgeSummary } from './notificationFormat.js'

test('message notifications show sender name instead of a generic Trustall label', () => {
  const notification = {
    type: 'new_message',
    title: 'You have a new message on Trustall',
    message: 'Hi, can we proceed?',
  }

  assert.equal(
    getNotificationDisplayTitle(notification, 'Jane Doe'),
    'New message from Jane Doe'
  )
})

test('notification badge summary separates message and order notifications', () => {
  const rows = [
    { type: 'new_message' },
    { type: 'new_message' },
    { type: 'payment_pending' },
    { type: 'marketing' },
  ]

  assert.deepEqual(getNotificationBadgeSummary(rows), {
    message: 2,
    order: 1,
    other: 1,
  })
})
