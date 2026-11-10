import { Blob as NativeBlob } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  collectDrawingOfflineUrls,
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "./drawing-offline";

const first =
  "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462/floor-1.webp";
const second = first.replace("floor-1", "floor-2");
const fetchMock = vi.fn<typeof fetch>();
const revoke = vi.fn();
beforeAll(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:private-preview";
      }
      static revokeObjectURL = revoke;
    },
  );
});
beforeEach(async () => {
  await setDrawingOfflineAccount(null);
  fetchMock.mockReset().mockImplementation(
    async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "Content-Type": "image/webp", "Content-Length": "4" },
      }),
  );
  revoke.mockClear();
  await setDrawingOfflineAccount("org:alice");
  await new DrawingOfflineStore("org:alice").clear();
});
afterEach(async () => {
  await setDrawingOfflineAccount(null);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("explicit account-scoped drawing downloads", () => {
  it("preserves exact bytes and snapshots across store instances, deduplicating source URLs", async () => {
    const store = new DrawingOfflineStore("org:alice");
    const progress = vi.fn();
    await store.saveAssets([first, first, second], { onProgress: progress });
    await store.saveSnapshot("job", { name: "Floor one", markups: ["note"] });
    store.dispose();
    const reopened = new DrawingOfflineStore("org:alice");
    expect(await reopened.summary()).toEqual({ files: 2, bytes: 8 });
    expect([
      ...new Uint8Array(await (await reopened.readAsset(first))!.arrayBuffer()),
    ]).toEqual([1, 2, 3, 4]);
    expect(await reopened.readSnapshot("job")).toEqual({
      name: "Floor one",
      markups: ["note"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith({
      completed: 2,
      total: 2,
      bytes: 8,
      url: second,
    });
  });

  it("enforces total byte budget and retains completed assets after a partial failure", async () => {
    const store = new DrawingOfflineStore("org:alice");
    await expect(
      store.saveAssets([first, second], { budgetBytes: 6 }),
    ).rejects.toThrow(/limit/);
    expect(await store.summary()).toEqual({ files: 1, bytes: 4 });
    expect(await store.readAsset(second)).toBeNull();
  });

  it("saves multiple sets beyond the old 32 MB metadata cap and replaces records", async () => {
    const store = new DrawingOfflineStore("org:alice");
    const large = "a".repeat(7 * 1024 * 1024);
    await Promise.all(["one", "two", "three", "four", "five"].map(key => store.saveSnapshot(key, large)));
    expect(await store.readSnapshot("five")).toBe(large);
    await store.saveSnapshot("one", "replaced");
    expect(await store.readSnapshot("one")).toBe("replaced");
  });

  it("allows more than 512 saved workspace records", async () => {
    const store = new DrawingOfflineStore("org:alice");
    await Promise.all(Array.from({length: 520}, (_, i) => store.saveSnapshot(`workspace-${i}`, {sheet: i})));
    expect(await store.readSnapshot("workspace-519")).toEqual({sheet: 519});
  });

  it("enforces the budget while streaming even without a Content-Length header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(12)));
    const store = new DrawingOfflineStore("org:alice");
    await expect(store.saveAssets([first], { budgetBytes: 6 })).rejects.toThrow(
      /limit/,
    );
    expect(await store.summary()).toEqual({ files: 0, bytes: 0 });
  });

  it("does not write an asset after cancellation during the transfer", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return new Response(new Uint8Array([1]));
    });
    const store = new DrawingOfflineStore("org:alice");
    await expect(
      store.saveAssets([first], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await store.readAsset(first)).toBeNull();
  });

  it("revokes access while retaining private files for the same authenticated account", async () => {
    const old = new DrawingOfflineStore("org:alice");
    await old.saveAssets([first]);
    await old.saveSnapshot("job", { private: "Alice" });
    expect(await old.resolveAssetUrl(first)).toBe("blob:private-preview");
    await setDrawingOfflineAccount("org:bob");
    expect(revoke).toHaveBeenCalledWith("blob:private-preview");
    await expect(old.readAsset(first)).rejects.toMatchObject({
      name: "AbortError",
    });
    const next = new DrawingOfflineStore("org:bob");
    expect(await next.readAsset(first)).toBeNull();
    expect(await next.readSnapshot("job")).toBeNull();
    expect(() => new DrawingOfflineStore("org:alice")).toThrow(/Sign in/);
    await setDrawingOfflineAccount("org:alice");
    expect(
      await new DrawingOfflineStore("org:alice").readAsset(first),
    ).not.toBeNull();
  });

  it("preserves the actor's normal downloads across isolated simulation sessions", async () => {
    const normal = new DrawingOfflineStore("org:alice");
    await normal.saveAssets([first]);
    await normal.saveSnapshot("job", { private: "Alice" });
    await setDrawingOfflineAccount("org:bob:simulation:one", "org:alice");
    const simulation = new DrawingOfflineStore("org:bob:simulation:one");
    expect(await simulation.readAsset(first)).toBeNull();
    expect(await simulation.readSnapshot("job")).toBeNull();
    expect(() => new DrawingOfflineStore("org:alice")).toThrow(/Sign in/);
    await expect(normal.readAsset(first)).rejects.toMatchObject({ name: "AbortError" });
    await setDrawingOfflineAccount("org:bob:simulation:two", "org:alice");
    await setDrawingOfflineAccount("org:alice");
    const restored = new DrawingOfflineStore("org:alice");
    expect(await restored.readAsset(first)).not.toBeNull();
    expect(await restored.readSnapshot("job")).toEqual({ private: "Alice" });
    await setDrawingOfflineAccount(null);
    await setDrawingOfflineAccount("org:alice");
    expect(await new DrawingOfflineStore("org:alice").readAsset(first)).not.toBeNull();
  });

  it("cannot restore a download after logout while its network response was pending", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockReturnValueOnce(pending);
    const store = new DrawingOfflineStore("org:alice");
    const saved = store.saveAssets([first]);
    const failed = expect(saved).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await setDrawingOfflineAccount(null);
    release(new Response(new Uint8Array([1])));
    await failed;
    await setDrawingOfflineAccount("org:alice");
    expect(
      await new DrawingOfflineStore("org:alice").readAsset(first),
    ).toBeNull();
  });

  it("treats cross-tab identity messages as revocation, never authentication", async () => {
    const store = new DrawingOfflineStore("org:alice");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "foremanhq-drawing-account-signal-v1",
        newValue: JSON.stringify({ account: "org:bob" }),
      }),
    );
    await expect(store.summary()).rejects.toMatchObject({ name: "AbortError" });
    expect(() => new DrawingOfflineStore("org:bob")).toThrow(/Sign in/);
  });

  it("rejects external URLs and unauthorized responses instead of persisting them", async () => {
    const store = new DrawingOfflineStore("org:alice");
    await expect(
      store.saveAssets(["https://external.example/private.pdf"]),
    ).rejects.toThrow(/Only/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(store.saveAssets([first])).rejects.toThrow(/401/);
    expect(await store.summary()).toEqual({ files: 0, bytes: 0 });
  });

  it("collects shared originals once and includes tiles only when requested", async () => {
    expect(await collectDrawingOfflineUrls([first, second])).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        version: 1,
        tileSize: 512,
        levels: [{ factor: 2, width: 1024, height: 512 }],
      }),
    );
    const urls = await collectDrawingOfflineUrls([first], {
      includeTiles: true,
    });
    expect(urls).toHaveLength(5);
    expect(urls.some((url) => url.endsWith("/2/1_0.webp"))).toBe(true);
  });
});

it("retains immutable document PDF pages privately across reopen and clears them on account change", async () => {
  const version = "0391aed4-7773-47ec-9141-09df373ec008";
  const job = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";
  const page = `/api/job-documents/pages/${version}/2?jobId=${job}`;
  const original = `/api/job-documents/files/${version}?jobId=${job}`;
  const store = new DrawingOfflineStore("org:alice");
  const urls = await collectDrawingOfflineUrls([page]);
  expect(urls).toEqual([page, original]);
  await store.saveAssets(urls);
  store.dispose();
  const reopened = new DrawingOfflineStore("org:alice");
  expect(await reopened.readAsset(original)).not.toBeNull();
  expect(await reopened.resolveAssetUrl(page)).toMatch(/^blob:/);
  for (const url of [original + "&token=secret", original.replace("?jobId=", "?other="), `/api/job-documents/editor?jobId=${job}`, `https://other.test${page}`])
    await expect(reopened.saveAssets([url])).rejects.toThrow(/Only this account/);
  await setDrawingOfflineAccount("org:bob");
  const bob = new DrawingOfflineStore("org:bob");
  expect(await bob.readAsset(original)).toBeNull();
  await expect(reopened.readAsset(original)).rejects.toMatchObject({ name: "AbortError" });
});
