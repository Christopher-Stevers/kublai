// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { deviceModelDownload } from "./device-model-cache";

const bytes = new Uint8Array([1, 2, 3]);
let version = '"v1"';
let status = 200;
let content = bytes;
const defaultNetwork = (_url: string, init?: RequestInit) =>
  Promise.resolve(
    new Response(init?.method === "HEAD" ? null : content, {
      status,
      headers: { etag: version, "content-length": String(content.length) },
    }),
  );
const network = vi.fn(defaultNetwork);
const open = (url: string) =>
  deviceModelDownload(url, new AbortController().signal, true);
beforeEach(() => {
  version = '"v1"';
  status = 200;
  content = bytes;
  network.mockClear();
  network.mockImplementation(defaultNetwork);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", network);
});
afterEach(() => vi.unstubAllGlobals());
it("reopens the same model without downloading its body", async () => {
  const first = await open("/model/a");
  await first.save(bytes);
  network.mockClear();
  const again = await open("/model/a");
  expect(again.cached).toBe(true);
  expect(new Uint8Array(await again.response.arrayBuffer())).toEqual(bytes);
  expect(network).toHaveBeenCalledTimes(1);
  expect(network.mock.calls[0]?.[1]?.method).toBe("HEAD");
});
it("replaces the only slot when switching models", async () => {
  await (await open("/model/a")).save(bytes);
  await (await open("/model/b")).save(bytes);
  expect((await open("/model/b")).cached).toBe(true);
  expect((await open("/model/a")).cached).toBe(false);
});
it("replaces changed content and rejects an older tab's late save", async () => {
  const old = await open("/model/a");
  const newer = await open("/model/b");
  await newer.save(bytes);
  await old.save(bytes);
  expect((await open("/model/b")).cached).toBe(true);
  version = '"v2"';
  expect((await open("/model/b")).cached).toBe(false);
});
it("does not serve a saved model after access is revoked", async () => {
  await (await open("/model/a")).save(bytes);
  status = 403;
  await expect(open("/model/a")).rejects.toThrow("not available");
  status = 200;
  expect((await open("/model/a")).cached).toBe(false);
});
it("can still open a model when device storage is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const model = await open("/model/a");
  expect(model.response.ok).toBe(true);
  await expect(model.save(bytes)).resolves.toBeUndefined();
});

it("browser tabs always download and cannot overwrite the app cache", async () => {
  await (await open("/model/a")).save(bytes);
  network.mockClear();
  for (let i = 0; i < 2; i++) {
    const tab = await deviceModelDownload(
      "/model/a",
      new AbortController().signal,
    );
    expect(tab.cached).toBe(false);
    await tab.save(bytes);
  }
  expect(network).toHaveBeenCalledTimes(2);
  expect(
    network.mock.calls.every(
      ([, init]) => init?.method !== "HEAD" && init?.cache === "no-store",
    ),
  ).toBe(true);
  const other = await deviceModelDownload(
    "/model/b",
    new AbortController().signal,
    false,
  );
  await other.save(bytes);
  expect((await open("/model/a")).cached).toBe(true);
});

