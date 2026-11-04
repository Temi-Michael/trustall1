// Checks chat photos and videos for ways to contact or pay outside Trustall.
// Plain JavaScript so the parsing can be unit-tested with Node; the
// screen-chat-image function sends SCREENING_PROMPT with the file to an AI
// vision model and reads its answer with parseScreeningReply.

export const BLOCKED_MESSAGE =
  "This photo wasn't sent: it looks like it shows contact or bank details. For your safety, keep payments and contact inside Trustall."

export const UNAVAILABLE_MESSAGE =
  "We couldn't check this photo right now, so it wasn't sent. Please try again in a moment."

export const SCREENING_PROMPT = `You review photos and videos sent in the chat of a Nigerian online marketplace.
Buyers and sellers must not share ways to contact or pay each other outside the marketplace.

Report contact or payment details if the image shows any of these, including handwritten, partly covered or
screenshotted ones: phone or WhatsApp numbers, email addresses, website links, social media handles or usernames,
QR codes, bank account numbers, an account name together with a bank name, BVN, or payment details.

Do not report: prices, product names, brand logos, sizes, colours, dates, model numbers, serial numbers, IMEI
numbers, or barcodes printed on product packaging.

Reply with JSON only, in exactly this shape:
{"contains_contact_details": true or false, "reason": "a few words"}`

// Reads the model's answer. Anything that isn't a clear yes/no is reported as
// invalid, and the caller treats that as "couldn't check" (the file isn't sent).
export function parseScreeningReply(text) {
  const raw = String(text ?? '').replace(/```(?:json)?/gi, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return { valid: false }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (typeof parsed.contains_contact_details !== 'boolean') return { valid: false }
    return {
      valid: true,
      containsContactDetails: parsed.contains_contact_details,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : null,
    }
  } catch {
    return { valid: false }
  }
}
