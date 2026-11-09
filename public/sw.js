// @ts-nocheck
// ForemenHQ offline service worker.
// Keep API/sync traffic network-only. Cache navigations and static assets so the
// installed app can open while offline and Replicache can read its IndexedDB cache.

const VERSION = "foremenhq-offline-shell-v13";
const PAGE_CACHE = `${VERSION}:pages`;
const STATIC_CACHE = `${VERSION}:static`;
const IMAGE_CACHE = `${VERSION}:images`;
const PDF_RUNTIME_CACHE = `${VERSION}:pdf-runtime`;
const OFFLINE_FALLBACK = "/jobs";
const OFFLINE_PAGE = "/offline.html";
const CACHE_LIMITS = {
  [PAGE_CACHE]: 60,
  [STATIC_CACHE]: 200,
  [IMAGE_CACHE]: 1200,
  [PDF_RUNTIME_CACHE]: 31,
};


// A device-local test switch; deliberately independent of versioned app caches.
const OFFLINE_TEST_CACHE = "foremanhq-offline-test-v1";
const OFFLINE_TEST_URL = new URL("/__offline-test", self.location.origin).href;
let offlineTestState;
function offlineTestEnabled() {
  return offlineTestState ??= caches.open(OFFLINE_TEST_CACHE).then(cache => cache.match(OFFLINE_TEST_URL)).then(response => response ? response.text() : "0").then(value => value === "1").catch(() => false);
}
async function offlineTestFetch(...args) {
  if (await offlineTestEnabled()) throw new TypeError("ForemanHQ offline test mode");
  return fetch(...args);
}
async function setOfflineTest(enabled) {
  const cache = await caches.open(OFFLINE_TEST_CACHE);
  await cache.put(OFFLINE_TEST_URL, new Response(enabled ? "1" : "0"));
  offlineTestState = Promise.resolve(enabled);
}
self.addEventListener("message", event => {
  if (event.data?.type === "FOREMANHQ_OFFLINE_TEST_GET") {
    event.waitUntil(offlineTestEnabled().then(enabled => event.ports?.[0]?.postMessage({enabled})));
    return;
  }
  if (event.data?.type !== "FOREMANHQ_OFFLINE_TEST_SET" || typeof event.data.enabled !== "boolean") return;
  event.waitUntil((async () => {
    try {
      // Warm the current settings shell while still connected so turning the
      // switch on cannot strand the user on an uncached settings route.
      if (event.data.enabled && !(await offlineTestEnabled())) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try { await Promise.all(["/jobs", "/jobs/account/settings", OFFLINE_PAGE].map(url => networkFirstNavigation(new Request(new URL(url, self.location.origin), {credentials: "same-origin", signal: controller.signal})))); }
        finally { clearTimeout(timer); }
      }
      await setOfflineTest(event.data.enabled);
      event.ports?.[0]?.postMessage({ok: true});
    } catch { event.ports?.[0]?.postMessage({ok: false, error: "Browser storage is unavailable. Offline test mode was not changed."}); }
  })());
});

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
          ["/", "/jobs", OFFLINE_PAGE].map(async (url) => { const response = await offlineTestFetch(new Request(new URL(url, self.location.origin))); if(response.ok) await cache.put(url, response); }),
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
      // Remove any legacy private drawings or optimized thumbnails even if a cache
      // was populated by an earlier worker during this activation.
      const remaining = await caches.keys().catch(() => []);
      await Promise.allSettled(
        remaining
          .filter((key) => key.startsWith("foremenhq-offline-"))
          .map(async (key) => {
            const cache = await caches.open(key);
            await Promise.allSettled(
              (await cache.keys())
                .filter((request) => isPrivateChatRequest(new URL(request.url)))
                .map((request) => cache.delete(request)),
            );
          }),
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
  if (
    url.pathname.startsWith("/api/job-rooms/files/") ||
    url.pathname === "/api/job-rooms/files" ||
    url.pathname.startsWith("/api/job-chat/") ||
    url.pathname.startsWith("/api/chat/") ||
    url.pathname.startsWith("/api/job-documents") ||
    url.pathname.startsWith("/api/drawings/attachments/")
  )
    return true;
  if (url.pathname === "/_next/image") {
    try {
      const original = new URL(
        url.searchParams.get("url") ?? "",
        self.location.origin,
      );
      return (
        isSameOrigin(original) &&
        (original.pathname.startsWith("/api/job-rooms/files/") ||
          original.pathname === "/api/job-rooms/files" ||
          original.pathname.startsWith("/api/job-chat/") ||
          original.pathname.startsWith("/api/chat/") ||
          original.pathname.startsWith("/api/job-documents") ||
          original.pathname.startsWith("/api/drawings/attachments/"))
      );
    } catch {
      return true;
    }
  }
  return false;
}
const PDF_RUNTIME_FILES = new Set([
  "legacy/build/pdf.worker.min.mjs",
  "wasm/jbig2.wasm",
  "wasm/jbig2_nowasm_fallback.js",
  "wasm/openjpeg.wasm",
  "wasm/openjpeg_nowasm_fallback.js",
  "wasm/qcms_bg.wasm",
  "wasm/quickjs-eval.js",
  "wasm/quickjs-eval.wasm",
  "standard_fonts/FoxitDingbats.pfb",
  "standard_fonts/FoxitFixed.pfb",
  "standard_fonts/FoxitFixedBold.pfb",
  "standard_fonts/FoxitFixedBoldItalic.pfb",
  "standard_fonts/FoxitFixedItalic.pfb",
  "standard_fonts/FoxitSerif.pfb",
  "standard_fonts/FoxitSerifBold.pfb",
  "standard_fonts/FoxitSerifBoldItalic.pfb",
  "standard_fonts/FoxitSerifItalic.pfb",
  "standard_fonts/FoxitSymbol.pfb",
  "standard_fonts/LiberationSans-Bold.ttf",
  "standard_fonts/LiberationSans-BoldItalic.ttf",
  "standard_fonts/LiberationSans-Italic.ttf",
  "standard_fonts/LiberationSans-Regular.ttf",
]);
function isPublicPdfRuntime(url) {
  return (
    !url.search &&
    !url.hash &&
    url.pathname.startsWith("/api/pdfjs-assets/") &&
    PDF_RUNTIME_FILES.has(url.pathname.slice("/api/pdfjs-assets/".length))
  );
}
async function networkFirstPdfRuntime(request) {
  try {
    const response = await offlineTestFetch(request);
    if (response.ok)
      await safePut(PDF_RUNTIME_CACHE, request, response.clone());
    // Authentication or missing routes must not be disguised as old cached software.
    return response;
  } catch (error) {
    const cached = await safeMatch(request, PDF_RUNTIME_CACHE);
    if (cached) return cached;
    throw error;
  }
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "FOREMANHQ_PDF_RUNTIME_VERSION")
    event.ports?.[0]?.postMessage(VERSION);
});
function isCacheableImageRequest(url, request) {
  // Chat and document files require a fresh permission check and must never enter a shared cache.
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
    const response = await offlineTestFetch(request);
    if (response.ok && response.type === "basic") {
      await safePut(PAGE_CACHE, request, response.clone());
      // Keep a Jobs shell fallback fresh for deep links.
      const url = new URL(request.url);
      if (url.pathname === "/jobs") {
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
    const response = await offlineTestFetch(request);
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

  const response = await offlineTestFetch(request);
  if (response.ok) {
    await safePut(STATIC_CACHE, request, response.clone());
  }
  return response;
}

const imageWork = new Map();
const imageQueue = [];
let activeImageDownloads = 0;
let activeBackgroundImageDownloads = 0;
const IMAGE_CONCURRENCY = 4;

function drainImages() {
  while (activeImageDownloads < IMAGE_CONCURRENCY && imageQueue.length) {
    // Leave three download slots free for the photos the user can actually see.
    let index = imageQueue.findIndex((job) => job.visible);
    if (index < 0) {
      if (activeBackgroundImageDownloads >= 1) return;
      index = 0;
    }
    const [job] = imageQueue.splice(index, 1);
    const background = !job.visible;
    if (background) activeBackgroundImageDownloads++;
    activeImageDownloads++;
    (async () => {
      const cached = await safeMatch(job.request, IMAGE_CACHE);
      if (cached) return cached;
      const response = await offlineTestFetch(job.request);
      if (response.ok)
        await safePut(IMAGE_CACHE, job.request, response.clone());
      return response;
    })()
      .then(job.resolve, job.reject)
      .finally(() => {
        activeImageDownloads--;
        if (background) activeBackgroundImageDownloads--;
        imageWork.delete(job.request.url);
        drainImages();
      });
  }
}

function queueImage(request, visible = false) {
  let job = imageWork.get(request.url);
  if (!job) {
    job = { request, visible };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    imageWork.set(request.url, job);
    if (visible) imageQueue.unshift(job);
    else imageQueue.push(job);
  } else if (visible) {
    job.visible = true;
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
          new Set(["/", "/jobs", OFFLINE_PAGE, ...(data.urls ?? [])]),
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
            const response = await offlineTestFetch(request);
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

      const results = await Promise.allSettled(
        urls.map((url) =>
          queueImage(new Request(url.href, { credentials: "same-origin" })),
        ),
      );
      event.ports?.[0]?.postMessage({
        cached: urls
          .filter(
            (_, index) =>
              results[index].status === "fulfilled" && results[index].value.ok,
          )
          .map((url) => url.pathname + url.search),
      });
    })(),
  );
});

