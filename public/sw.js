// @ts-nocheck
// ForemenHQ offline service worker.
// Keep API/sync traffic network-only. Cache navigations and static assets so the
// installed app can open while offline and Replicache can read its IndexedDB cache.

const VERSION = "foremenhq-offline-shell-v9";
const PAGE_CACHE = `${VERSION}:pages`;
const STATIC_CACHE = `${VERSION}:static`;
const IMAGE_CACHE = `${VERSION}:images`;
const OFFLINE_FALLBACK = "/dashboard";
const OFFLINE_PAGE = "/offline.html";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) =>
      Promise.allSettled(
        ["/", "/dashboard", OFFLINE_PAGE].map((url) => cache.add(url)),
      ).catch(() => {
        // Authenticated routes may not precache during install depending on the
        // browser/session. Runtime navigation caching below is the real source
        // of offline coverage.
      }),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("foremenhq-offline-") && !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiOrSyncRequest(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/trpc/") ||
    url.pathname.includes("/replicache/")
  );
}

function isCacheableImageRequest(url, request) {
  return (
    request.destination === "image" ||
    url.pathname.startsWith("/api/catalogue/images/") ||
    url.pathname.startsWith("/images/")
  );
}

function isStaticAsset(url, request) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/foremanhq/") ||
    ["style", "script", "font"].includes(request.destination)
  );
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      // Keep a dashboard shell fallback fresh for deep links.
      const url = new URL(request.url);
      if (url.pathname === "/dashboard") {
        await cache.put(OFFLINE_FALLBACK, response.clone());
      }
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(OFFLINE_FALLBACK)) ||
      (await cache.match(OFFLINE_PAGE)) ||
      (await cache.match("/")) ||
      new Response(
        "<!doctype html><title>ForemanHQ offline</title><main style='font-family:sans-serif;padding:2rem'><h1>ForemanHQ is offline</h1><p>Reconnect once to cache the app shell, then it can open offline.</p></main>",
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 },
      )
    );
  }
}

function isRscRequest(url, request) {
  return (
    url.searchParams.has("_rsc") ||
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1"
  );
}

async function networkFirstRsc(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Offline RSC payload not cached");
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirstImage(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "FOREMENHQ_CACHE_APP_SHELL") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const urls = Array.from(new Set(["/", "/dashboard", OFFLINE_PAGE, ...(data.urls ?? [])]))
          .slice(0, 20)
          .map((value) => {
            try {
              return new URL(value, self.location.origin);
            } catch {
              return null;
            }
          })
          .filter((url) => url && isSameOrigin(url));

        await Promise.allSettled(
          urls.map(async (url) => {
            const request = new Request(url.href, { credentials: "same-origin" });
            const response = await fetch(request);
            if (response.ok && response.type === "basic") {
              await cache.put(request, response);
            }
          }),
        );
      })(),
    );
    return;
  }

  if (data.type !== "FOREMENHQ_CACHE_CATALOGUE_IMAGES") return;
  if (!Array.isArray(data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const urls = Array.from(new Set(data.urls))
        .slice(0, 1000)
        .map((value) => {
          try {
            return new URL(value, self.location.origin);
          } catch {
            return null;
          }
        })
        .filter((url) => url && isSameOrigin(url))
        .filter((url) => isCacheableImageRequest(url, { destination: "image" }));

      await Promise.allSettled(
        urls.map(async (url) => {
          const request = new Request(url.href, { credentials: "same-origin" });
          const cached = await cache.match(request);
          if (cached) return;

          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response);
          }
        }),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (!isSameOrigin(url)) return;

  if (isCacheableImageRequest(url, event.request)) {
    event.respondWith(cacheFirstImage(event.request));
    return;
  }

  // Never cache other API/sync responses. Offline data belongs in
  // Replicache/IndexedDB, not in a service-worker HTTP cache.
  if (isApiOrSyncRequest(url)) return;

  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isRscRequest(url, event.request)) {
    event.respondWith(networkFirstRsc(event.request));
    return;
  }

  if (isStaticAsset(url, event.request)) {
    event.respondWith(cacheFirstStatic(event.request));
  }
});
