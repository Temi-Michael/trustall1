import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckedFiles, sendMessageWithFiles, MAX_FILES_PER_MESSAGE } from './chatMedia.js'

const CONVO = '11111111-1111-4111-8111-111111111111'
const OTHER_CONVO = '55555555-5555-4555-8555-555555555555'
const ME = '22222222-2222-4222-8222-222222222222'
const MESSAGE = '44444444-4444-4444-8444-444444444444'

const file = (name) => ({ name })

// A stand-in for the Supabase client. Each step can be scripted; calls are
// recorded in order.
function fakeClient({ upload, check, send } = {}) {
  const calls = []
  return {
    calls,
    storage: {
      from: () => ({
        upload: async (path, theFile) => {
          calls.push({ step: 'upload', path, name: theFile.name })
          return upload ? upload(path, theFile) : { error: null }
        },
      }),
    },
    functions: {
      invoke: async (_name, { body }) => {
        calls.push({ step: body.action, body })
        if (body.action === 'check') {
          return check ? check(body) : { data: { status: 'clean', path: body.path.replace('/pending/', '/checked-') } }
        }
        return send ? send(body) : { data: { sent: true, message: { id: body.message_id }, attachments: body.paths.map((p) => ({ file_url: p })) } }
      },
    },
  }
}

function options(client, overrides = {}) {
  let clock = 1700000000000
  return {
    client,
    conversationId: CONVO,
    userId: ME,
    messageId: MESSAGE,
    text: 'Here you go',
    files: [file('a.jpg'), file('b.jpg')],
    checked: createCheckedFiles(),
    now: () => clock++,
    ...overrides,
  }
}

test('uploads and checks every file before the message is saved, in one send', async () => {
  const client = fakeClient()
  const result = await sendMessageWithFiles(options(client))
  assert.equal(result.status, 'sent')
  assert.deepEqual(client.calls.map((call) => call.step), ['upload', 'check', 'upload', 'check', 'send'])
  const send = client.calls.at(-1).body
  assert.equal(send.message_id, MESSAGE)
  assert.equal(send.body, 'Here you go')
  assert.equal(send.paths.length, 2)
  assert.ok(client.calls[0].path.startsWith(`${CONVO}/pending/${ME}/`))
})

test('leaving or losing the connection mid-upload sends nothing, and keeps finished checks', async () => {
  let uploads = 0
  const client = fakeClient({ upload: () => (++uploads === 2 ? { error: new Error('network') } : { error: null }) })
  const opts = options(client)
  const result = await sendMessageWithFiles(opts)
  assert.equal(result.status, 'not_sent')
  assert.equal(result.reason, 'failed')
  assert.ok(!client.calls.some((call) => call.step === 'send'), 'the message must not be saved')

  // Sending again: the first file isn't uploaded or checked a second time,
  // and the message ID is the same, so a lost reply can't make two copies.
  const retry = fakeClient()
  const again = await sendMessageWithFiles({ ...opts, client: retry })
  assert.equal(again.status, 'sent')
  assert.deepEqual(retry.calls.map((call) => call.step), ['upload', 'check', 'send'])
  assert.equal(retry.calls[0].name, 'b.jpg')
  assert.equal(retry.calls.at(-1).body.message_id, MESSAGE)
})

test('a photo refused for contact details is dropped; the text and other photos still go', async () => {
  const blocked = file('number.jpg')
  const client = fakeClient({
    check: (body) => (body.path.includes('number')
      ? { data: { status: 'blocked', message: 'This photo wasn’t sent' } }
      : { data: { status: 'clean', path: `checked/${CONVO}/${ME}/image/ok.jpg` } }),
  })
  const result = await sendMessageWithFiles(options(client, { files: [blocked, file('ok.jpg')] }))
  assert.equal(result.status, 'sent')
  assert.deepEqual(result.blockedFiles, [blocked])
  assert.deepEqual(result.notices, ['This photo wasn’t sent'])
  assert.equal(client.calls.at(-1).body.paths.length, 1)
})

test('nothing is saved when every photo is refused and there is no text', async () => {
  const client = fakeClient({ check: () => ({ data: { status: 'blocked', message: 'Refused' } }) })
  const result = await sendMessageWithFiles(options(client, { text: '', files: [file('a.jpg')] }))
  assert.equal(result.status, 'not_sent')
  assert.equal(result.reason, 'blocked')
  assert.equal(result.notice, 'Refused')
  assert.ok(!client.calls.some((call) => call.step === 'send'))
})

test('a photo that couldn’t be checked stops the send; nothing is saved', async () => {
  const client = fakeClient({ check: () => ({ data: { status: 'failed', message: 'Try again later' } }) })
  const result = await sendMessageWithFiles(options(client))
  assert.equal(result.status, 'not_sent')
  assert.equal(result.reason, 'failed')
  assert.equal(result.notice, 'Try again later')
  assert.deepEqual(result.blockedFiles, [])
  assert.ok(!client.calls.some((call) => call.step === 'send'))
})

