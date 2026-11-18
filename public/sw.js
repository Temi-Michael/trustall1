// v8: pushes are shown once and a tap opens the same page as the bell.
// The version bump clears caches saved by older rules.
const CACHE_NAME = 'trustall-v8';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same name in src/lib/notifications.js: the bell listens for it.
const SHOW_NOTIFICATION_MESSAGE = 'trustall:show-notification';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.svg', '/icon-512.svg', '/favicon.ico', '/robots.txt'];

// Keep in step with the firebase version in package.json.
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDX-XgxZm4RwVNNdZMYwZK-wN5jPgA7u2k',
  authDomain: 'trustall-technology-limited.firebaseapp.com',
  projectId: 'trustall-technology-limited',
  storageBucket: 'trustall-technology-limited.firebasestorage.app',
  messagingSenderId: '155302285805',
  appId: '1:155302285805:web:c6ec674dd11ce5c32b17e4',
});

// What a tap needs, from a push (all strings) or from the open app
// (src/lib/notifications.js), in one shape.
function readTapData(source) {
  const id = typeof source?.notificationId === 'string' && UUID_PATTERN.test(source.notificationId)
    ? source.notificationId
    : null;
  const url = typeof source?.url === 'string' && source.url
    ? source.url
    : (typeof source?.actionUrl === 'string' && source.actionUrl ? source.actionUrl : null);
  return { url, notificationId: id, inAppOnly: source?.inAppOnly === true || source?.inAppOnly === 'true' };
}

// Only pages of this site open from a notification. Another origin's address
// (the old Netlify address, the bare domain) opens the same path here;
// "javascript:" and anything unreadable open the home page.
function toSiteUrl(value) {
  const home = new URL('/', self.location.origin).href;
  if (!value) return home;
  let parsed;
  try {
    parsed = new URL(value, self.location.origin);
  } catch {
    return home;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return home;
  // Set the parts one by one: building from a string would read a path such
  // as "//evil.example" as another site.
  const url = new URL(self.location.origin);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  url.hash = parsed.hash;
  return url.origin === self.location.origin ? url.href : home;
}

// Pushes are data-only (send-push-notification), so this shows each one once.
// The returned promise keeps the worker alive until it is on screen, which
// iPhones require of every push.
firebase.messaging().onBackgroundMessage((payload) => {
  // Sent before the function went data-only: Firebase already showed it, and
  // showing it here as well was the duplicate.
  if (payload.notification) return undefined;

  const data = payload.data || {};
  const tap = readTapData(data);
  const unread = Number.parseInt(data.unreadCount, 10);
  if (Number.isInteger(unread) && unread >= 0 && typeof self.registration.setAppBadge === 'function') {
    self.registration.setAppBadge(unread).catch(() => {});
  }

  return self.registration.showNotification(String(data.title || 'Trustall').slice(0, 120), {
    body: String(data.body || 'You have a new notification').slice(0, 300),
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    // The open app uses the same tag for the same notification, so a push and
    // the app's live update replace each other instead of stacking.
    tag: tap.notificationId ? `trustall-${tap.notificationId}` : 'trustall-notification',
    data: tap,
  });
});

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Other sites (Supabase, Paystack, Firebase, fonts) keep their own caching rules.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only a real page becomes the offline copy, never an error page.
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Vite fingerprints build files (/assets/name-hash.js), so a cached copy is never stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  // Everything else on this site: fresh from the network, cached copy only when offline.
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || Response.error())));
});

async function openFromNotification({ url, notificationId, inAppOnly }) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const siteWindows = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  const existing = siteWindows.find((client) => client.focused)
    || siteWindows.find((client) => client.visibilityState === 'visible')
    || siteWindows[0];

  // Marketing: no page of its own. Stay where the user is and show the full
  // message in the bell, or open the app on it.
  if (inAppOnly && notificationId) {
    if (existing) {
      await existing.focus().catch(() => {});
      existing.postMessage({ type: SHOW_NOTIFICATION_MESSAGE, notificationId });
      return undefined;
    }
    return self.clients.openWindow(`/?notification=${notificationId}`);
  }

  const target = toSiteUrl(url);
  if (existing) {
    // Focus first: browsers allow it only right after the tap.
    await existing.focus().catch(() => {});
    if (existing.url === target) return undefined;
    try {
      await existing.navigate(target);
      return undefined;
    } catch {
      // navigate() refuses a window this worker doesn't control (after a
      // hard reload, say). A new window still lands on the right page.
    }
  }
  return self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(readTapData(event.notification.data)));
});
