import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { appDevicePlatform, appDeviceType } from "./app-devices";
beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  });
  vi.restoreAllMocks();
});
it("uses a stable profile ID and recovers from invalid saved values", async () => {
  localStorage.setItem("foremanhq.app-device-id", "invalid");
  const { getAppDeviceId } = await import("./app-devices");
  const id = getAppDeviceId();
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  expect(getAppDeviceId()).toBe(id);
  expect(localStorage.getItem("foremanhq.app-device-id")).toBe(id);
});
it("still has a session ID when storage is blocked", async () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw Error("denied");
  });
  const { getAppDeviceId } = await import("./app-devices");
  expect(getAppDeviceId()).toBe(getAppDeviceId());
});
it("recognizes iPad desktop mode and distinguishes Android tablets", () => {
  expect(appDevicePlatform("Macintosh", 5)).toBe("iPad");
  expect(appDeviceType("Macintosh", 5)).toBe("tablet");
  expect(appDeviceType("Android")).toBe("tablet");
  expect(appDeviceType("Android Mobile")).toBe("phone");
});

afterEach(() => vi.unstubAllGlobals());
