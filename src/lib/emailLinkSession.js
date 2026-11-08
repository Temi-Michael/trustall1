import { supabase } from './supabaseClient.js'
import { readEmailLinkParams } from './authFlow.js'

let pending = null

/**
 * Signs the user in from a link in a Supabase email (confirm sign-up, reset
 * password, invite, change email), on whatever page it opens. Runs once per
 * page load; every caller gets the same promise, so the session source
 * (useProfile.js) and the reset-password page can both wait for it.
 *
 * Resolves to { type, error }: type is the link's type (e.g. 'recovery') or
 * null when the address held no email link. Never rejects.
 */
export function completeEmailLinkSignIn() {
  if (!pending) pending = signInFromEmailLink()
  return pending
}

async function signInFromEmailLink() {
  if (typeof window === 'undefined') return { type: null, error: null }

  const link = readEmailLinkParams(window.location.href)
  if (!link) return { type: null, error: null }

  // The secrets work once; take them out of the address bar and history first.
  window.history.replaceState(window.history.state, '', link.cleanUrl)

  try {
    const { error } = link.kind === 'token_hash'
      // Emits PASSWORD_RECOVERY for reset links, SIGNED_IN otherwise.
      ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
      // Emails sent before the PKCE switch. Temporary: once those links have
      // expired (24 hours by default), this branch and the 'session_tokens'
      // case in readEmailLinkParams can be removed.
      : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })

    if (error) console.warn('Email link sign-in failed:', error)
    return { type: link.type, error: error || null }
  } catch (error) {
    console.warn('Email link sign-in failed:', error)
    return { type: link.type, error }
  }
}
