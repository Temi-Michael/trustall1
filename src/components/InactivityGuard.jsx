import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/useProfile.js'
import { signOutThisDevice } from '../lib/signOut.js'
import {
  ACTIVITY_REPORT_INTERVAL_MS,
  MAIN_DEVICE_IDLE_MS,
  idleLimitMs,
  idleState,
  isInactivityHeld,
  readLastActivity,
  sessionSignedInAt,
  writeLastActivity,
} from '../lib/deviceSession.js'
import { reportDeviceActivity, resetDeviceStatus, useDeviceStatus } from '../lib/deviceStatus.js'

// How often the countdown is checked, and how often taps and typing are saved
// (saving on every event would be wasteful).
const CHECK_EVERY_MS = 10 * 1000
const SAVE_ACTIVITY_EVERY_MS = 10 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']

function storage() {
  return typeof window !== 'undefined' ? window.localStorage : null
}

/**
 * Signs this device out after it has been unused for its limit (migration
 * 0042): 3 hours on the user's main device, 15 minutes on any other, and
 * 15 minutes on the admin dashboard. Shows a warning a minute before.
 *
 * - Taps, clicks, typing and scrolling count as use, in any tab: the last
 *   use is shared through localStorage.
 * - The last use is kept when the browser closes, so reopening Trustall after
 *   the limit signs out straight away.
 * - The countdown pauses while a payment window is open (holdInactivity).
 * - While it's used, the device reports activity every couple of minutes, so
 *   the server can end logins that go unused even if this code never runs.
 */
export function InactivityGuard() {
  const { session } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const device = useDeviceStatus()
  const [warningMs, setWarningMs] = useState(null)
  const signingOutRef = useRef(false)
  const lastSavedRef = useRef(0)
  const usedSinceReportRef = useRef(false)

  const userId = session?.user?.id || null
  const isAdminRoute = pathname.startsWith('/admin')
  // Until the server says which device this is, use the longer limit, so
  // nobody is signed out early; the check runs again once it answers.
  const limitMs = device.checked || !device.available
    ? idleLimitMs({ isMain: device.isMain || !device.available, isAdminRoute })
    : idleLimitMs({ isMain: true, isAdminRoute })
  const signedInAt = sessionSignedInAt(session?.access_token)
  // Check every second while the warning shows (for its countdown), else every 10.
  const inWarning = warningMs !== null

  // The last use of this login: a time from an earlier login on this browser
  // doesn't count against a fresh sign-in.
  const lastUse = useCallback(() => {
    const stored = readLastActivity(storage())
    return Math.max(stored ?? 0, signedInAt ?? 0) || Date.now()
  }, [signedInAt])

  const recordUse = useCallback((force = false) => {
    usedSinceReportRef.current = true
    const now = Date.now()
    if (!force && now - lastSavedRef.current < SAVE_ACTIVITY_EVERY_MS) return
    lastSavedRef.current = now
    writeLastActivity(storage(), now)
    setWarningMs(null)
  }, [])

  const signOutForInactivity = useCallback(async () => {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setWarningMs(null)
    writeLastActivity(storage(), null)
    // The admin dashboard shows its own sign-in form; elsewhere go to log in,
    // with a note saying why, and come back here afterwards.
    if (!isAdminRoute) {
      navigate('/auth', { replace: true, state: { redirectTo: pathname, signedOutReason: 'inactive' } })
    }
    await signOutThisDevice()
  }, [isAdminRoute, navigate, pathname])

  // Signed out (here or in another tab): forget this login's countdown.
  useEffect(() => {
    if (userId) {
      signingOutRef.current = false
      return
    }
    setWarningMs(null)
    resetDeviceStatus()
  }, [userId])

  // Learn which device this is when the login starts, and report use.
  useEffect(() => {
    if (!userId) return undefined
    reportDeviceActivity()
    const onStatusChange = () => reportDeviceActivity()
    window.addEventListener('trustall:device-status-changed', onStatusChange)
    return () => window.removeEventListener('trustall:device-status-changed', onStatusChange)
  }, [userId])

  // Taps, clicks, typing and scrolling count as use.
  useEffect(() => {
    if (!userId) return undefined
    const onActivity = () => recordUse()
    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true }))
    return () => ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity))
  }, [userId, recordUse])

  // The countdown.
  useEffect(() => {
    if (!userId) return undefined
    function check() {
      if (signingOutRef.current) return
      if (isInactivityHeld()) {
        recordUse(true)
        return
      }
      const state = idleState(lastUse(), limitMs)
      if (state.status === 'expired') signOutForInactivity()
      else setWarningMs(state.status === 'warning' ? state.remainingMs : null)
    }
    check()
    const timer = window.setInterval(check, inWarning ? 1000 : CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, limitMs, lastUse, recordUse, signOutForInactivity, inWarning])

  // Tell the server about use every couple of minutes, only if there was some.
  useEffect(() => {
    if (!userId) return undefined
    const timer = window.setInterval(() => {
      if (!usedSinceReportRef.current || document.visibilityState !== 'visible') return
      usedSinceReportRef.current = false
      reportDeviceActivity()
    }, ACTIVITY_REPORT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [userId])

  if (!userId || warningMs === null) return null

  const seconds = Math.max(1, Math.ceil(warningMs / 1000))
  const limitText = limitMs >= MAIN_DEVICE_IDLE_MS ? '3 hours' : '15 minutes'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 px-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="inactivity-title" aria-describedby="inactivity-text" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <p id="inactivity-title" className="font-display text-lg font-bold text-ink">Still there?</p>
        <p id="inactivity-text" className="mt-2 text-sm leading-6 text-muted">
          For your security, you'll be signed out in <span className="font-semibold text-ink">{seconds} seconds</span> because this device hasn't been used for {limitText}.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => recordUse(true)}
          className="mt-5 w-full rounded-full bg-seal py-2.5 text-sm font-semibold text-white transition hover:bg-seal-deep"
        >
          Stay signed in
        </button>
      </div>
    </div>
  )
}

