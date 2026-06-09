// Service Worker – Munich Flavour Onboarding
// No static caching: updates are always live immediately.
// Only handles Web Push Notifications.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  // Remove any old caches from previous versions
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// No fetch handler → all requests go straight to the network

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
