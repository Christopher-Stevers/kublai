// @ts-nocheck
const CACHE_NAME = "foremenhq-offline-shell-v8";
const APP_SHELL_ROUTES = [
  "/dashboard",
  "/dashboard/catalogue",
  "/dashboard/suppliers",
  "/dashboard/quotes",
  "/dashboard/orders",
  "/dashboard/account",
  "/dashboard/jobs/__offline-shell__",
  "/dashboard/material-lists/__offline-shell__",
];
const ROUTE_FALLBACKS = new Map([
  ["/dashboard/jobs/__offline-shell__", "/__offline_fallback/dashboard/jobs"],
  ["/dashboard/material-lists/__offline-shell__", "/__offline_fallback/dashboard/material-lists"],
]);
const PWA_ASSETS = [
  "/manifest.webmanifest",
  "/foremanhq/site.webmanifest",
  "/foremanhq/favicon.ico",
  "/foremanhq/favicon-16x16.png",
  "/foremanhq/favicon-32x32.png",
  "/foremanhq/apple-touch-icon.png",
  "/foremanhq/android-chrome-192x192.png",
  "/foremanhq/android-chrome-512x512.png",
];
const NAVIGATION_FALLBACKS = ["/dashboard", "/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL_ROUTES, ...PWA_ASSETS]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  const url = new URL(request.url);

  if (
    url.origin === self.location.origin &&
    ROUTE_FALLBACKS.has(url.pathname)
  ) {
    event.respondWith(cacheOfflineShell(request, url.pathname));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || PWA_ASSETS.includes(url.pathname))
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheOfflineShell(request, pathname) {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(request);

  if (response.ok) {
    await cache.put(request, response.clone());
    const fallback = ROUTE_FALLBACKS.get(pathname);
    if (fallback) {
      await cache.put(fallback, response.clone());
    }
  }

  return response;
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (url.pathname.startsWith("/dashboard/jobs/")) {
        await cache.put("/__offline_fallback/dashboard/jobs", response.clone());
      } else if (url.pathname.startsWith("/dashboard/material-lists/")) {
        await cache.put("/__offline_fallback/dashboard/material-lists", response.clone());
      }
    }
    return response;
  } catch {
    const cachedExact = await cache.match(request);
    if (cachedExact) return cachedExact;

    const cachedByPath = await cache.match(url.pathname);
    if (cachedByPath) return cachedByPath;

    if (url.pathname.startsWith("/dashboard/jobs/")) {
      const cachedJobFallback =
        (await cache.match("/__offline_fallback/dashboard/jobs")) ??
        (await cache.match("/dashboard/jobs/__offline-shell__"));
      if (cachedJobFallback) return cachedJobFallback;
    }

    if (url.pathname.startsWith("/dashboard/material-lists/")) {
      const cachedMaterialListFallback =
        (await cache.match("/__offline_fallback/dashboard/material-lists")) ??
        (await cache.match("/dashboard/material-lists/__offline-shell__"));
      if (cachedMaterialListFallback) return cachedMaterialListFallback;
    }

    for (const fallback of NAVIGATION_FALLBACKS) {
      const cachedFallback = await cache.match(fallback);
      if (cachedFallback) return cachedFallback;
    }

    return new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}
