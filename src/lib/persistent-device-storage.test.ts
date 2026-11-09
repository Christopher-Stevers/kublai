import { afterEach, expect, it, vi } from "vitest";
import { requestPersistentDeviceStorage } from "./persistent-device-storage";
afterEach(() => vi.unstubAllGlobals());
it("requests persistence and shares simultaneous requests", async () => {
  const persist = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });
  const results = await Promise.all([requestPersistentDeviceStorage(), requestPersistentDeviceStorage()]);
  expect(results).toEqual([true, true]);
  expect(persist).toHaveBeenCalledOnce();
});
it("does not ask again when the browser already protects storage", async () => {
  const persist = vi.fn();
  vi.stubGlobal("navigator", { storage: { persisted: async () => true, persist } });
  expect(await requestPersistentDeviceStorage()).toBe(true);
  expect(persist).not.toHaveBeenCalled();
});
it("allows a later download to request again after denial", async () => {
  const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.stubGlobal("navigator", { storage: { persist } });
  expect(await requestPersistentDeviceStorage()).toBe(false);
  expect(await requestPersistentDeviceStorage()).toBe(true);
});
it("tolerates unsupported storage and permission failures", async () => {
  vi.stubGlobal("navigator", {});
  expect(await requestPersistentDeviceStorage()).toBe(false);
  vi.stubGlobal("navigator", { storage: { persist: async () => { throw Error("denied"); } } });
  expect(await requestPersistentDeviceStorage()).toBe(false);
});
