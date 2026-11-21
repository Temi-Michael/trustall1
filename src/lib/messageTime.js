// Dates and times shown in chat. Message times are set by the database when a
// message is saved; these helpers only decide how they're shown, in the
// viewer's own time zone and language unless a test passes them in.
//
// options: { locale?: string, timeZone?: string } (both default to the browser's)

const DAY_MS = 24 * 60 * 60 * 1000
const formatters = new Map()

// Intl formatters are slow to create and a chat can show hundreds of times,
// so each combination is created once and reused.
function formatter(locale, options) {
  const key = JSON.stringify([locale ?? null, options])
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, options))
  return formatters.get(key)
}

function toDate(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === '') return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

// The calendar day a moment falls on in the viewer's time zone, counted in
// whole days. Comparing these (rather than subtracting 24 hours) keeps
// "Today" and "Yesterday" right across midnight and daylight-saving changes.
function calendarDay(date, timeZone) {
  const parts = formatter('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(date)
  const value = (type) => Number(parts.find((part) => part.type === type).value)
  return Math.round(Date.UTC(value('year'), value('month') - 1, value('day')) / DAY_MS)
}

/** Days between two moments' calendar days: 0 = same day, 1 = the day before. */
export function daysBetween(earlier, later, { timeZone } = {}) {
  const a = toDate(earlier)
  const b = toDate(later)
  if (!a || !b) return null
  return calendarDay(b, timeZone) - calendarDay(a, timeZone)
}

/** "3:45 PM": the time under each message. Empty for a missing or bad time. */
export function formatMessageTime(timestamp, { locale, timeZone } = {}) {
  const date = toDate(timestamp)
  return date ? formatter(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(date) : ''
}

/** "Mon, 16 Nov 2026, 3:45 PM": the exact date and time, when asked for. */
export function formatFullTimestamp(timestamp, { locale, timeZone } = {}) {
  const date = toDate(timestamp)
  if (!date) return ''
  return formatter(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * The divider above each day's messages: "Today", "Yesterday", a weekday name
 * within the last week ("Monday"), otherwise the full date ("Mon, 16 Nov 2026").
 */
export function formatDayLabel(timestamp, now = new Date(), { locale, timeZone } = {}) {
  const date = toDate(timestamp)
  if (!date) return ''
  const days = daysBetween(date, now, { timeZone })
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return formatter(locale, { timeZone, weekday: 'long' }).format(date)
  return formatter(locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/**
 * The time beside each chat in the list: "3:45 PM" today, "Yesterday", a
 * short weekday within the last week ("Mon"), "16 Nov" this year, and
 * "16 Nov 2025" for older years.
 */
export function formatConversationTime(timestamp, now = new Date(), { locale, timeZone } = {}) {
  const date = toDate(timestamp)
  if (!date) return ''
  const days = daysBetween(date, now, { timeZone })
  if (days <= 0) return formatMessageTime(date, { locale, timeZone })
  if (days === 1) return 'Yesterday'
  if (days < 7) return formatter(locale, { timeZone, weekday: 'short' }).format(date)
  const sameYear = formatter('en-US', { timeZone, year: 'numeric' }).format(date)
    === formatter('en-US', { timeZone, year: 'numeric' }).format(toDate(now))
  return formatter(locale, sameYear
    ? { timeZone, day: 'numeric', month: 'short' }
    : { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/**
 * Splits a time-ordered list of chat items (messages and offers) into days:
 * a divider entry goes before the first item of each new day.
 *
 * @returns {Array<{ type: 'day', key: string, label: string } | { type: 'item', key: string, item: object }>}
 */
export function groupByDay(items, now = new Date(), options = {}) {
  const rows = []
  let previousDay = null
  for (const item of items || []) {
    const date = toDate(item?.created_at)
    const day = date ? calendarDay(date, options.timeZone) : previousDay
    if (date && day !== previousDay) {
      rows.push({ type: 'day', key: `day-${day}`, label: formatDayLabel(date, now, options) })
      previousDay = day
    }
    rows.push({ type: 'item', key: `${item.kind || 'item'}-${item.id}`, item })
  }
  return rows
}
