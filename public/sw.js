// v7: new caching rules; the version bump clears caches saved by older rules.
const CACHE_NAME = 'trustall-v7';
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

firebase.messaging().onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const actionUrl = data.actionUrl || data.click_action || '/';
  const badgeCount = Number.parseInt(data.unreadCount || '1', 10);
  const options = {
    body: body || 'New notification',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: data.tag || 'trustall-notification',
    data: { url: actionUrl },
    requireInteraction: data.priority === 'high',
  };

  self.registration.showNotification(title || 'Trustall', options);
  if (Number.isFinite(badgeCount) && typeof self.registration.setAppBadge === 'function') {
    self.registration.setAppBadge(badgeCount).catch(() => {});
  }
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => client.url.startsWith(self.location.origin));
      if (existing) return existing.navigate(url).then((client) => client?.focus());
      return self.clients.openWindow(url);
    })
  );
});
