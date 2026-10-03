// @ts-nocheck
// ForemenHQ offline service worker.
// Keep API/sync traffic network-only. Cache navigations and static assets so the
// installed app can open while offline and Replicache can read its IndexedDB cache.

const VERSION = "foremenhq-offline-shell-v12";
const PAGE_CACHE = `${VERSION}:pages`;
const STATIC_CACHE = `${VERSION}:static`;
const IMAGE_CACHE = `${VERSION}:images`;
const OFFLINE_FALLBACK = "/dashboard";
const OFFLINE_PAGE = "/offline.html";
const CACHE_LIMITS = {
  [PAGE_CACHE]: 60,
  [STATIC_CACHE]: 200,
  [IMAGE_CACHE]: 1200,
};

// Cache storage is optional: quota/privacy failures must never discard a network response.
async function safeMatch(request, name) {
  try {
    return name
      ? await (await caches.open(name)).match(request)
      : await caches.match(request);
  } catch {
    return undefined;
  }
}
async function safePut(name, request, response) {
  try {
    const cache = await caches.open(name);
    await cache.put(request, response);
    const keys = await cache.keys();
    await Promise.all(
      keys
        .slice(0, Math.max(0, keys.length - CACHE_LIMITS[name]))
        .map((key) => cache.delete(key)),
    );
  } catch {
    /* Network response remains usable even when caching fails. */
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) =>
        Promise.allSettled(
          ["/", "/dashboard", OFFLINE_PAGE].map((url) => cache.add(url)),
        ).catch(() => {
          // Authenticated routes may not precache during install depending on the
          // browser/session. Runtime navigation caching below is the real source
          // of offline coverage.
        }),
      )
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys().catch(() => []);
      await Promise.allSettled(
        keys
          .filter(
            (key) =>
              key.startsWith("foremenhq-offline-") && !key.startsWith(VERSION),
          )
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

function isPrivateChatRequest(url) {
  if (url.pathname.startsWith("/api/job-chat/")) return true;
  if (url.pathname === "/_next/image") {
    try {
      const original = new URL(
        url.searchParams.get("url") ?? "",
        self.location.origin,
      );
      return (
        isSameOrigin(original) && original.pathname.startsWith("/api/job-chat/")
      );
    } catch {
      return true;
    }
  }
  return false;
}
function isCacheableImageRequest(url, request) {
  // Chat attachments are private, permission-checked and must never enter a shared cache.
  if (isPrivateChatRequest(url)) return false;
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
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await safePut(PAGE_CACHE, request, response.clone());
      // Keep a dashboard shell fallback fresh for deep links.
      const url = new URL(request.url);
      if (url.pathname === "/dashboard") {
        await safePut(PAGE_CACHE, OFFLINE_FALLBACK, response.clone());
      }
    }
    return response;
  } catch {
    return (
      (await safeMatch(request, PAGE_CACHE)) ||
      (await safeMatch(OFFLINE_FALLBACK, PAGE_CACHE)) ||
      (await safeMatch(OFFLINE_PAGE, PAGE_CACHE)) ||
      (await safeMatch("/", PAGE_CACHE)) ||
      new Response(
        "<!doctype html><title>ForemanHQ offline</title><main style='font-family:sans-serif;padding:2rem'><h1>ForemanHQ is offline</h1><p>Reconnect once to cache the app shell, then it can open offline.</p></main>",
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: 200,
        },
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
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await safePut(PAGE_CACHE, request, response.clone());
    }
    return response;
  } catch {
    const cached = await safeMatch(request, PAGE_CACHE);
    if (cached) return cached;
    throw new Error("Offline RSC payload not cached");
  }
}

async function cacheFirstStatic(request) {
  const cached = await safeMatch(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await safePut(STATIC_CACHE, request, response.clone());
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
      const cached = await safeMatch(job.request, IMAGE_CACHE);
      if (cached) return cached;
      const response = await fetch(job.request);
      if (response.ok)
        await safePut(IMAGE_CACHE, job.request, response.clone());
      return response;
    })()
      .then(job.resolve, job.reject)
      .finally(() => {
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
    if (index >= 0) {
      imageQueue.splice(index, 1);
      imageQueue.unshift(job);
    }
  }
  drainImages();
  return job.promise.then((response) => response.clone());
}

