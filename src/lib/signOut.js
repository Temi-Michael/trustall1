import { supabase } from './supabaseClient.js'
import { removePushTokenBeforeSignOut } from './useRegisterPush.js'

// The signed-in user's id, saved by GlobalSetup (App.jsx). When a session ends
// without signOutThisDevice (expiry, another tab, another device), GlobalSetup
// finds this key and runs the push cleanup that sign-out would have done.
export const LAST_USER_ID_STORAGE_KEY = 'lastUserId'

// Cleanup is best effort: a slow or offline network must not stop sign-out.
const CLEANUP_TIMEOUT_MS = 4000

function settleWithin(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function forgetLastUserId() {
  try {
    window.localStorage.removeItem(LAST_USER_ID_STORAGE_KEY)
  } catch {
    // Storage unavailable: GlobalSetup's fallback cleanup simply runs again.
  }
}

/**
 * Signs the user out of this browser only. Other devices stay signed in; that
 * is a separate, explicit action (signOutOtherDevices).
 *
 * Order matters:
 * 1. Leave the current page first. Pages that need a session redirect to the
 *    log-in page the moment it disappears, which made sign-out look like it
 *    landed on "Log in". Pass navigate: null to stay put (e.g. /admin, which
 *    shows its own sign-in form).
 * 2. Remove this device's push token while the session can still do it.
 * 3. End the session.
 *
 * @param {{ navigate?: Function | null, redirectTo?: string }} [options]
 * @returns {Promise<{ error: Error | null }>} Supabase clears the local session
 *   even when it returns an error, so the user is signed out either way.
 */
export async function signOutThisDevice({ navigate = null, redirectTo = '/' } = {}) {
  if (navigate) navigate(redirectTo, { replace: true })

  await settleWithin(removePushTokenBeforeSignOut(), CLEANUP_TIMEOUT_MS)
  forgetLastUserId()

  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) console.warn('Sign-out reported an error; the local session was still cleared:', error)
  return { error }
}

/**
 * Ends every other session of this account and keeps this one. Other devices
 * notice when their access token next renews (within the JWT expiry set in
 * Supabase, one hour by default), then sign out on their own.
 *
 * @returns {Promise<{ error: Error | null }>}
 */
export async function signOutOtherDevices() {
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  return { error }
}
