import { afterEach, expect, it, vi } from "vitest";
import { AsyncResultCache } from "./cache";
afterEach(() => vi.useRealTimers());
it("coalesces concurrent identical work and expires model-alias results", async () => {
  vi.useFakeTimers();
  const cache = new AsyncResultCache<number>(2, 100);
  const load = vi.fn(async () => 7);
  expect(
    await Promise.all([
      cache.get("org:model:input", load),
      cache.get("org:model:input", load),
    ]),
  ).toEqual([7, 7]);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.get("other-org:model:input", load);
  vi.advanceTimersByTime(101);
  await cache.get("org:model:input", load);
  expect(load).toHaveBeenCalledTimes(3);
});
it("retries failures and bounds completed entries", async () => {
  const cache = new AsyncResultCache<number>(1);
  await expect(
    cache.get("a", async () => {
      throw Error("provider offline");
    }),
  ).rejects.toThrow();
  expect(await cache.get("a", async () => 1)).toBe(1);
  await cache.get("b", async () => 2);
  expect(await cache.get("a", async () => 3)).toBe(3);
});
