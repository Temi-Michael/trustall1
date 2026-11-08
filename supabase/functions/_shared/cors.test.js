import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCorsHeaders, DEFAULT_ALLOWED_ORIGINS, isOriginAllowed, parseAllowedOrigins, rejectOtherOrigins } from './cors.js'

const allowed = parseAllowedOrigins('https://dev.trustall.online, http://localhost:5173/ ,')

test('Trustall sites are always allowed; extra sites come from the setting', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), DEFAULT_ALLOWED_ORIGINS)
  assert.deepEqual(allowed, [...DEFAULT_ALLOWED_ORIGINS, 'https://dev.trustall.online', 'http://localhost:5173'])
})

test('allowed sites get their own origin back', () => {
  const headers = buildCorsHeaders('https://www.trustall.online', allowed)
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://www.trustall.online')
  assert.equal(headers.Vary, 'Origin')
  assert.equal(buildCorsHeaders('http://localhost:5173', allowed)['Access-Control-Allow-Origin'], 'http://localhost:5173')
})

test('other sites get no allow-origin header, so browsers block them', () => {
  for (const origin of ['https://evil.example', 'https://trustall.online.evil.example', 'http://www.trustall.online', 'null']) {
    assert.equal(buildCorsHeaders(origin, allowed)['Access-Control-Allow-Origin'], undefined, origin)
    assert.equal(isOriginAllowed(origin, allowed), false, origin)
  }
})

test('requests without an Origin (webhooks, servers) are not affected', () => {
  assert.equal(isOriginAllowed(null, allowed), true)
  assert.equal(buildCorsHeaders(null, allowed)['Access-Control-Allow-Origin'], undefined)
})

test('extra allowed headers are added', () => {
  assert.match(buildCorsHeaders('https://www.trustall.online', allowed, ['x-push-secret'])['Access-Control-Allow-Headers'], /x-push-secret$/)
})

test('requests from other sites are refused with 403', async () => {
  const fromEvil = new Request('https://fn.example/x', { method: 'POST', headers: { origin: 'https://evil.example' } })
  const response = rejectOtherOrigins(fromEvil, {})
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'This site is not allowed to call Trustall.' })
  assert.equal(rejectOtherOrigins(new Request('https://fn.example/x', { headers: { origin: 'https://www.trustall.online' } }), {}), null)
  assert.equal(rejectOtherOrigins(new Request('https://fn.example/x'), {}), null)
})
