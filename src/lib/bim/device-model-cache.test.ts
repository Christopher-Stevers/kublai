// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { deviceModelDownload } from "./device-model-cache";

const bytes = new Uint8Array([1, 2, 3]);
let version = '"v1"';
let status = 200;
const network = vi.fn((_url: string, init?: RequestInit) =>
  Promise.resolve(
    new Response(init?.method === "HEAD" ? null : bytes, {
      status,
      headers: { etag: version },
    }),
  ),
);
const open = (url: string) =>
  deviceModelDownload(url, new AbortController().signal, true);
beforeEach(() => {
  version = '"v1"';
  status = 200;
  network.mockClear();
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
