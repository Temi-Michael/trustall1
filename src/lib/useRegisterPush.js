import { deleteToken } from "firebase/messaging";
import { messaging, getToken } from "./firebaseConfig";
import { VAPID_KEY } from "./firebaseConfig";
import { supabase } from "./supabaseClient";

let tokenRefreshInterval = null;

async function getAppServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return null

  let registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js?v=5', { scope: '/' })
  }

  if (!registration.active) {
    const readyRegistration = await navigator.serviceWorker.ready
    if (readyRegistration.scope === registration.scope) registration = readyRegistration
  }

  if (!registration.active?.scriptURL.includes('/sw.js')) {
    console.warn('Trustall app service worker is not active; push registration skipped')
    return null
  }

  return registration
}

/**
 * Register push token and set up token refresh
 * Token should be refreshed every 24 hours as per Firebase recommendations
 */
export async function registerPushToken(userId) {
  try {
    if (!messaging || typeof Notification === "undefined") {
      return;
    }

    // Check if service workers are supported
    if (!("serviceWorker" in navigator)) {
      console.log("Service Workers not supported");
      return;
    }

    // Check if notifications are already denied
    if (Notification.permission === "denied") {
      console.log("Notification permission denied by user");
      return;
    }

    // Request permission only if not already granted
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      console.log("Notification permission not granted:", permission);
      return;
    }

    const registration = await getAppServiceWorkerRegistration()
    if (!registration) return

    // Get and store token
    await retrieveAndStoreToken(userId, registration);

    // Set up token refresh every 24 hours (Firebase tokens need refresh)
    setupTokenRefresh(userId, registration);

  } catch (err) {
    console.error("Push registration failed (non-blocking):", err);
    // Fail silently -- do not break the rest of the app if push setup fails
  }
}

/**
 * Retrieve FCM token and store in Supabase
 */
async function retrieveAndStoreToken(userId, registration) {
  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn("FCM token could not be retrieved");
      return false;
    }

    console.log("FCM token retrieved successfully");

    // Store token in database
    const { error } = await supabase.from("device_tokens").upsert(
      {
        user_id: userId,
        fcm_token: token,
        device_info: navigator.userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "fcm_token" }
    );

    if (error) {
      console.error("Failed to store FCM token:", error);
      return false;
    }

    console.log("FCM token stored successfully");
    return true;
  } catch (err) {
    console.error("Failed to retrieve/store token:", err);
    return false;
  }
}

/**
 * Refresh token every 24 hours as recommended by Firebase
 */
function setupTokenRefresh(userId, registration) {
  // Clear existing interval if any
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }

  // Refresh token every 24 hours
  tokenRefreshInterval = setInterval(async () => {
    try {
      console.log("Refreshing FCM token...");
      await retrieveAndStoreToken(userId, registration);
    } catch (err) {
      console.error("Token refresh failed:", err);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours
}

/**
 * Clean up when user logs out
 */
export async function unregisterPushToken(userId) {
  try {
    // Clear refresh interval
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
    }

    // Clear the app badge when the user logs out.
    if ("clearAppBadge" in navigator) {
      navigator.clearAppBadge().catch(() => {});
    }

    // Cancel this device's push token so the signed-out account stops reaching
    // it. This runs after sign-out, so the device_tokens row can't be deleted
    // here; send-push-notification removes tokens Firebase reports as invalid.
    // The app service worker stays registered: it also serves the offline page.
    if (messaging) {
      await deleteToken(messaging).catch((err) => console.warn("Could not cancel push token:", err));
    }
  } catch (err) {
    console.error("Failed to unregister push token:", err);
  }
}

