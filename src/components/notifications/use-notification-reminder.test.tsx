import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NOTIFICATION_REMINDER_MS } from "~/lib/app-notifications";
import { useNotificationReminder } from "./use-notification-reminder";

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("rings when unread notifications load and once a minute thereafter", () => {
  const { result, rerender } = renderHook(
    ({ count }) => useNotificationReminder(count, false),
    { initialProps: { count: 0 } },
  );
  expect(result.current).toBe(0);
  rerender({ count: 3 });
  expect(result.current).toBe(1);
  void act(() => vi.advanceTimersByTime(NOTIFICATION_REMINDER_MS));
  expect(result.current).toBe(2);
  rerender({ count: 4 });
  expect(result.current).toBe(3);
});
it("pauses while the window is open, the page is hidden, or there are no unread items", () => {
  const { result, rerender } = renderHook(
    ({ count, open }) => useNotificationReminder(count, open),
    { initialProps: { count: 1, open: false } },
  );
  rerender({ count: 1, open: true });
  void act(() => vi.advanceTimersByTime(NOTIFICATION_REMINDER_MS * 2));
  expect(result.current).toBe(1);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  rerender({ count: 1, open: false });
  void act(() => vi.advanceTimersByTime(NOTIFICATION_REMINDER_MS));
  expect(result.current).toBe(1);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  void act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current).toBe(2);
  rerender({ count: 0, open: false });
  void act(() => vi.advanceTimersByTime(NOTIFICATION_REMINDER_MS * 2));
  expect(result.current).toBe(2);
});
it("cleans up its timer and visibility listener on unmount", () => {
  const remove = vi.spyOn(document, "removeEventListener");
  const { unmount } = renderHook(() => useNotificationReminder(2, false));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});
