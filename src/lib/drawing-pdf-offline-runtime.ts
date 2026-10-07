"use client";

import { loadPdfJs } from "./pdf-client";

/** Package files, never uploaded drawings. Keep the SW allowlist and this list in sync. */
export const DRAWING_PDF_RUNTIME_FILES = [
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
] as const;
const VERSION = "foremenhq-offline-shell-v13";
const RUNTIME_CACHE = `${VERSION}:pdf-runtime`;
const STATIC_CACHE = `${VERSION}:static`;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS = 8;
const mainChunk = /(?:^|\/)drawing-pdf-runtime(?:[.-][a-zA-Z0-9_-]+)*\.js$/;
function publicChunk(value: string) {
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin &&
      /^\/_next\/static\/chunks\/[a-zA-Z0-9_./-]+\.js$/.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function loadedChunks() {
  return new Set(
    [
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
      ...Array.from(document.scripts, (script) => script.src),
    ]
      .map(publicChunk)
      .filter((value): value is string => Boolean(value)),
  );
}
async function bounded<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  ms: number,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "Offline drawing setup took too long. Reconnect and try again.",
              ),
            ),
          ms,
        );
        abort = () =>
          reject(
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("Cancelled", "AbortError"),
          );
        signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
async function requireCurrentWorker(signal?: AbortSignal) {
  if (!("serviceWorker" in navigator) || !("caches" in window))
    throw Error(
      "Offline PDF rendering is unavailable in this browser. Use the installed app or a supported browser.",
    );
  await bounded(navigator.serviceWorker.ready, signal, 10_000);
  const worker = navigator.serviceWorker.controller;
  if (!worker)
    throw Error(
      "Reload ForemanHQ while connected, then save the drawing offline again.",
    );
  const channel = new MessageChannel();
  try {
    const version = await bounded(
      new Promise<unknown>((resolve) => {
        channel.port1.onmessage = (event: MessageEvent<unknown>) =>
          resolve(event.data);
        worker.postMessage({ type: "FOREMANHQ_PDF_RUNTIME_VERSION" }, [
          channel.port2,
        ]);
      }),
      signal,
      5_000,
    );
    if (version !== VERSION)
      throw Error(
        "Reload ForemanHQ to finish updating offline drawing support.",
      );
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}
/** Explicit offline preparation: at most 22 package files + 8 public JS chunks, 32 MiB total. */
export async function warmDrawingPdfRuntime({
  signal,
}: { signal?: AbortSignal } = {}) {
  await requireCurrentWorker(signal);
  const before = loadedChunks();
  await bounded(loadPdfJs(), signal, 20_000);
  signal?.throwIfAborted();
  const staticCache = await caches.open(STATIC_CACHE);
  const after = loadedChunks();
  const cached = (await staticCache.keys())
    .map((request) => publicChunk(request.url))
    .filter((value): value is string => Boolean(value));
  const main = [...after, ...cached].find((url) =>
    mainChunk.test(new URL(url).pathname),
  );
  if (!main)
    throw Error(
      "The PDF renderer could not be verified for offline use. Reload this drawing while connected and try again.",
    );
  const chunks = [
    main,
    ...[...after].filter((url) => url !== main && !before.has(url)),
  ];
  if (chunks.length > MAX_CHUNKS)
    throw Error(
      "The PDF renderer is still updating. Reload and try saving offline again.",
    );
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const jobs = [
    ...DRAWING_PDF_RUNTIME_FILES.map((file) => ({
      url: new URL(`/api/pdfjs-assets/${file}`, location.origin).href,
      cache: runtimeCache,
    })),
    ...chunks.map((url) => ({ url, cache: staticCache })),
  ];
  let next = 0,
    totalBytes = 0;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < jobs.length) {
          signal?.throwIfAborted();
          controller.signal.throwIfAborted();
          const job = jobs[next++]!;
          const response = await bounded(
            fetch(job.url, {
              credentials: "same-origin",
              cache: "reload",
              signal: controller.signal,
            }),
            controller.signal,
            20_000,
          );
          if (!response.ok)
            throw Error(
              "Could not download the PDF renderer. Reconnect and save offline again.",
            );
          const length = Number(response.headers.get("content-length"));
          if (length > MAX_BYTES)
            throw Error("The PDF renderer exceeds the offline storage budget.");
          const bytes = await bounded(
            response.arrayBuffer(),
            controller.signal,
            20_000,
          );
          controller.signal.throwIfAborted();
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_BYTES)
            throw Error("The PDF renderer exceeds the offline storage budget.");
          const stored = new Response(bytes, {
            status: 200,
            headers: response.headers,
          });
          await job.cache.put(job.url, stored);
          if (!(await job.cache.match(job.url)))
            throw Error(
              "This browser could not retain the offline PDF renderer. Check available device storage.",
            );
        }
      }),
    );
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  signal?.throwIfAborted();
  return { files: jobs.length, bytes: totalBytes };
}
