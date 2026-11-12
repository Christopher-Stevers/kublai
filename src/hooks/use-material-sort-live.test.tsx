import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMaterialSortLive } from "./use-material-sort-live";
const mocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    status: (v: boolean) => void;
    preferencesReady: (v: boolean) => void;
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
  await act(async () => {
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
  await act(async () => {
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

it("requires topic-ready plus successful HTTP catchup and loses health immediately", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  const refresh = vi.fn().mockResolvedValue({ isSuccess: true });
  const { result } = renderHook(() =>
    useMaterialSortLive(true, "org:crew", refresh),
  );
  const listener = mocks.listeners[0]! as (typeof mocks.listeners)[number] & {
    preferencesReady: (value: boolean) => void;
  };
  act(() => {
    listener.status(true);
    listener.catchUp();
  });
  expect(result.current).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
  });
  expect(result.current).toBe(false);
  act(() => listener.preferencesReady(true));
  expect(result.current).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
  });
  expect(result.current).toBe(true);
  act(() => listener.preferencesReady(false));
  expect(result.current).toBe(false);
});

it("restores fallback after a rejected refresh and recovers on the next hint", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  const refresh = vi.fn()
    .mockResolvedValueOnce({ isSuccess: true })
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue({ isSuccess: true });
  const { result } = renderHook(() =>
    useMaterialSortLive(true, "org:crew", refresh),
  );
  const listener = mocks.listeners[0]!;
  await act(async () => {
    listener.status(true);
    listener.preferencesReady(true);
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(true);
  await act(async () => {
    listener.hint({ topic: "preferences" });
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(false);
  await act(async () => {
    listener.hint({ topic: "preferences" });
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("contains synchronous refresh failure and releases its busy latch", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  const refresh = vi.fn()
    .mockResolvedValueOnce({ isSuccess: true })
    .mockImplementationOnce(() => { throw new Error("Refresh unavailable"); })
    .mockResolvedValue({ isSuccess: true });
  const { result } = renderHook(() =>
    useMaterialSortLive(true, "org:crew", refresh),
  );
  const listener = mocks.listeners[0]!;
  await act(async () => {
    listener.status(true);
    listener.preferencesReady(true);
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(true);
  await act(async () => {
    listener.hint({ topic: "preferences" });
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(false);
  await act(async () => {
    listener.hint({ topic: "preferences" });
    vi.advanceTimersByTime(100);
  });
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(result.current).toBe(true);
});

it("does not dispatch a queued refresh after the page becomes inactive", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  const refresh = vi.fn().mockResolvedValue({ isSuccess: true });
  renderHook(() => useMaterialSortLive(true, "org:crew", refresh));
  const listener = mocks.listeners[0]!;
  await act(async () => {
    listener.status(true);
    listener.preferencesReady(true);
    vi.advanceTimersByTime(100);
    mocks.active = false;
  });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    mocks.active = true;
    listener.catchUp();
    vi.advanceTimersByTime(100);
  });
  expect(refresh).toHaveBeenCalledOnce();
});

it("ignores an old account's rejected refresh after the replacement catches up", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  let rejectOld!: (error: Error) => void;
  const refresh = vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectOld = reject;
    }))
    .mockResolvedValue({ isSuccess: true });
  const { result, rerender } = renderHook(
    ({ account }) => useMaterialSortLive(true, account, refresh),
    { initialProps: { account: "org:a" } },
  );
  await act(async () => {
    const old = mocks.listeners[0]!;
    old.status(true);
    old.preferencesReady(true);
    vi.advanceTimersByTime(100);
  });
  rerender({ account: "org:b" });
  await act(async () => {
    const next = mocks.listeners[1]!;
    next.status(true);
    next.preferencesReady(true);
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(true);
  await act(async () => { rejectOld(new Error("Old request failed")); });
  expect(result.current).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(2);
});
