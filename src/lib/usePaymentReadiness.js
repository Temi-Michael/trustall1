import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { useSession } from './useProfile.js'
import { fetchPaymentReadiness } from './paymentReadiness.js'

// Several components can ask at once (every offer card in a chat, a listing
// page); they share one request, and the answer is reused for a minute.
const READINESS_CACHE_MS = 60_000
let cache = { userId: null, value: null, loadedAt: 0, promise: null }

function loadReadiness(userId, { force = false } = {}) {
  const fresh = cache.userId === userId && cache.value && Date.now() - cache.loadedAt < READINESS_CACHE_MS
  if (!force && fresh) return Promise.resolve(cache.value)
  if (cache.userId === userId && cache.promise) return cache.promise

  const promise = fetchPaymentReadiness(supabase)
    .then((value) => {
      if (cache.promise === promise) cache = { userId, value, loadedAt: Date.now(), promise: null }
      return value
    })
    .catch((error) => {
      if (cache.promise === promise) cache = { userId: null, value: null, loadedAt: 0, promise: null }
      throw error
    })
  cache = { ...cache, userId, promise }
  return promise
}

/**
 * Whether the signed-in user may start a payment (migration 0040), with the
 * requirements still missing. The database enforces the rule; this is for
 * showing the checklist early, so the UI never blocks on its own: while
 * loading, or if the check fails, readiness is null and actions stay enabled.
 *
 * @param {{ enabled?: boolean }} [options] pass enabled: false to skip the request
 * @returns {{ readiness: { ready, missing, checked } | null, loading: boolean, refresh: () => Promise<void> }}
 */
export function usePaymentReadiness({ enabled = true } = {}) {
  const { session } = useSession()
  const userId = session?.user?.id || null
  const [state, setState] = useState(() => ({
    userId: cache.userId,
    readiness: cache.value,
    loading: false,
  }))

  useEffect(() => {
    if (!enabled || !userId) return undefined
    let active = true
    setState((current) => ({ ...current, loading: true }))
    loadReadiness(userId)
      .then((readiness) => { if (active) setState({ userId, readiness, loading: false }) })
      .catch((error) => {
        console.warn('Payment readiness check failed:', error)
        if (active) setState({ userId, readiness: null, loading: false })
      })
    return () => { active = false }
  }, [enabled, userId])

  // After the user fixes something (adds a phone, finishes setup).
  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const readiness = await loadReadiness(userId, { force: true })
      setState({ userId, readiness, loading: false })
    } catch (error) {
      console.warn('Payment readiness check failed:', error)
    }
  }, [userId])

  const belongsToUser = state.userId === userId
  return {
    readiness: belongsToUser ? state.readiness : null,
    loading: state.loading,
    refresh,
  }
}
