/* global self */
/**
 * Kill switch for the service worker of the previous site.
 *
 * /service_worker.js was registered for a short while on 31.8.–1.9.2025. A
 * browser that installed it keeps it until the file at this URL changes, and
 * that worker served the home page from its cache (stale inflation figures).
 * The new site registers no service worker. When such a browser checks for an
 * update it installs this file instead, which
 *   1. activates immediately,
 *   2. deletes the old worker's caches (names starting with "inflaatio"),
 *   3. unregisters itself, and
 *   4. reloads the pages it controlled once, now straight from the network.
 * It has no fetch handler, so it never intercepts a request.
 *
 * Keep this file until about 9/2027, then delete it (docs/OPERATIONS.md).
 * Classic script (no import/export). Tested in test/ops.test.js.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retire());
});

async function retire() {
  try {
    const names = await self.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('inflaatio')).map((name) => self.caches.delete(name)));
  } catch {
    // Cache storage unavailable: nothing to clean.
  }
  try {
    await self.registration.unregister();
  } catch {
    // Already unregistered.
  }
  try {
    const windows = await self.clients.matchAll({ type: 'window' });
    // After unregister() the reload is no longer controlled by any worker,
    // so it happens exactly once.
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)));
  } catch {
    // No controlled pages.
  }
}