async function cacheFirstImage(request) {
  const cached = await safeMatch(request);
  if (cached) return cached;
  try {
    return await queueImage(request, true);
  } catch (error) {
    // The warmer stores originals. An unseen thumbnail can use its already
    // cached original offline, avoiding duplicate warming of every pixel size.
    const url = new URL(request.url);
    const source =
      url.pathname === "/_next/image" ? url.searchParams.get("url") : null;
    if (source) {
      const original = new URL(source, self.location.origin);
      if (isSameOrigin(original)) {
        const fallback = await safeMatch(original.href, IMAGE_CACHE);
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
        const urls = Array.from(
          new Set(["/", "/dashboard", OFFLINE_PAGE, ...(data.urls ?? [])]),
        )
          .slice(0, 20)
          .map((value) => {
            try {
              return new URL(value, self.location.origin);
            } catch {
              return null;
            }
          })
          .filter(
            (url) =>
              url &&
              isSameOrigin(url) &&
              !isApiOrSyncRequest(url) &&
              !isPrivateChatRequest(url),
          );

        await Promise.allSettled(
          urls.map(async (url) => {
            const request = new Request(url.href, {
              credentials: "same-origin",
            });
            const response = await fetch(request);
            if (response.ok && response.type === "basic") {
              await safePut(PAGE_CACHE, request, response);
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
        .filter((url) =>
          isCacheableImageRequest(url, { destination: "image" }),
        );

      await Promise.allSettled(
        urls.map((url) =>
          queueImage(new Request(url.href, { credentials: "same-origin" })),
        ),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (!isSameOrigin(url) || isPrivateChatRequest(url)) return;

  if (isCacheableImageRequest(url, event.request)) {
    event.respondWith(cacheFirstImage(event.request));
    return;
  }

  // Never cache other API/sync responses. Offline data belongs in
  // Replicache/IndexedDB, not in a service-worker HTTP cache.
  if (isApiOrSyncRequest(url)) return;

  if (
    event.request.mode === "navigate" ||
    event.request.destination === "document"
  ) {
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

// A device opt-in belongs to one signed-in account. Persist only its one-way account
// fingerprint, not user names or message contents. Missing/failed storage fails closed.
const PUSH_BINDING_CACHE = "foremenhq-push-binding-v1";
const PUSH_BINDING_URL = new URL(
  "/__push-account-binding",
  self.location.origin,
).href;
function safeChatUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin &&
      !url.search &&
      !url.hash &&
      /^\/dashboard\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/chat$/.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
async function pushAccount() {
  try {
    const response = await (
      await caches.open(PUSH_BINDING_CACHE)
    ).match(PUSH_BINDING_URL);
    return response ? await response.text() : null;
  } catch {
    return null;
  }
}
let pushBindingWrite = Promise.resolve();
self.addEventListener("message", (event) => {
  if (event.data?.type !== "FOREMANHQ_PUSH_ACCOUNT") return;
  const account = event.data.account;
  if (
    account !== null &&
    (typeof account !== "string" || !/^[a-f0-9]{64}$/.test(account))
  )
    return;
  pushBindingWrite = pushBindingWrite
    .catch(() => undefined)
    .then(async () => {
      let ok = false;
      try {
        const cache = await caches.open(PUSH_BINDING_CACHE);
        await cache.put(PUSH_BINDING_URL, new Response(account ?? ""));
        if (!account) {
          const notifications = await self.registration.getNotifications();
          for (const notification of notifications)
            if (notification.data?.type === "job-chat") notification.close();
        }
        ok = true;
      } catch {
        /* The page reports unavailable notification storage. */
      }
      event.ports?.[0]?.postMessage({ ok });
    });
  event.waitUntil(pushBindingWrite);
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data?.json();
      } catch {
        return;
      }
      const url = safeChatUrl(data?.url);
      if (
        data?.type !== "job-chat" ||
        !url ||
        typeof data.account !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.account) ||
        data.account !== (await pushAccount())
      )
        return;
      await self.registration.showNotification("ForemanHQ Chat", {
        body: "There is new activity in a job chat. Open ForemanHQ to read it.",
        icon: "/foremanhq/notification-icon.png",
        // Android status-bar icon (white silhouette; the platform tints it).
        badge: "/foremanhq/notification-badge.png",
        // Browsers cannot play a custom sound; a short double buzz stands out instead.
        vibrate: [90, 60, 90],
        tag: `job-chat-${new URL(url).pathname.split("/")[3]}`,
        // Alert again for each new message instead of silently replacing the last one.
        renotify: true,
        timestamp: Date.now(),
        data: { type: "job-chat", url, account: data.account },
      });
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  if (event.notification.data?.type !== "job-chat") return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const data = event.notification.data;
      const url = safeChatUrl(data?.url);
      if (
        !url ||
        typeof data.account !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.account) ||
        data.account !== (await pushAccount())
      )
        return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing =
        windows.find((client) => client.url === url) ??
        windows.find((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });
      if (existing) {
        try {
          const target =
            existing.url === url ? existing : await existing.navigate(url);
          if (target) {
            await target.focus();
            return;
          }
        } catch {
          /* An exiting tab may no longer be navigable. Open a new app window. */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
