// Helpers for the payout account form (Seller workspace). Pure functions, so
// they can be tested without a browser or Supabase.

// Nigerian (NUBAN) account numbers are exactly 10 digits. Typing or pasting
// "012 345-6789" keeps the digits only, up to 10.
export function normalizeAccountNumber(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 10)
}

export function isCompleteAccountNumber(value) {
  return /^\d{10}$/.test(String(value ?? ''))
}

// Words that say what kind of business it is rather than whose it is, so
// "ADA FASHION VENTURES" vs "Ada Okafor" still counts as related.
const GENERIC_NAME_WORDS = new Set([
  'ltd', 'limited', 'plc', 'enterprise', 'enterprises', 'ventures', 'venture', 'global', 'services',
  'service', 'nigeria', 'nig', 'company', 'co', 'and', 'the', 'store', 'stores', 'shop', 'trading',
  'business', 'concept', 'concepts', 'international', 'intl', 'mrs', 'miss',
])

function nameWords(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word))
}

/**
 * Whether the bank's account name shares a real word with any of the seller's
 * names (full name, business name). Used to warn, never to block: people often
 * bank under a legal name that differs from their display name. With no names
 * to compare against, there's nothing to warn about, so it returns true.
 */
export function namesLookRelated(accountName, ...profileNames) {
  const accountWords = new Set(nameWords(accountName))
  const otherWords = profileNames.flatMap(nameWords)
  if (!accountWords.size || !otherWords.length) return true
  return otherWords.some((word) => accountWords.has(word))
}
