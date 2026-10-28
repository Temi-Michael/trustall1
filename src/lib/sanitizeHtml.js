import DOMPurify from 'dompurify'

// Blog posts are stored as HTML. Strip scripts, event handlers (onerror=...)
// and javascript: links before rendering, so stored HTML can't run code in a
// visitor's browser even if an admin account is misused.
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ''), { USE_PROFILES: { html: true } })
}
