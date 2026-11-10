import { Blob as NativeBlob } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearKeptDrawings,
  keepDrawing,
  keptDrawingBytes,
  mayKeepDrawing,
  readKeptDrawing,
  resetDrawingKeptForTest,
  setDrawingKeptAccount,
} from "./drawing-kept";

const base =
  "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462";
const page = (n: number) => `${base}/pages/${n}.pdf`;
const sheet = (bytes: number) => new Blob([new Uint8Array(bytes).fill(7)]);
const size = async (url: string) => (await readKeptDrawing(url))?.size ?? null;

describe("sheets kept on the device", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("Blob", NativeBlob);
    resetDrawingKeptForTest();
    setDrawingKeptAccount("org:tim");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps an opened sheet and reads it back without the network", async () => {
    expect(await keepDrawing(page(3), sheet(600))).toBe(true);
    expect(await size(page(3))).toBe(600);
    expect(
      await keptDrawingBytes([page(3), `${base}/plan.pdf`, page(4)]),
    ).toEqual([600, null, null]);
  });

  it("is unreadable to another account and while nobody is signed in", async () => {
    await keepDrawing(page(1), sheet(100));
    setDrawingKeptAccount(null);
    expect(mayKeepDrawing(page(1))).toBe(false);
    expect(await size(page(1))).toBeNull();
    expect(await keepDrawing(page(2), sheet(100))).toBe(false);
    setDrawingKeptAccount("org:someone-else");
    expect(await size(page(1))).toBeNull();
    expect(await keptDrawingBytes([page(1)])).toEqual([null]);
    // The same person signing back in still has their sheet.
    setDrawingKeptAccount("org:tim");
    expect(await size(page(1))).toBe(100);
  });

  it("does not hand over a sheet when the account changes during the read", async () => {
    await keepDrawing(page(1), sheet(100));
    const reading = readKeptDrawing(page(1));
    setDrawingKeptAccount("org:someone-else");
    expect(await reading).toBeNull();
  });

  it("keeps only drawing PDFs of this site, never a simulation's", async () => {
    for (const url of [
      `${base}/floor-1.webp`,
      `${base}/pages/index.json`,
      `${page(1)}?token=1`,
      `https://elsewhere.example${page(1)}`,
      "/api/job-documents/files/0391aed4-7773-47ec-9141-09df373ec008",
    ])
      expect(await keepDrawing(url, sheet(10))).toBe(false);
    setDrawingKeptAccount("org:tim:simulation:abc");
    expect(await keepDrawing(page(1), sheet(10))).toBe(false);
  });

  it("makes room by dropping the sheets read longest ago", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const n of [1, 2, 3]) {
      vi.setSystemTime(1_000 * n);
      await keepDrawing(page(n), sheet(400), 1_000);
    }
    // 1 made room for 3. Reading 2 now makes it the newest.
    expect(await keptDrawingBytes([page(1), page(2), page(3)])).toEqual([
      null,
      400,
      400,
    ]);
    vi.setSystemTime(10_000);
    await readKeptDrawing(page(2));
    vi.setSystemTime(11_000);
    await keepDrawing(page(4), sheet(400), 1_000);
    expect(await keptDrawingBytes([page(2), page(3), page(4)])).toEqual([
      400,
      null,
      400,
    ]);
    // A file larger than the whole allowance is not kept at all.
    expect(await keepDrawing(page(5), sheet(2_000), 1_000)).toBe(false);
  });

  it("removes this account's sheets and leaves another's", async () => {
    await keepDrawing(page(1), sheet(100));
    setDrawingKeptAccount("org:other");
    await keepDrawing(page(1), sheet(200));
    await clearKeptDrawings();
    expect(await size(page(1))).toBeNull();
    setDrawingKeptAccount("org:tim");
    expect(await size(page(1))).toBe(100);
  });

  it("keeps nothing, quietly, where the device has no storage", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await keepDrawing(page(1), sheet(100))).toBe(false);
    expect(await size(page(1))).toBeNull();
    expect(await keptDrawingBytes([page(1)])).toEqual([null]);
    await expect(clearKeptDrawings()).resolves.toBeUndefined();
  });
});
