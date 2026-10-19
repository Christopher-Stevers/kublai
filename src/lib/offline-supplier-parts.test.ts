import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
});
it("parses once per storage version, then invalidates on another tab's update", async () => {
  window.localStorage.setItem(
    "foremanhq.offline.supplier-parts-by-part",
    JSON.stringify({ version: 2, data: { a: [] } }),
  );
  const get = vi.spyOn(window.localStorage, "getItem");
  const { getOfflineSupplierPartsByPart } =
    await import("./offline-supplier-parts");
  expect(getOfflineSupplierPartsByPart("a")).toEqual([]);
  for (let i = 0; i < 100; i++) getOfflineSupplierPartsByPart("a");
  expect(get).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "foremanhq.offline.supplier-parts-by-part",
    }),
  );
  getOfflineSupplierPartsByPart("a");
  expect(get).toHaveBeenCalledTimes(2);
});
it("storage denial preserves a usable session cache", async () => {
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw Error("Denied");
  });
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw Error("Quota");
  });
  const { getOfflineSupplierPartsByPart, setOfflineSupplierPartsByPart } =
    await import("./offline-supplier-parts");
  expect(getOfflineSupplierPartsByPart("a")).toBeNull();
  expect(() => setOfflineSupplierPartsByPart("a", [])).not.toThrow();
  expect(getOfflineSupplierPartsByPart("a")).toEqual([]);
});

it("discards pre-consolidation cached listings", async () => {
  window.localStorage.setItem("foremanhq.offline.supplier-parts-by-part", JSON.stringify({version:1,data:{part:[{id:"removed-listing"}]}}));
  const {getOfflineSupplierPartsByPart,setOfflineSupplierPartsByPart}=await import("./offline-supplier-parts");
  expect(getOfflineSupplierPartsByPart("part")).toBeNull();
  setOfflineSupplierPartsByPart("part",[]);
  expect(JSON.parse(window.localStorage.getItem("foremanhq.offline.supplier-parts-by-part")!).version).toBe(2);
});
