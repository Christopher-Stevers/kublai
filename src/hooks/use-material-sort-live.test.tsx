import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMaterialSortLive } from "./use-material-sort-live";
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    status: (v: boolean) => void;
    catchUp: () => void;
    hint: (h: unknown) => void;
  }>,
  stop: vi.fn(),
  active: true,
}));
vi.mock("~/lib/live-client", () => ({
  subscribeLiveEvents: vi.fn(
    (_options: unknown, listener: (typeof mocks.listeners)[number]) => {
      mocks.listeners.push(listener);
      return mocks.stop;
    },
  ),
}));
vi.mock("~/lib/app-page-activity", () => ({
  isAppPageActive: () => mocks.active,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.listeners = [];
  mocks.stop.mockClear();
  mocks.active = true;
});
it("coalesces connect and hint bursts, with one trailing authoritative read while busy", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  let resolve!: () => void;
  const refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(undefined);
  renderHook(() => useMaterialSortLive(true, "org:crew", refresh));
  const l = mocks.listeners[0]!;
  act(() => {
    l.status(true);
    l.catchUp();
    l.hint({ topic: "preferences" });
    vi.advanceTimersByTime(100);
  });
  expect(refresh).toHaveBeenCalledOnce();
  act(() => {
    l.hint({ topic: "preferences" });
    l.catchUp();
    vi.advanceTimersByTime(100);
  });
  expect(refresh).toHaveBeenCalledOnce();
  await act(async () => {
    resolve();
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("cancels queued reads and fences old callbacks on account change and disconnect", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    ({ account }) => useMaterialSortLive(true, account, refresh),
    { initialProps: { account: "org:a" } },
  );
  const old = mocks.listeners[0]!;
  act(() => {
    old.status(true);
    old.catchUp();
  });
  rerender({ account: "org:b" });
  act(() => {
    old.catchUp();
    vi.advanceTimersByTime(100);
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledOnce();
  const next = mocks.listeners[1]!;
  act(() => {
    next.status(true);
    next.catchUp();
    next.status(false);
    vi.advanceTimersByTime(100);
  });
  expect(refresh).not.toHaveBeenCalled();
});