test('text with contact details comes back to edit; checked photos are reused', async () => {
  const opts = options(fakeClient({ send: () => ({ data: { sent: false, code: 'TC001', message: 'No phone numbers' } }) }))
  const result = await sendMessageWithFiles(opts)
  assert.equal(result.status, 'not_sent')
  assert.equal(result.reason, 'contact_details')
  assert.equal(result.notice, 'No phone numbers')

  const retry = fakeClient()
  const again = await sendMessageWithFiles({ ...opts, client: retry, text: 'Fixed text' })
  assert.equal(again.status, 'sent')
  assert.deepEqual(retry.calls.map((call) => call.step), ['send'])
})

test('a checked file the server can no longer find is uploaded again next time', async () => {
  const opts = options(fakeClient({
    send: (body) => ({ data: { sent: false, message: 'Not sent', missing_paths: [body.paths[1]] } }),
  }))
  const result = await sendMessageWithFiles(opts)
  assert.equal(result.reason, 'failed')
  assert.equal(opts.checked.size, 1)

  const retry = fakeClient()
  await sendMessageWithFiles({ ...opts, client: retry })
  assert.deepEqual(retry.calls.map((call) => call.step), ['upload', 'check', 'send'])
  assert.equal(retry.calls[0].name, 'b.jpg')
})

test('a lost reply to the send is reported as not sent (sending again is safe)', async () => {
  const client = fakeClient({ send: () => ({ data: null, error: new Error('Failed to fetch') }) })
  const result = await sendMessageWithFiles(options(client))
  assert.equal(result.status, 'not_sent')
  assert.equal(result.reason, 'failed')
})

test('checks from another conversation are never reused', async () => {
  const opts = options(fakeClient())
  opts.checked.set(opts.files[0], OTHER_CONVO, `checked/${OTHER_CONVO}/${ME}/image/a.jpg`)
  const client = fakeClient()
  await sendMessageWithFiles({ ...opts, client })
  assert.deepEqual(client.calls.map((call) => call.step), ['upload', 'check', 'upload', 'check', 'send'])
})

test('too many files are refused before anything is uploaded', async () => {
  const client = fakeClient()
  const files = Array.from({ length: MAX_FILES_PER_MESSAGE + 1 }, (_, i) => file(`${i}.jpg`))
  const result = await sendMessageWithFiles(options(client, { files }))
  assert.equal(result.status, 'not_sent')
  assert.equal(client.calls.length, 0)
})

test('after a successful send the remembered checks are cleared', async () => {
  const opts = options(fakeClient())
  await sendMessageWithFiles(opts)
  assert.equal(opts.checked.size, 0)
})

test('a sent message says where each of its files is stored, so the sender can keep showing its own copy', async () => {
  const files = [file('a.jpg'), file('b.jpg')]
  const result = await sendMessageWithFiles(options(fakeClient(), { files }))
  assert.equal(result.status, 'sent')
  assert.equal(result.sentFiles.length, 2)
  assert.equal(result.sentFiles[0].file, files[0])
  assert.equal(result.sentFiles[1].file, files[1])
  for (const { fileUrl } of result.sentFiles) {
    assert.match(fileUrl, new RegExp(`^${CONVO}/[^/]+$`))
  }
  assert.notEqual(result.sentFiles[0].fileUrl, result.sentFiles[1].fileUrl)
})

test('a refused photo is not among the sent files', async () => {
  const files = [file('a.jpg'), file('phone.jpg')]
  const client = fakeClient({
    check: (body) => body.path.includes('phone')
      ? { data: { status: 'blocked', message: 'Contact details' } }
      : { data: { status: 'clean', path: body.path.replace('/pending/', '/checked-') } },
  })
  const result = await sendMessageWithFiles(options(client, { files }))
  assert.equal(result.status, 'sent')
  assert.deepEqual(result.sentFiles.map((entry) => entry.file), [files[0]])
})

test('photo links are reused until 5 minutes before they stop working', async () => {
  const { createSignedUrlCache } = await import('./chatMedia.js')
  let clock = 0
  const cache = createSignedUrlCache({ lifetimeSeconds: 3600, now: () => clock })
  assert.equal(cache.get('c/a.jpg'), null)
  cache.set('c/a.jpg', 'https://example.test/a?token=1')
  clock = 54 * 60 * 1000
  assert.equal(cache.get('c/a.jpg'), 'https://example.test/a?token=1')
  clock = 55 * 60 * 1000
  assert.equal(cache.get('c/a.jpg'), null)
  // Once dropped, it stays dropped until a new link is stored.
  clock = 0
  assert.equal(cache.get('c/a.jpg'), null)
})
