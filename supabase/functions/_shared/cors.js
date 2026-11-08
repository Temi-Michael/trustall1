// Browsers may call the server functions only from Trustall's own sites.
// Add more sites (a dev or preview address, http://localhost:5173) as a
// comma-separated ALLOWED_ORIGINS function secret in Supabase.
// Requests without an Origin header (the database webhook, server-to-server
// calls) are not affected; they don't come from a web page.
// Plain JavaScript so the rules can be unit-tested with Node.

export const DEFAULT_ALLOWED_ORIGINS = ['https://trustall.online', 'https://www.trustall.online']

const BASE_ALLOWED_HEADERS = ['authorization', 'x-client-info', 'apikey', 'content-type']

function normalizeOrigin(value) {
  return String(value ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

export function parseAllowedOrigins(value) {
  const extra = String(value ?? '').split(',').map(normalizeOrigin).filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])]
}

// True when there is no Origin (not a browser page) or it is on the list.
export function isOriginAllowed(origin, allowedOrigins) {
  const normalized = normalizeOrigin(origin)
  return !normalized || allowedOrigins.includes(normalized)
}

export function buildCorsHeaders(origin, allowedOrigins, extraAllowedHeaders = []) {
  const headers = {
    'Access-Control-Allow-Headers': [...BASE_ALLOWED_HEADERS, ...extraAllowedHeaders].join(', '),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (normalizeOrigin(origin) && isOriginAllowed(origin, allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = String(origin).trim()
  }
  return headers
}

function allowedOriginsFromEnv() {
  return parseAllowedOrigins(globalThis.Deno?.env?.get('ALLOWED_ORIGINS'))
}

// CORS headers for this request: other sites get none, so browsers block them.
export function corsHeadersFor(req, extraAllowedHeaders = []) {
  return buildCorsHeaders(req.headers.get('origin'), allowedOriginsFromEnv(), extraAllowedHeaders)
}

// A 403 for browser requests from other sites, or null to carry on. CORS alone
// only stops other sites reading the reply; this stops the work being done
// (e.g. an AI call) when another site makes a visitor's browser send a request.
export function rejectOtherOrigins(req, corsHeaders) {
  if (isOriginAllowed(req.headers.get('origin'), allowedOriginsFromEnv())) return null
  return new Response(JSON.stringify({ error: 'This site is not allowed to call Trustall.' }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
