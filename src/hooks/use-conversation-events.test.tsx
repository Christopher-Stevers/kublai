import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversationEvents } from "./use-conversation-events";

class Stream extends EventTarget {
  static all: Stream[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    super();
    Stream.all.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown = {}) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Stream);
  Stream.all = [];
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("resyncs on every connection and delivers validated changes", () => {
  const changed = vi.fn();
  const hook = renderHook(() => useConversationEvents(true, changed));
  act(() => Stream.all[0]!.emit("connected"));
  expect(hook.result.current.connected).toBe(true);
  expect(changed).toHaveBeenCalledWith(null);
  const event = {
    changes: [{ conversationId: "a", messageIds: null }],
    removed: [],
  };
  act(() => Stream.all[0]!.emit("conversations-updated", event));
  expect(changed).toHaveBeenLastCalledWith(event);
  act(() => Stream.all[0]!.emit("conversations-updated", { wrong: true }));
  expect(changed).toHaveBeenCalledTimes(2);
  act(() => Stream.all[0]!.onerror?.());
  expect(hook.result.current.connected).toBe(false);
  expect(Stream.all[0]!.closed).toBe(true);
  act(() => {
    vi.advanceTimersByTime(1000);
    Stream.all[1]!.emit("connected");
  });
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(changed).toHaveBeenCalledTimes(3);
});
it("sleeps in the background/offline and cancels reconnect on unmount", () => {
  const changed = vi.fn();
  const hook = renderHook(
    ({ online }) => useConversationEvents(online, changed),
    { initialProps: { online: true } },
  );
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(Stream.all[0]!.closed).toBe(true);
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  expect(Stream.all).toHaveLength(1);
  act(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(Stream.all).toHaveLength(2);
  hook.rerender({ online: false });
  expect(Stream.all[1]!.closed).toBe(true);
  hook.rerender({ online: true });
  act(() => Stream.all[2]!.onerror?.());
  hook.unmount();
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  expect(Stream.all).toHaveLength(3);
});
