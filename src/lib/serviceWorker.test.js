// Runs the real public/sw.js in a sandbox with stand-ins for the browser and
// Firebase, to check what a push shows and where a tap goes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
const SITE = 'https://www.trustall.online'
const ID = '3f2b8c1e-9a4d-4e7f-b6c5-0d1e2f3a4b5c'
const CONVERSATION = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

function fakeWindow(url, { focused = false, controlled = true } = {}) {
  return {
    url,
    focused,
    visibilityState: focused ? 'visible' : 'hidden',
    calls: [],
    async focus() { this.calls.push(['focus']); return this },
    async navigate(target) {
      if (!controlled) throw new TypeError('not controlled')
      this.calls.push(['navigate', target]); this.url = target; return this
    },
    // A real postMessage copies the message; copying here also brings it out
    // of the sandbox, so deepEqual compares values only.
    postMessage(message) { this.calls.push(['postMessage', structuredClone(message)]) },
  }
}

function loadWorker(windows = []) {
  const listeners = {}
  const shown = []
  const opened = []
  let onBackgroundMessage
  const self = {
    location: new URL(`${SITE}/sw.js?v=5`),
    addEventListener: (type, handler) => { listeners[type] = handler },
    skipWaiting: () => {},
    registration: {
      showNotification: async (title, options) => { shown.push({ title, options }) },
      // What's on screen for a tag: the last one shown replaced the others.
      getNotifications: async ({ tag }) => {
        const last = [...shown].reverse().find((entry) => entry.options.tag === tag)
        return last ? [{ data: last.options.data }] : []
      },
      setAppBadge: async () => {},
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); return null },
      claim: async () => {},
    },
  }
  const firebase = {
    initializeApp: () => {},
    messaging: () => ({ onBackgroundMessage: (handler) => { onBackgroundMessage = handler } }),
  }
  vm.runInNewContext(SOURCE, { self, firebase, URL, importScripts: () => {} })

  return {
    shown,
    opened,
    push: (payload) => onBackgroundMessage(payload),
    async tap(data) {
      let work
      listeners.notificationclick({ notification: { data, close() {} }, waitUntil: (promise) => { work = promise } })
      await work
    },
  }
}

const pushData = (extra = {}) => ({
  title: 'Ada sent you a message',
  body: 'Is it still available?',
  actionUrl: `${SITE}/messages/${CONVERSATION}`,
  notificationId: ID,
  inAppOnly: 'false',
  ...extra,
})

test('a data-only push shows exactly one notification, tagged with its id', async () => {
  const worker = loadWorker()
  await worker.push({ data: pushData() })
  assert.equal(worker.shown.length, 1)
  assert.equal(worker.shown[0].title, 'Ada sent you a message')
  assert.equal(worker.shown[0].options.body, 'Is it still available?')
  assert.equal(worker.shown[0].options.tag, `trustall-${ID}`)
  assert.equal(worker.shown[0].options.data.url, `${SITE}/messages/${CONVERSATION}`)
})

test('a push that Firebase already showed is not shown again', async () => {
  const worker = loadWorker()
  await worker.push({ notification: { title: 'Old style', body: 'x' }, data: pushData() })
  assert.equal(worker.shown.length, 0)
})

test('tapping navigates the open app to the page, without a second window', async () => {
  const open = fakeWindow(`${SITE}/browse`, { focused: true })
  const worker = loadWorker([open])
  await worker.push({ data: pushData() })
  await worker.tap(worker.shown[0].options.data)
  assert.deepEqual(open.calls, [['focus'], ['navigate', `${SITE}/messages/${CONVERSATION}`]])
  assert.deepEqual(worker.opened, [])
})

test('tapping with the app closed opens the page, never just the home page', async () => {
  const worker = loadWorker()
  await worker.tap({ url: `${SITE}/orders/${CONVERSATION}`, notificationId: ID, inAppOnly: false })
  assert.deepEqual(worker.opened, [`${SITE}/orders/${CONVERSATION}`])
})

test('a tap on a notification shown by the open app (a plain path) works the same', async () => {
  const worker = loadWorker()
  await worker.tap({ url: `/disputes/${CONVERSATION}`, notificationId: ID, inAppOnly: false })
  assert.deepEqual(worker.opened, [`${SITE}/disputes/${CONVERSATION}`])
})

test('a window already on the page is only focused', async () => {
  const open = fakeWindow(`${SITE}/messages/${CONVERSATION}`)
  const worker = loadWorker([open])
  await worker.tap({ url: `${SITE}/messages/${CONVERSATION}` })
  assert.deepEqual(open.calls, [['focus']])
})

test('a window the worker does not control gets a new window on the page instead', async () => {
  const open = fakeWindow(`${SITE}/`, { controlled: false })
  const worker = loadWorker([open])
  await worker.tap({ url: `${SITE}/orders/${CONVERSATION}` })
  assert.deepEqual(worker.opened, [`${SITE}/orders/${CONVERSATION}`])
})

