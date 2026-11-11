import { expect, it, vi } from "vitest";
it("deduplicates pending metadata and reuses cached success", async () => {
  vi.resetModules();
  let finish!: (value: unknown) => void;
  const factory = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.doMock("./part-image-layouts.json", factory);
  const resource = await import("./part-image-layout-resource");
  const first = resource.loadPartImageLayouts(),
    second = resource.loadPartImageLayouts();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  finish({ default: {} });
  const map = await first;
  expect(await resource.loadPartImageLayouts()).toBe(map);
  expect(factory).toHaveBeenCalledTimes(1);
});
it("allows a subsequent request after an uncached failure", async () => {
  vi.resetModules();
  vi.doMock("./part-image-layouts.json", () => {
    throw new Error("offline");
  });
  const resource = await import("./part-image-layout-resource");
  await expect(resource.loadPartImageLayouts()).rejects.toThrow();
  expect(resource.cachedPartImageLayouts()).toBeUndefined();
  vi.doMock("./part-image-layouts.json", () => ({ default: {} }));
  await expect(resource.loadPartImageLayouts()).resolves.toEqual({});
});
