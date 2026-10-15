/* OpsHub service worker: receives Web Push messages and shows system notifications.
 * It deliberately does NOT cache pages or API responses, so users never see stale data. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'OpsHub';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined, // same tag replaces instead of stacking duplicates
    data: { url: data.url || '/messages' },
  };

  event.waitUntil(
    (async () => {
      // If the app is open and in front, the in-app toast already shows it.
      // Apple platforms require every push to display a notification, so they always show.
      const isApple = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent);
      if (!isApple) {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
      }
      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever open pages of this app, even if a payload carried an external URL.
  let target = new URL('/messages', self.location.origin);
  try {
    const wanted = new URL((event.notification.data && event.notification.data.url) || '/messages', self.location.origin);
    if (wanted.origin === self.location.origin) target = wanted;
  } catch (e) {
    /* keep the default */
  }
  target = target.href;

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          if ('navigate' in w) {
            try {
              await w.navigate(target);
            } catch (e) {
              /* focus is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
