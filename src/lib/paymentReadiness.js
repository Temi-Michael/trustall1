import { isProfileRpcUnavailable } from './profileFields.js'

// What an account needs before it can start a payment. The database decides
// (private.payment_blockers, migration 0040) and returns these codes; this
// file only describes them, so the rules live in one place.
export const PAYMENT_REQUIREMENTS = [
  {
    code: 'email_unconfirmed',
    label: 'Confirm your email address',
    help: 'Open the confirmation email we sent you. Google accounts are confirmed automatically.',
  },
  {
    code: 'profile_setup',
    label: 'Finish your profile',
    help: 'Add the name buyers and sellers will see.',
  },
  {
    code: 'phone_missing',
    label: 'Add a phone number',
    help: 'Kept private. Trustall uses it to reach you about orders and disputes.',
  },
  {
    code: 'account_suspended',
    label: 'Account in good standing',
    help: 'This account is suspended after repeated warnings. Contact support to review it.',
  },
]

// Shown when the check isn't available (migration 0040 not applied yet): the
// app behaves as it did before, and the server has no rule to enforce either.
const UNCHECKED = Object.freeze({ ready: true, missing: [], checked: false })

/** Normalises the RPC result to { ready, missing, checked }. */
export function normalizePaymentReadiness(data) {
  const missing = Array.isArray(data?.missing) ? data.missing.filter((code) => typeof code === 'string') : []
  return { ready: data?.ready === true && missing.length === 0, missing, checked: true }
}

/** True when the server refused to start a payment because the account isn't verified. */
export function isPaymentVerificationError(error) {
  return error?.hint === 'payment_verification_required'
}

/**
 * The signed-in user's readiness, from get_my_payment_readiness().
 * Throws on other errors so callers can decide; never blocks on its own.
 */
export async function fetchPaymentReadiness(client) {
  const { data, error } = await client.rpc('get_my_payment_readiness')
  if (error) {
    if (isProfileRpcUnavailable(error)) return UNCHECKED
    throw error
  }
  return normalizePaymentReadiness(data)
}

/** The short label for a requirement code, e.g. for a checklist in the checkout. */
export function describePaymentRequirement(code) {
  return PAYMENT_REQUIREMENTS.find((requirement) => requirement.code === code)?.label || code
}

/** Link to the Verification page that brings the user back to `returnPath` afterwards. */
export function verificationPageLink(returnPath) {
  return returnPath ? `/account/verification?redirectTo=${encodeURIComponent(returnPath)}` : '/account/verification'
}
