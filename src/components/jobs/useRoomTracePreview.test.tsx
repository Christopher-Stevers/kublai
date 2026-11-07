import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoomShape } from "~/lib/room-shape";
import { useRoomTracePreview } from "./useRoomTracePreview";

const shape: RoomShape = { type: "bbox", x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
function deferred() {
  let resolve!: (result: { shape: RoomShape }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ shape: RoomShape }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("room trace preview", () => {
  it("keeps the latest taps when responses arrive out of order", async () => {
    const first = deferred(),
      second = deferred();
    const execute = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() =>
      useRoomTracePreview("floor-a", execute),
    );
    act(() => {
      void result.current.request("first tap");
    });
    act(() => {
      void result.current.request("second tap");
    });
    const latest: RoomShape = { ...shape, w: 0.6 };
    await act(async () => {
      second.resolve({ shape: latest });
    });
    expect(result.current.shape).toEqual(latest);
    await act(async () => {
      first.resolve({ shape });
    });
    expect(result.current.shape).toEqual(latest);
    expect(result.current.pending).toBe(false);
  });

  it("clears the old preview while a new trace runs and after a failed trace", async () => {
    const next = deferred();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ shape })
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() =>
      useRoomTracePreview("floor-a", execute),
    );
    await act(async () => {
      await result.current.request("first");
    });
    expect(result.current.shape).toEqual(shape);
    act(() => {
      void result.current.request("exclude point");
    });
    expect(result.current.shape).toBeNull();
    expect(result.current.pending).toBe(true);
    await act(async () => {
      next.reject(new Error("No bounded room"));
    });
    expect(result.current.shape).toBeNull();
    expect(result.current.error).toBe("No bounded room");
  });

  it("ignores cancelled replies and old errors during a new session", async () => {
    const first = deferred(),
      second = deferred();
    const execute = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() =>
      useRoomTracePreview("floor-a", execute),
    );
    act(() => {
      void result.current.request("old");
      result.current.cancel();
    });
    act(() => {
      void result.current.request("new session");
    });
    await act(async () => {
      first.reject(new Error("Old error"));
    });
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(true);
    await act(async () => {
      second.resolve({ shape });
    });
    expect(result.current.shape).toEqual(shape);
  });

  it("cannot restore an old floor preview after navigating away and back", async () => {
    const first = deferred();
    const execute = vi.fn().mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(
      ({ floor }) => useRoomTracePreview(floor, execute),
      {
        initialProps: { floor: "floor-a" },
      },
    );
    act(() => {
      void result.current.request("old");
    });
    rerender({ floor: "floor-b" });
    expect(result.current.shape).toBeNull();
    rerender({ floor: "floor-a" });
    await act(async () => {
      first.resolve({ shape });
    });
    expect(result.current.shape).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("invalidates saved-trace completion after Cancel, new taps, and floor navigation", async () => {
    const execute = vi.fn().mockResolvedValue({ shape });
    const { result, rerender } = renderHook(
      ({ floor }) => useRoomTracePreview(floor, execute),
      { initialProps: { floor: "floor-a" } },
    );
    await act(async () => {
      await result.current.request("first");
    });
    const savingFirst = result.current.captureCurrent();
    expect(savingFirst()).toBe(true);
    act(() => {
      result.current.cancel();
    });
    expect(savingFirst()).toBe(false);
    await act(async () => {
      await result.current.request("second session");
    });
    const savingSecond = result.current.captureCurrent();
    await act(async () => {
      await result.current.request("new exclusion");
    });
    expect(savingSecond()).toBe(false);
    const savingThird = result.current.captureCurrent();
    rerender({ floor: "floor-b" });
    rerender({ floor: "floor-a" });
    expect(savingThird()).toBe(false);
    expect(result.current.shape).toBeNull();
  });

  it("invalidates request and save completions on unmount", async () => {
    const late = deferred();
    const { result, unmount } = renderHook(() =>
      useRoomTracePreview("floor-a", () => late.promise),
    );
    act(() => {
      void result.current.request("tap");
    });
    const isCurrent = result.current.captureCurrent();
    unmount();
    await act(async () => {
      late.resolve({ shape });
    });
    expect(isCurrent()).toBe(false);
  });
});
