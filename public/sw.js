// @ts-nocheck
// ForemenHQ offline service worker.
// Keep API/sync traffic network-only. Cache navigations and static assets so the
// installed app can open while offline and Replicache can read its IndexedDB cache.

const VERSION = "foremenhq-offline-shell-v10";
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

const imageWork = new Map();
const imageQueue = [];
let activeImageDownloads = 0;
const IMAGE_CONCURRENCY = 4;

function drainImages() {
  while (activeImageDownloads < IMAGE_CONCURRENCY && imageQueue.length) {
    const job = imageQueue.shift();
    activeImageDownloads++;
    (async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(job.request);
      if (cached) return cached;
      const response = await fetch(job.request);
      if (response.ok) await cache.put(job.request, response.clone());
      return response;
    })().then(job.resolve, job.reject).finally(() => {
      activeImageDownloads--;
      imageWork.delete(job.request.url);
      drainImages();
    });
  }
}

function queueImage(request, visible = false) {
  let job = imageWork.get(request.url);
  if (!job) {
    job = { request };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    imageWork.set(request.url, job);
    if (visible) imageQueue.unshift(job);
    else imageQueue.push(job);
  } else if (visible) {
    const index = imageQueue.indexOf(job);
    if (index >= 0) { imageQueue.splice(index, 1); imageQueue.unshift(job); }
  }
  drainImages();
  return job.promise.then(response => response.clone());
}

async function cacheFirstImage(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    return await queueImage(request, true);
  } catch (error) {
    // The warmer stores originals. An unseen thumbnail can use its already
    // cached original offline, avoiding duplicate warming of every pixel size.
    const url = new URL(request.url);
    const source = url.pathname === "/_next/image" ? url.searchParams.get("url") : null;
    if (source) {
      const original = new URL(source, self.location.origin);
      if (isSameOrigin(original)) {
        const fallback = await caches.match(original.href);
        if (fallback) return fallback;
      }
    }
    throw error;
  }
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

      await Promise.allSettled(urls.map(url =>
        queueImage(new Request(url.href, { credentials: "same-origin" })),
      ));
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