async function routeAppRequest(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || !isSameOrigin(url) || isPrivateChatRequest(url)) return offlineTestFetch(request);
  if (isPublicPdfRuntime(url)) return networkFirstPdfRuntime(request);
  if (isCacheableImageRequest(url, request)) return cacheFirstImage(request);
  if (isApiOrSyncRequest(url)) return offlineTestFetch(request);
  if (request.mode === "navigate" || request.destination === "document") return networkFirstNavigation(request);
  if (isRscRequest(url, request)) return networkFirstRsc(request);
  if (isStaticAsset(url, request)) return cacheFirstStatic(request);
  return offlineTestFetch(request);
}
self.addEventListener("fetch", event => {
  event.respondWith(routeAppRequest(event.request));
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
    url.pathname = url.pathname.replace(/^\/dashboard\/jobs(?=\/|$)/, "/jobs")
      .replace(/^\/dashboard(?=\/|$)/, "/jobs");
    return url.origin === self.location.origin &&
      !url.search &&
      !url.hash &&
      /^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/chat$/.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function safeConversationUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    url.pathname = url.pathname.replace(/^\/dashboard\/jobs(?=\/|$)/, "/jobs")
      .replace(/^\/dashboard(?=\/|$)/, "/jobs");
    return url.origin === self.location.origin &&
      url.pathname === "/jobs/chat" &&
      !url.hash &&
      [...url.searchParams.keys()].length === 1 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        url.searchParams.get("conversation") ?? "",
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function safeDrawingUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    url.pathname = url.pathname.replace(/^\/dashboard\/jobs(?=\/|$)/, "/jobs")
      .replace(/^\/dashboard(?=\/|$)/, "/jobs");
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (
      url.origin !== self.location.origin ||
      url.hash ||
      !/^\/jobs\/[0-9a-f-]{36}\/drawings$/.test(url.pathname) ||
      !uuid.test(url.pathname.split("/")[3])
    )
      return null;
    const keys = [...url.searchParams.keys()];
    if (
      keys.length !== 2 ||
      new Set(keys).size !== 2 ||
      !uuid.test(url.searchParams.get("drawingSet") ?? "") ||
      !uuid.test(url.searchParams.get("drawingSheet") ?? "")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function safeMaterialListUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    url.pathname = url.pathname.replace(/^\/dashboard\/jobs(?=\/|$)/, "/jobs")
      .replace(/^\/dashboard(?=\/|$)/, "/jobs");
    return url.origin === self.location.origin &&
      !url.search &&
      !url.hash &&
      /^\/jobs\/material-lists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        url.pathname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
// A slip received without a check opens on its review.
function safeSlipUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const keys = [...url.searchParams.keys()];
    return url.origin === self.location.origin &&
      !url.hash &&
      /^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/receiving$/.test(
        url.pathname,
      ) &&
      keys.length === 1 &&
      uuid.test(url.searchParams.get("document") ?? "")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function safePushUrl(data) {
  if (data?.type === "material-list") return safeMaterialListUrl(data.url);
  if (data?.type === "slip-received") return safeSlipUrl(data.url);
  if (data?.type === "conversation-chat") return safeConversationUrl(data.url);
  return data?.type === "job-drawing"
    ? safeDrawingUrl(data.url)
    : data?.type === "job-chat"
      ? safeChatUrl(data.url)
      : null;
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
async function updateAppIconBadge(count) {
  try {
    if (count > 0) await self.navigator?.setAppBadge?.(count);
    else await self.navigator?.clearAppBadge?.();
  } catch {
    // Unsupported/disabled badges must never interrupt notification delivery.
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
        const previousAccount = await pushAccount();
        const cache = await caches.open(PUSH_BINDING_CACHE);
        await cache.put(PUSH_BINDING_URL, new Response(account ?? ""));
        if (!account || previousAccount !== account)
          await updateAppIconBadge(0);
        if (!account) {
          const notifications = await self.registration.getNotifications();
          for (const notification of notifications)
            if (
              [
                "job-chat",
                "job-drawing",
                "conversation-chat",
                "material-list",
                "slip-received",
              ].includes(notification.data?.type)
            )
              notification.close();
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
      const url = safePushUrl(data);
      if (
        !url ||
        typeof data.account !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.account) ||
        data.account !== (await pushAccount())
      )
        return;
      // Always supply a number: replacing a numeric badge with the flag-only
      // API variant is not displayed consistently by iPadOS.
      await updateAppIconBadge(
        Number.isSafeInteger(data.badgeCount) && data.badgeCount >= 0
          ? data.badgeCount
          : 1,
      );
      const chat =
        data.type === "job-chat" || data.type === "conversation-chat";
      const slip = data.type === "slip-received";
      // Chat pushes carry the sender and message, like a messaging app.
      const text = (value, max) =>
        typeof value === "string" && value.trim()
          ? value.trim().slice(0, max)
          : null;
      const title = chat || slip ? text(data.title, 120) : null;
      const message = chat || slip ? text(data.body, 300) : null;
      await self.registration.showNotification(
        title ??
          (data.type === "material-list"
            ? "ForemanHQ Materials"
            : slip
              ? "ForemanHQ Receiving"
              : data.type === "job-drawing"
                ? "ForemanHQ Drawings"
                : "ForemanHQ Chat"),
        {
          body:
            message ??
            (data.type === "material-list"
              ? Number.isSafeInteger(data.itemCount) && data.itemCount > 0
                ? `${data.itemCount} item${data.itemCount === 1 ? "" : "s"} added. Open ForemanHQ to review the latest list.`
                : "Someone who reports to you added or edited material. Open ForemanHQ to review the list."
              : data.type === "job-drawing"
                ? "There is new drawing activity. Open ForemanHQ to review it."
                : data.type === "conversation-chat"
                  ? "You have a new chat message. Open ForemanHQ to read it."
                  : "There is new activity in a job chat. Open ForemanHQ to read it."),
          // Android shows this as a button; it opens the chat ready to type.
          actions: chat ? [{ action: "reply", title: "Reply" }] : [],
          icon: "/foremanhq/notification-icon-v3.png",
          // Android status-bar icon (white silhouette; the platform tints it).
          badge: "/foremanhq/notification-badge-v3.png",
          // Browsers cannot play a custom sound; a short double buzz stands out instead.
          vibrate: [90, 60, 90],
          tag: slip
            ? `slip-received-${new URL(url).searchParams.get("document")}`
            : data.type === "material-list"
              ? /^[a-f0-9]{64}$/.test(data.group ?? "")
                ? `material-sender-${data.group}`
                : `material-list-${new URL(url).pathname.split("/").at(-1)}`
              : data.type === "job-drawing"
                ? `job-drawing-${new URL(url).searchParams.get("drawingSheet")}`
                : data.type === "conversation-chat"
                  ? `conversation-chat-${new URL(url).searchParams.get("conversation")}`
                  : `job-chat-${new URL(url).pathname.split("/")[3]}`,
          // Alert again for each new message instead of silently replacing the last one.
          renotify: true,
          timestamp: Date.now(),
          data: { type: data.type, url, account: data.account },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  if (
    ![
      "job-chat",
      "job-drawing",
      "conversation-chat",
      "material-list",
      "slip-received",
    ].includes(event.notification.data?.type)
  )
    return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const data = event.notification.data;
      let url = safePushUrl(data);
      if (
        !url ||
        typeof data.account !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.account) ||
        data.account !== (await pushAccount())
      )
        return;
      // Reply opens the chat with the message box focused.
      if (event.action === "reply") {
        const target = new URL(url);
        target.searchParams.set("reply", "1");
        url = target.href;
      }
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
