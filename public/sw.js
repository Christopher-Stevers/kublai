// @ts-nocheck
// Development reset service worker.
// ForemenHQ is currently being tested in live development mode; unregister this
// worker so stale app-shell/_next caches cannot keep old sync code running.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.navigate(client.url);
      }
      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("fetch", () => {
  // Intentionally no-op: browser/network handles all requests.
});
