import test from 'node:test'
import assert from 'node:assert/strict'
import {
  daysBetween,
  formatConversationTime,
  formatDayLabel,
  formatFullTimestamp,
  formatMessageTime,
  groupByDay,
} from './messageTime.js'

// Fixed language and time zone so results don't depend on the test machine.
const UTC = { locale: 'en-GB', timeZone: 'UTC' }
const LAGOS = { locale: 'en-GB', timeZone: 'Africa/Lagos' } // UTC+1
const NOW = '2026-11-20T15:00:00.000Z' // Friday

// Exact wording of dates differs between Node/ICU versions ("Fri 13 Nov" vs
// "Fri, 13 Nov"), so formatted dates are checked against Intl itself; the
// words this code chooses (Today, Yesterday) are checked exactly.
const intl = (timestamp, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(timestamp))

test('message time is the short clock time', () => {
  // \s: some ICU versions put a narrow no-break space before AM.
  assert.match(formatMessageTime('2026-11-20T09:05:00.000Z', { locale: 'en-US', timeZone: 'UTC' }), /^9:05\sAM$/)
  // Lagos is an hour ahead of UTC.
  assert.match(formatMessageTime('2026-11-20T09:05:00.000Z', LAGOS), /^10:05/)
})

test('missing or broken times show nothing instead of "Invalid Date"', () => {
  for (const value of [null, undefined, '', 'not a date']) {
    assert.equal(formatMessageTime(value, UTC), '')
    assert.equal(formatFullTimestamp(value, UTC), '')
    assert.equal(formatDayLabel(value, NOW, UTC), '')
    assert.equal(formatConversationTime(value, NOW, UTC), '')
  }
})

test('full timestamp includes the weekday, date, year and time', () => {
  const full = formatFullTimestamp('2026-11-16T14:30:00.000Z', { locale: 'en-US', timeZone: 'UTC' })
  for (const part of ['Mon', 'Nov', '16', '2026', '2:30']) assert.ok(full.includes(part), `${full} should include ${part}`)
})

test('days are counted by calendar day, not 24-hour blocks', () => {
  assert.equal(daysBetween('2026-11-19T23:59:00.000Z', '2026-11-20T00:01:00.000Z', UTC), 1)
  assert.equal(daysBetween('2026-11-20T00:01:00.000Z', '2026-11-20T23:59:00.000Z', UTC), 0)
  // 23:30 UTC on the 19th is already the 20th in Lagos.
  assert.equal(daysBetween('2026-11-19T23:30:00.000Z', NOW, LAGOS), 0)
  assert.equal(daysBetween(null, NOW, UTC), null)
})

test('day dividers say Today, Yesterday, the weekday, then the full date', () => {
  assert.equal(formatDayLabel('2026-11-20T08:00:00.000Z', NOW, UTC), 'Today')
  assert.equal(formatDayLabel('2026-11-19T22:00:00.000Z', NOW, UTC), 'Yesterday')
  assert.equal(formatDayLabel('2026-11-16T10:00:00.000Z', NOW, UTC), 'Monday')
  assert.equal(formatDayLabel('2026-11-13T10:00:00.000Z', NOW, UTC),
    intl('2026-11-13T10:00:00.000Z', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
})

test('chat list time: clock today, then Yesterday, weekday, date, date with year', () => {
  assert.equal(formatConversationTime('2026-11-20T09:05:00.000Z', NOW, UTC), formatMessageTime('2026-11-20T09:05:00.000Z', UTC))
  assert.equal(formatConversationTime('2026-11-19T09:05:00.000Z', NOW, UTC), 'Yesterday')
  assert.equal(formatConversationTime('2026-11-17T09:05:00.000Z', NOW, UTC), intl('2026-11-17T09:05:00.000Z', { weekday: 'short' }))
  assert.equal(formatConversationTime('2026-10-02T09:05:00.000Z', NOW, UTC), intl('2026-10-02T09:05:00.000Z', { day: 'numeric', month: 'short' }))
  assert.equal(formatConversationTime('2025-10-02T09:05:00.000Z', NOW, UTC), intl('2025-10-02T09:05:00.000Z', { day: 'numeric', month: 'short', year: 'numeric' }))
  assert.match(formatConversationTime('2025-10-02T09:05:00.000Z', NOW, UTC), /2025/)
})

test('a time slightly ahead of this device still counts as today', () => {
  // Another device's clock (or the server's) can be a little ahead.
  assert.equal(formatConversationTime('2026-11-20T15:01:00.000Z', NOW, UTC), formatMessageTime('2026-11-20T15:01:00.000Z', UTC))
})

test('groupByDay puts one divider before each new day', () => {
  const items = [
    { id: 'a', kind: 'message', created_at: '2026-11-19T10:00:00.000Z' },
    { id: 'b', kind: 'offer', created_at: '2026-11-19T11:00:00.000Z' },
    { id: 'c', kind: 'message', created_at: '2026-11-20T09:00:00.000Z' },
  ]
  const rows = groupByDay(items, NOW, UTC)
  assert.deepEqual(rows.map((row) => row.type === 'day' ? row.label : row.key), [
    'Yesterday', 'message-a', 'offer-b', 'Today', 'message-c',
  ])
})

test('groupByDay keeps an item with no time under the current day', () => {
  const rows = groupByDay([
    { id: 'a', kind: 'message', created_at: '2026-11-20T09:00:00.000Z' },
    { id: 'b', kind: 'message', created_at: null },
  ], NOW, UTC)
  assert.deepEqual(rows.map((row) => row.type), ['day', 'item', 'item'])
  assert.deepEqual(groupByDay(null, NOW, UTC), [])
})
