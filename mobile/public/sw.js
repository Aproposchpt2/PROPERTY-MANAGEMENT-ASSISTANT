/* PMA web app service worker: manager push alerts only. No offline caching, so the app always
   loads the latest deploy. Scope: /app/. */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = {}; }
  const data = msg.data || {};
  const title = typeof msg.title === 'string' ? msg.title : 'Property Management Assistant';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof msg.body === 'string' ? msg.body : '',
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    tag: data.requestId ? `case-${data.requestId}` : undefined,
    requireInteraction: data.kind === 'emergency',
    data,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.requestId;
  const target = typeof id === 'string' && UUID_RE.test(id) ? `/app/manager/${id}` : '/app/manager';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith('/app')) {
        await w.focus();
        return w.navigate(target);
      }
    }
    return self.clients.openWindow(target);
  })());
});
