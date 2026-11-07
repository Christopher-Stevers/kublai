import { afterEach, expect, it, vi } from "vitest";
import { canWarmInBackground, scheduleBackgroundWork } from "./background-work";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("warms only while idle, yields to gestures, and resumes after offline/data-saving restrictions", async () => {
  vi.useFakeTimers();
  const connection = Object.assign(new EventTarget(), {
    saveData: true,
    effectiveType: "4g",
  });
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: connection,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  const one = vi.fn(async () => undefined),
    two = vi.fn(async () => undefined);
  scheduleBackgroundWork("one", one);
  scheduleBackgroundWork("one", one);
  scheduleBackgroundWork("two", two);
  await vi.advanceTimersByTimeAsync(7000);
  expect(one).not.toHaveBeenCalled();
  connection.saveData = false;
  connection.dispatchEvent(new Event("change"));
  const down = new Event("pointerdown");
  Object.assign(down, { pointerId: 1 });
  window.dispatchEvent(down);
  await vi.advanceTimersByTimeAsync(3000);
  expect(one).not.toHaveBeenCalled();
  const up = new Event("pointerup");
  Object.assign(up, { pointerId: 1 });
  window.dispatchEvent(up);
  await vi.advanceTimersByTimeAsync(1400);
  expect(one).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  expect(one).toHaveBeenCalledOnce();
  connection.effectiveType = "3g";
  await vi.advanceTimersByTimeAsync(5000);
  expect(two).not.toHaveBeenCalled();
  connection.effectiveType = "4g";
  connection.dispatchEvent(new Event("change"));
  await vi.advanceTimersByTimeAsync(500);
  expect(two).toHaveBeenCalledOnce();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  expect(canWarmInBackground()).toBe(false);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  const cancelled = vi.fn(async () => undefined);
  scheduleBackgroundWork("cancel", cancelled)();
  await vi.advanceTimersByTimeAsync(5000);
  expect(cancelled).not.toHaveBeenCalled();
});
