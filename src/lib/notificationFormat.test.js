import test from 'node:test'
import assert from 'node:assert/strict'
import { groupNotifications, nextChatGroup } from './notificationFormat.js'

const CHAT_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const CHAT_B = '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const row = (id, type, chat, minute) => ({
  id, type, related_conversation_id: chat, created_at: `2026-11-21T10:${String(minute).padStart(2, '0')}:00Z`,
})

test('the bell shows one row per chat, newest message first, with the count', () => {
  const list = [
    row('m4', 'new_message', CHAT_A, 40),
    row('o1', 'offer_received', CHAT_A, 35),
    row('m3', 'new_message', CHAT_B, 30),
    row('m2', 'new_message', CHAT_A, 20),
    row('p1', 'payment_released', null, 15),
    row('m1', 'new_message', CHAT_A, 10),
  ]
  const groups = groupNotifications(list)
  assert.deepEqual(groups.map((group) => [group.latest.id, group.items.length]), [
    ['m4', 3], ['o1', 1], ['m3', 1], ['p1', 1],
  ])
  assert.equal(groups[0].conversationId, CHAT_A)
  assert.equal(groups[1].conversationId, null, 'an offer is its own row')
})

test('the newest message leads even when the list arrives out of order', () => {
  const groups = groupNotifications([row('old', 'new_message', CHAT_A, 5), row('new', 'new_message', CHAT_A, 50)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].latest.id, 'new')
})

test('empty and missing rows are skipped', () => {
  assert.deepEqual(groupNotifications(undefined), [])
  assert.equal(groupNotifications([null, row('a', 'new_message', CHAT_A, 1)]).length, 1)
})

test('a chat tile counts each notification once', () => {
  const first = nextChatGroup(undefined, 'n1')
  assert.deepEqual(first, { count: 1, ids: ['n1'], repeat: false })
  const second = nextChatGroup(first, 'n2')
  assert.deepEqual(second, { count: 2, ids: ['n1', 'n2'], repeat: false })
  // The push and the open app both show n2: still 2.
  assert.deepEqual(nextChatGroup(second, 'n2'), { count: 2, ids: ['n1', 'n2'], repeat: true })
  // A tile from before grouping (no count) counts as one.
  assert.equal(nextChatGroup({ url: '/messages' }, 'n9').count, 2)
  // Bad data on the tile can't break the count.
  assert.equal(nextChatGroup({ count: -4, ids: 'x' }, 'n1').count, 2)
  // The memory of ids stays small.
  let state
  for (let index = 0; index < 60; index += 1) state = nextChatGroup(state, `n${index}`)
  assert.equal(state.count, 60)
  assert.equal(state.ids.length, 50)
})