test('windows of other sites are never used', async () => {
  const other = fakeWindow('https://evil.example/', { focused: true })
  const worker = loadWorker([other])
  await worker.tap({ url: `${SITE}/orders/${CONVERSATION}` })
  assert.deepEqual(other.calls, [])
  assert.deepEqual(worker.opened, [`${SITE}/orders/${CONVERSATION}`])
})

test('a tap only ever opens this site', async () => {
  const cases = [
    ['https://evil.example/steal?x=1', `${SITE}/steal?x=1`],
    ['https://trustall-old.netlify.app/messages/abc', `${SITE}/messages/abc`],
    [`${SITE}//evil.example/path`, `${SITE}//evil.example/path`],
    ['//evil.example/path', `${SITE}/path`],
    ['javascript:alert(document.cookie)', `${SITE}/`],
    ['data:text/html,<script>alert(1)</script>', `${SITE}/`],
    ['http://[bad', `${SITE}/`],
    [null, `${SITE}/`],
  ]
  for (const [url, expected] of cases) {
    const worker = loadWorker()
    await worker.tap({ url })
    assert.deepEqual(worker.opened, [expected], String(url))
    assert.equal(new URL(worker.opened[0]).origin, SITE, String(url))
  }
})

test('marketing stays where the user is and shows the full message', async () => {
  const open = fakeWindow(`${SITE}/listing/phone`, { focused: true })
  const worker = loadWorker([open])
  await worker.push({ data: pushData({ actionUrl: `${SITE}/?notification=${ID}`, inAppOnly: 'true' }) })
  await worker.tap(worker.shown[0].options.data)
  assert.deepEqual(open.calls, [['focus'], ['postMessage', { type: 'trustall:show-notification', notificationId: ID }]])
  assert.deepEqual(worker.opened, [])
})

test('marketing with the app closed opens it on the message', async () => {
  const worker = loadWorker()
  await worker.tap({ notificationId: ID, inAppOnly: 'true' })
  assert.deepEqual(worker.opened, [`/?notification=${ID}`])
})

test('an id that is not a UUID never reaches the address or the app', async () => {
  const open = fakeWindow(`${SITE}/`, { focused: true })
  const worker = loadWorker([open])
  await worker.tap({ notificationId: `${ID}&redirectTo=//evil`, inAppOnly: 'true' })
  // Treated as having no id: the home page, which this window already shows.
  assert.deepEqual(open.calls, [['focus']])
  assert.deepEqual(worker.opened, [])
})

const CHAT_TAG = `trustall-chat-${CONVERSATION}`
const OTHER_ID = '9f2b8c1e-9a4d-4e7f-b6c5-0d1e2f3a4b5c'

test('messages from one chat share one tile that counts them', async () => {
  const worker = loadWorker()
  await worker.push({ data: pushData({ tag: CHAT_TAG }) })
  await worker.push({ data: pushData({ tag: CHAT_TAG, notificationId: OTHER_ID, body: 'Hello?' }) })
  assert.equal(worker.shown.length, 2)
  const [first, second] = worker.shown
  assert.equal(first.options.tag, CHAT_TAG)
  assert.equal(first.options.body, 'Is it still available?')
  assert.equal(first.options.renotify, false)
  assert.equal(second.options.tag, CHAT_TAG, 'same tag: the second replaces the first')
  assert.equal(second.options.body, '2 new messages\nHello?')
  assert.equal(second.options.renotify, true, 'a new message buzzes again')
  assert.equal(second.options.data.count, 2)
  // The tap still opens the chat.
  assert.equal(second.options.data.url, `${SITE}/messages/${CONVERSATION}`)
})

test('the same notification twice (push and open app) counts once, but still shows', async () => {
  const worker = loadWorker()
  await worker.push({ data: pushData({ tag: CHAT_TAG }) })
  await worker.push({ data: pushData({ tag: CHAT_TAG }) })
  assert.equal(worker.shown.length, 2, 'iPhones need every push to show something')
  assert.equal(worker.shown[1].options.data.count, 1)
  assert.equal(worker.shown[1].options.body, 'Is it still available?')
  assert.equal(worker.shown[1].options.renotify, false)
})

test('only Trustall tag shapes are used; anything else falls back to the id', async () => {
  const worker = loadWorker()
  for (const tag of ['evil', 'trustall-chat-../../x', `other-${ID}`, 42]) {
    await worker.push({ data: pushData({ tag }) })
  }
  assert.deepEqual(worker.shown.map((entry) => entry.options.tag), Array(4).fill(`trustall-${ID}`))
  await worker.push({ data: pushData({ tag: CHAT_TAG.toUpperCase() }) })
  assert.equal(worker.shown.at(-1).options.tag, CHAT_TAG)
})
