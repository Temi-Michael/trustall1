import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScreeningReply, SCREENING_PROMPT } from './mediaScreening.js'

test('reads a clean verdict', () => {
  assert.deepEqual(parseScreeningReply('{"contains_contact_details": false, "reason": "product photo"}'), {
    valid: true, containsContactDetails: false, reason: 'product photo',
  })
})

test('reads a verdict wrapped in a code fence or extra words', () => {
  const reply = 'Here you go:\n```json\n{"contains_contact_details": true, "reason": "phone number on card"}\n```'
  assert.deepEqual(parseScreeningReply(reply), { valid: true, containsContactDetails: true, reason: 'phone number on card' })
})

test('anything unclear is invalid, so the file is not sent', () => {
  for (const reply of ['', null, 'Yes, it has a number.', '{"contains_contact_details": "yes"}', '{broken json}']) {
    assert.deepEqual(parseScreeningReply(reply), { valid: false }, `expected ${JSON.stringify(reply)} to be invalid`)
  }
})

test('long reasons are trimmed', () => {
  const reply = JSON.stringify({ contains_contact_details: true, reason: 'x'.repeat(500) })
  assert.equal(parseScreeningReply(reply).reason.length, 200)
})

test('the prompt asks for contact details but excludes product identifiers', () => {
  for (const phrase of ['phone or WhatsApp numbers', 'bank account numbers', 'IMEI', 'JSON only']) {
    assert.ok(SCREENING_PROMPT.includes(phrase), `prompt should mention ${phrase}`)
  }
})
