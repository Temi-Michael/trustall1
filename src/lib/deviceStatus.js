import { useSyncExternalStore } from 'react'
import { supabase } from './supabaseClient.js'
import { isProfileRpcUnavailable } from './profileFields.js'
import { describeDevice, getDeviceId } from './deviceSession.js'

// This device's standing (migration 0042), shared by the inactivity guard,
// the main-device prompt and the Sign-in & security page.
//   checked      false until the server answered (or without migration 0042)
//   isMain       this device is the user's main device (3-hour limit)
//   hasMain      the user has a main device somewhere
//   canSetMain   signed in on this device within the last 10 minutes
const UNKNOWN = Object.freeze({ checked: false, isMain: false, hasMain: false, canSetMain: false, available: true })

let status = UNKNOWN
const listeners = new Set()

function setStatus(next) {
  status = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** This device's standing; re-renders when it changes. */
export function useDeviceStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status)
}

export function currentDeviceId() {
  return getDeviceId(typeof window !== 'undefined' ? window.localStorage : null)
}

/** Forget the standing (on sign-out). */
export function resetDeviceStatus() {
  setStatus(UNKNOWN)
}

/**
 * Tells the server this device is in use and refreshes its standing.
 * Without migration 0042 it marks the feature unavailable instead of failing.
 */
export async function reportDeviceActivity() {
  const { data, error } = await supabase.rpc('register_device_activity', {
    p_device_id: currentDeviceId(),
    p_label: describeDevice(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  })
  if (error) {
    if (isProfileRpcUnavailable(error)) setStatus({ ...UNKNOWN, available: false })
    else console.warn('Could not report device activity:', error)
    return status
  }
  setStatus({
    checked: true,
    available: true,
    isMain: data?.is_main === true,
    hasMain: data?.has_main === true,
    canSetMain: data?.can_set_main === true,
  })
  return status
}

/** True when the server refused because the sign-in on this device is too old. */
export function needsRecentSignIn(error) {
  return error?.hint === 'recent_sign_in_required'
}

/** Makes this device the main one; returns { error }. */
export async function makeThisMainDevice() {
  const { error } = await supabase.rpc('set_main_device', { p_device_id: currentDeviceId() })
  if (!error) await reportDeviceActivity()
  return { error: error || null }
}

/** Removes the main-device status from whichever device has it; returns { error }. */
export async function clearMainDevice() {
  const { error } = await supabase.rpc('clear_main_device')
  if (!error) await reportDeviceActivity()
  return { error: error || null }
}