function brokenBody(first: Uint8Array) {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.error(new Error("Connection interrupted"));
      else {
        sent = true;
        controller.enqueue(first);
      }
    },
  });
}
function resumeNetwork(data: Uint8Array, first: Uint8Array) {
  let attempt = 0;
  network.mockImplementation((_url, init) => {
    const headers = new Headers({
      etag: version,
      "content-length": String(data.length),
    });
    if (init?.method === "HEAD")
      return Promise.resolve(new Response(null, { headers }));
    const range = new Headers(init?.headers).get("range");
    if (attempt++ === 0)
      return Promise.resolve(new Response(brokenBody(first), { headers }));
    const offset = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
    headers.set("content-length", String(data.length - offset));
    if (range)
      headers.set(
        "content-range",
        `bytes ${offset}-${data.length - 1}/${data.length}`,
      );
    return Promise.resolve(
      new Response(data.slice(offset), { status: range ? 206 : 200, headers }),
    );
  });
}
it("resumes after an interrupted megabyte checkpoint without duplicate bytes", async () => {
  const data = new Uint8Array(1024 * 1024 + 13);
  data.fill(7);
  data.set([8, 9, 10], data.length - 3);
  resumeNetwork(data, data.slice(0, 1024 * 1024));
  const first = await open("/model/a");
  await expect(first.response.arrayBuffer()).rejects.toThrow("interrupted");
  const next = await open("/model/a");
  expect(next.resumed).toBe(true);
  expect(next.response.headers.get("content-length")).toBe(String(data.length));
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(data);
  const last = network.mock.calls.at(-1)?.[1];
  expect(new Headers(last?.headers).get("range")).toBe("bytes=1048576-");
  expect(new Headers(last?.headers).get("if-range")).toBe(version);
  // Complete checkpoints survive even if the app closes before parsing/saving.
  network.mockClear();
  const complete = await open("/model/a");
  expect(complete.cached).toBe(true);
  expect(new Uint8Array(await complete.response.arrayBuffer())).toEqual(data);
  expect(network).toHaveBeenCalledTimes(1);
});
it("flushes the final small chunk on interruption", async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
  resumeNetwork(data, data.slice(0, 3));
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  const next = await open("/model/a");
  expect(next.resumed).toBe(true);
  expect(
    new Headers(network.mock.calls.at(-1)?.[1]?.headers).get("range"),
  ).toBe("bytes=3-");
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(data);
});
it("discards partial bytes when the model version changes", async () => {
  resumeNetwork(new Uint8Array([1, 2, 3, 4, 5, 6]), bytes);
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  version = '"v2"';
  content = new Uint8Array([9, 8, 7, 6]);
  network.mockImplementation(defaultNetwork);
  const next = await open("/model/a");
  expect(next.resumed).toBe(false);
  expect(
    new Headers(network.mock.calls.at(-1)?.[1]?.headers).has("range"),
  ).toBe(false);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(content);
});
it("uses the full body safely if a server ignores Range", async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
  resumeNetwork(data, bytes);
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  content = data;
  network.mockImplementation(defaultNetwork);
  const next = await open("/model/a");
  expect(next.resumed).toBe(false);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(data);
});
it("rejects a mismatched resume offset", async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
  resumeNetwork(data, bytes);
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  network.mockImplementation((_url, init) =>
    Promise.resolve(
      new Response(init?.method === "HEAD" ? null : bytes, {
        status: init?.method === "HEAD" ? 200 : 206,
        headers: {
          etag: version,
          "content-length": "6",
          "content-range": "bytes 2-5/6",
        },
      }),
    ),
  );
  await expect(open("/model/a")).rejects.toThrow("resumed safely");
});
it("never joins a response from a changed version to the saved prefix", async () => {
  resumeNetwork(new Uint8Array([1, 2, 3, 4, 5, 6]), bytes);
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  network.mockImplementation((_url, init) =>
    Promise.resolve(
      new Response(init?.method === "HEAD" ? null : bytes, {
        headers: {
          etag: init?.method === "HEAD" ? version : '"v2"',
          "content-length": "6",
        },
      }),
    ),
  );
  await expect(open("/model/a")).rejects.toThrow("changed during download");
});
it("removes a partial model after access is revoked", async () => {
  resumeNetwork(new Uint8Array([1, 2, 3, 4, 5, 6]), bytes);
  await expect(
    (await open("/model/a")).response.arrayBuffer(),
  ).rejects.toThrow();
  network.mockImplementation(defaultNetwork);
  status = 403;
  await expect(open("/model/a")).rejects.toThrow("not available");
  status = 200;
  content = new Uint8Array([1, 2, 3, 4, 5, 6]);
  expect((await open("/model/a")).resumed).toBe(false);
});
it("keeps completed downloads from an older cache database", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  await new Promise<void>((resolve, reject) => {
    const request = factory.open("foreman-current-model", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("model");
    request.onerror = () => reject(request.error ?? Error("Cache upgrade failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("model", "readwrite");
      tx.objectStore("model").put(
        { token: "old", url: "/model/a", version, blob: new Blob([bytes]) },
        "current",
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
  const next = await open("/model/a");
  expect(next.cached).toBe(true);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(bytes);
});

it("preserves an in-flight checkpoint when the download is canceled", async () => {
  const data = new Uint8Array(1024 * 1024 + 10);
  data.fill(4);
  let attempt = 0;
  network.mockImplementation((_url, init) => {
    const headers = new Headers({
      etag: version,
      "content-length": String(data.length),
    });
    if (init?.method === "HEAD")
      return Promise.resolve(new Response(null, { headers }));
    if (attempt++ === 0) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(data.slice(0, 1024 * 1024));
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("Canceled", "AbortError")),
                { once: true },
              );
            },
          }),
          { headers },
        ),
      );
    }
    const offset = Number(
      new Headers(init?.headers).get("range")?.match(/^bytes=(\d+)-$/)?.[1] ??
        0,
    );
    headers.set(
      "content-range",
      `bytes ${offset}-${data.length - 1}/${data.length}`,
    );
    return Promise.resolve(
      new Response(data.slice(offset), { status: 206, headers }),
    );
  });
  const controller = new AbortController();
  const first = await deviceModelDownload("/model/a", controller.signal, true);
  const reader = first.response.body!.getReader();
  await reader.read();
  controller.abort();
  await expect(reader.read()).rejects.toThrow("Canceled");
  const next = await open("/model/a");
  expect(next.resumed).toBe(true);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(data);
});
it("does not replace a newer partial model with an older tab's completed download", async () => {
  const old = await open("/model/a");
  resumeNetwork(new Uint8Array([4, 5, 6, 7, 8, 9]), new Uint8Array([4, 5, 6]));
  await expect(
    (await open("/model/b")).response.arrayBuffer(),
  ).rejects.toThrow();
  await old.save(bytes);
  const next = await open("/model/b");
  expect(next.resumed).toBe(true);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(
    new Uint8Array([4, 5, 6, 7, 8, 9]),
  );
});
it("continues downloading when a checkpoint write fails", async () => {
  const data = new Uint8Array(1024 * 1024 + 10);
  data.fill(5);
  content = data;
  const first = await open("/model/a");
  // Simulates storage disappearing/quota failure after metadata was saved.
  vi.stubGlobal("indexedDB", undefined);
  expect(new Uint8Array(await first.response.arrayBuffer())).toEqual(data);
  await expect(first.save(data)).resolves.toBeUndefined();
});
it("detects a truncated body and resumes the bytes that arrived", async () => {
  let attempt = 0;
  network.mockImplementation((_url, init) => {
    const headers = new Headers({ etag: version, "content-length": "6" });
    if (init?.method === "HEAD")
      return Promise.resolve(new Response(null, { headers }));
    if (attempt++ === 0)
      return Promise.resolve(new Response(bytes, { headers }));
    headers.set("content-range", "bytes 3-5/6");
    return Promise.resolve(
      new Response(new Uint8Array([4, 5, 6]), { status: 206, headers }),
    );
  });
  await expect((await open("/model/a")).response.arrayBuffer()).rejects.toThrow(
    "interrupted",
  );
  const next = await open("/model/a");
  expect(next.resumed).toBe(true);
  expect(new Uint8Array(await next.response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4, 5, 6]),
  );
});
