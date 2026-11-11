import { IDBFactory } from "fake-indexeddb";
import type * as DrawingOfflineModule from "./drawing-offline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./pdf-client", () => ({ sourcePdfPage: () => null }));
let api: typeof DrawingOfflineModule;
const account = "org:snapshot-reader";
const key = "receiving-order:one";
const protectedKey = `authority-snapshot:${key}`;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  api = await import("./drawing-offline");
  await api.setDrawingOfflineAccount(account);
});
afterEach(async () => {
  await api.setDrawingOfflineAccount(null);
  vi.unstubAllGlobals();
});
it("registers opaque store-local tokens and refuses blind protected APIs even before capture", async () => {
  const store = new api.DrawingOfflineStore(account),
    other = new api.DrawingOfflineStore(account);
  await expect(
    store.saveSnapshot(protectedKey, { stale: true }),
  ).rejects.toThrow(/authority/);
  await expect(store.readSnapshot(protectedKey)).rejects.toThrow(/authority/);
  const token = await store.captureSnapshotAuthority(key);
  await store.saveSnapshotWithAuthority(token, { name: "saved reading" });
  expect(await store.readSnapshotWithAuthority(token)).toEqual({
    name: "saved reading",
  });
  await expect(other.readSnapshotWithAuthority(token)).rejects.toThrow();
  await expect(
    store.saveSnapshotWithAuthority({ ...token }, { forged: true }),
  ).rejects.toThrow();
  await store.saveSnapshot("ordinary", { untouched: true });
  expect(await store.readSnapshot("ordinary")).toEqual({ untouched: true });
});
it("revokes only one key across two stores and rejects a late HTTP result", async () => {
  const store = new api.DrawingOfflineStore(account),
    second = new api.DrawingOfflineStore(account);
  const old = await store.captureSnapshotAuthority(key),
    oldSecond = await second.captureSnapshotAuthority(key);
  const unrelated = await store.captureSnapshotAuthority("receiving-order:two");
  await store.saveSnapshotWithAuthority(old, { name: "old" });
  await store.saveSnapshotWithAuthority(unrelated, { name: "other order" });
  await store.saveSnapshot("ordinary", { preserved: true });
  let release!: (value: { name: string }) => void;
  const response = new Promise<{ name: string }>((yes) => {
    release = yes;
  });
  const late = response.then((value) =>
    second.saveSnapshotWithAuthority(oldSecond, value),
  );
  const rejected = expect(late).rejects.toThrow();
  expect(await store.revokeSnapshot(old)).toBe(true);
  release({ name: "late HTTP" });
  await rejected;
  await expect(second.readSnapshotWithAuthority(oldSecond)).rejects.toThrow();
  expect(await store.readSnapshotWithAuthority(unrelated)).toEqual({
    name: "other order",
  });
  expect(await store.readSnapshot("ordinary")).toEqual({ preserved: true });
  const fresh = await second.captureSnapshotAuthority(key);
  expect(await second.readSnapshotWithAuthority(fresh)).toBeNull();
  await second.saveSnapshotWithAuthority(fresh, { name: "new accepted read" });
  expect(await store.revokeSnapshot(old)).toBe(false);
  expect(await second.readSnapshotWithAuthority(fresh)).toEqual({
    name: "new accepted read",
  });
});
it("fences an independent context and reload without delivering storage events", async () => {
  const store = new api.DrawingOfflineStore(account),
    token = await store.captureSnapshotAuthority(key);
  await store.saveSnapshotWithAuthority(token, { private: "old" });
  vi.resetModules();
  const context = await import("./drawing-offline");
  await context.setDrawingOfflineAccount(account);
  const stale = new context.DrawingOfflineStore(account),
    staleToken = await stale.captureSnapshotAuthority(key);
  expect(await store.revokeSnapshot(token)).toBe(true);
  await expect(
    stale.saveSnapshotWithAuthority(staleToken, { resurrected: true }),
  ).rejects.toThrow();
  await expect(stale.readSnapshotWithAuthority(staleToken)).rejects.toThrow();
  vi.resetModules();
  const reload = await import("./drawing-offline");
  await reload.setDrawingOfflineAccount(account);
  const fresh = new reload.DrawingOfflineStore(account),
    freshToken = await fresh.captureSnapshotAuthority(key);
  expect(await fresh.readSnapshotWithAuthority(freshToken)).toBeNull();
  await fresh.saveSnapshotWithAuthority(freshToken, { private: "new" });
  expect(await stale.revokeSnapshot(staleToken)).toBe(false);
  expect(await fresh.readSnapshotWithAuthority(freshToken)).toEqual({
    private: "new",
  });
  await context.setDrawingOfflineAccount(null);
  await reload.setDrawingOfflineAccount(null);
});
it("couples tokens to account clear, disposal and A to B to A lifecycle", async () => {
  const store = new api.DrawingOfflineStore(account),
    token = await store.captureSnapshotAuthority(key);
  await store.saveSnapshotWithAuthority(token, { name: "before clear" });
  await store.clear();
  await expect(
    store.saveSnapshotWithAuthority(token, { late: true }),
  ).rejects.toThrow();
  expect(await store.revokeSnapshot(token)).toBe(false);
  const afterClear = await store.captureSnapshotAuthority(key);
  expect(await store.readSnapshotWithAuthority(afterClear)).toBeNull();
  await store.saveSnapshotWithAuthority(afterClear, { name: "after clear" });
  await api.setDrawingOfflineAccount("org:other");
  await api.setDrawingOfflineAccount(account);
  const fresh = new api.DrawingOfflineStore(account),
    afterReturn = await fresh.captureSnapshotAuthority(key);
  await expect(store.readSnapshotWithAuthority(afterClear)).rejects.toThrow();
  expect(await store.revokeSnapshot(afterClear)).toBe(false);
  expect(await fresh.readSnapshotWithAuthority(afterReturn)).toEqual({
    name: "after clear",
  });
  fresh.dispose();
  await expect(
    fresh.saveSnapshotWithAuthority(afterReturn, { late: true }),
  ).rejects.toThrow();
});
