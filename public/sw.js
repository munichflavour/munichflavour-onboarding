// Service Worker – Munich Flavour Portal
// Strategie: "network-first, cache als Offline-Fallback" für App-Shell und Dokumentenliste,
// "cache-first" für einmal geöffnete Dokumente (view/download) – so bleiben Updates sofort
// live, sobald online, während zuvor gesehene Inhalte offline verfügbar bleiben.

const STATIC_CACHE = 'mf-portal-static-v1';
const RUNTIME_CACHE = 'mf-portal-runtime-v1';

const APP_SHELL = [
  '/login.html',
  '/employee.html',
  '/admin.html',
  '/manifest.json',
  '/css/style.css',
  '/js/login.js',
  '/js/employee.js',
  '/js/admin.js',
  '/assets/logo.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    fetch(request).then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cache.match(request).then(cached => cached || Promise.reject(new Error('offline, kein Cache vorhanden'))))
  );
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      });
    })
  );
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Einmal geöffnete Dokumente bleiben dauerhaft offline verfügbar
  if (/^\/api\/documents\/\d+\/(view|download)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Dokumentenliste & Ankündigungen: frisch wenn online, sonst letzter bekannter Stand
  if (url.pathname === '/api/documents' || url.pathname === '/api/announcements') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // App-Shell (Seiten, CSS, JS, Manifest, Logo): frisch wenn online, sonst aus dem Cache
  if (APP_SHELL.includes(url.pathname) || request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Alles andere (Login, Session, Admin-Aktionen, Push) → immer live, kein Caching
});

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', event => {
  let data = { title: 'Munich Flavour', body: 'Neue Benachrichtigung', url: '/admin.html' };
  try { data = event.data.json(); } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/logo.jpg',
      badge: '/assets/logo.jpg',
      data: { url: data.url },
      vibrate: [200, 100, 200],
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
