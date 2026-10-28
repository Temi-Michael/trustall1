export const HIDDEN_BALANCE = '₦ ••••••'

// Formats a naira amount, or a fixed mask when balances are hidden so the
// length of the real number isn't revealed either.
export function formatBalance(amount, hidden) {
  if (hidden) return HIDDEN_BALANCE
  const value = Number(amount)
  return `₦${(Number.isFinite(value) ? value : 0).toLocaleString()}`
}
