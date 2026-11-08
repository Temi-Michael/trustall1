import { isProfileRpcUnavailable } from './profileFields.js'

/**
 * Saves the setup details (name, optional photo URL) and marks setup as done,
 * recording the invite code if there is one (complete_profile_setup, 0038).
 * Used by the setup screen after Google sign-in and by the Verification page.
 * A database without 0038 has no such function and no setup flag; the name
 * and photo are still saved.
 *
 * @returns {Promise<object>} the profile fields that were changed
 */
export async function saveProfileSetup(client, { userId, fullName, avatarUrl = null, refCode = null }) {
  const updates = { full_name: fullName }
  if (avatarUrl) updates.avatar_url = avatarUrl

  const { error: profileError } = await client
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id')
    .single()
  if (profileError) throw profileError

  const { error: setupError } = await client.rpc('complete_profile_setup', { p_ref_code: refCode })
  if (setupError && !isProfileRpcUnavailable(setupError)) throw setupError

  return updates
}

/**
 * The shared profile after saveProfileSetup(), for setProfile(). Marks setup
 * as done only where the profile has the setup flag (migration 0038).
 */
export function withProfileSetupApplied(current, updates, now = new Date()) {
  if (!current) return current
  const next = { ...current, ...updates }
  if ('setup_completed_at' in current) next.setup_completed_at = now.toISOString()
  return next
}
