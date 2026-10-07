import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const origin = "https://example.test";
function harness() {
  const listeners = new Map(),
    stores = new Map();
  const key = (value) => String(value.url ?? value);
  const cache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      match: async (request) => entries.get(key(request))?.clone(),
      put: async (request, response) => entries.set(key(request), response),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      delete: async (request) => entries.delete(key(request)),
    };
  };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Map,
    Set,
    Promise,
    fetch: async () => new Response("runtime v1"),
    caches: {
      open: async (name) => cache(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (request) => {
        for (const name of stores.keys()) {
          const found = await cache(name).match(request);
          if (found) return found;
        }
      },
    },
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      addEventListener: (type, callback) =>
        listeners.set(type, [...(listeners.get(type) ?? []), callback]),
    },
  });
  vm.runInContext(source, context);
  const emit = async (type, properties = {}) => {
    const pending = [];
    let response;
    for (const listener of listeners.get(type) ?? [])
      listener({
        ...properties,
        waitUntil: (promise) => pending.push(promise),
        respondWith: (promise) => {
          response = promise;
        },
      });
    await Promise.all(pending);
    return response ? await response : undefined;
  };
  return { context, stores, cache, emit };
}
test("private drawing previews, tiles and optimized variants bypass every shared cache", async () => {
  const h = harness();
  for (const path of [
    "/api/job-rooms/files/a/page.webp",
    "/api/job-rooms/files/a/tiles/1/0-0.webp",
    "/_next/image?url=%2Fapi%2Fjob-rooms%2Ffiles%2Fa%2Fpage.webp&w=640&q=75",
  ]) {
    const url = new URL(path, origin);
    assert.equal(
      h.context.isCacheableImageRequest(url, { destination: "image" }),
      false,
    );
    assert.equal(
      await h.emit("fetch", {
        request: { method: "GET", url: url.href, destination: "image" },
      }),
      undefined,
    );
  }
});
test("activation purges legacy private drawing entries, including optimized thumbnails", async () => {
  const h = harness();
  const name = "foremenhq-offline-shell-v13:images";
  const urls = [
    `${origin}/api/job-rooms/files/a/page.webp`,
    `${origin}/_next/image?url=%2Fapi%2Fjob-rooms%2Ffiles%2Fa%2Fpage.webp&w=32`,
    `${origin}/images/logo.png`,
  ];
  for (const url of urls) await h.cache(name).put(url, new Response("old"));
  await h
    .cache("foremenhq-offline-shell-v12:images")
    .put(urls[0], new Response("old"));
  await h.emit("activate");
  assert.deepEqual([...h.stores.get(name).keys()], [urls[2]]);
  assert.equal(h.stores.has("foremenhq-offline-shell-v12:images"), false);
});
test("only exact public PDF runtime assets get network-first and offline fallback", async () => {
  const h = harness();
  const url = new URL("/api/pdfjs-assets/wasm/jbig2.wasm", origin);
  const request = new Request(url);
  assert.equal(await (await h.emit("fetch", { request })).text(), "runtime v1");
  h.context.fetch = async () => new Response("runtime v2");
  assert.equal(await (await h.emit("fetch", { request })).text(), "runtime v2");
  h.context.fetch = async () => {
    throw Error("offline");
  };
  assert.equal(await (await h.emit("fetch", { request })).text(), "runtime v2");
  for (const path of [
    "/api/pdfjs-assets/wasm/private.wasm",
    "/api/pdfjs-assets/wasm/jbig2.wasm?user=other",
    "/api/trpc/private",
    "/api/job-rooms/files/a/pdf",
  ]) {
    assert.equal(
      await h.emit("fetch", { request: new Request(new URL(path, origin)) }),
      undefined,
    );
  }
});
test("package-file allowlist exactly matches explicit offline warmer and stays bounded", async () => {
  const h = harness();
  const helper = await readFile(
    new URL("../src/lib/drawing-pdf-offline-runtime.ts", import.meta.url),
    "utf8",
  );
  const section = helper
    .split("DRAWING_PDF_RUNTIME_FILES = [")[1]
    .split("] as const")[0];
  const files = [...section.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...vm.runInContext("Array.from(PDF_RUNTIME_FILES)", h.context)].sort(),
    files.sort(),
  );
  assert.equal(files.length, 22);
});
