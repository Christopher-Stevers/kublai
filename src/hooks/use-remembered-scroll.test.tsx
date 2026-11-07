import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRememberedScroll, useScrollToTop } from "./use-remembered-scroll";
let y = 0;
let height = 6000;
let resized: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  y = 0; height = 6000;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => height });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized = cb; } observe() {} disconnect() {} });
  vi.spyOn(window, "scrollTo").mockImplementation((options) => { y = (options as ScrollToOptions).top ?? 0; window.dispatchEvent(new Event("scroll")); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("restores the last list offset after navigation, keeping jobs separate", () => {
  const hook = renderHook(({ view }: { view: string | null }) => useRememberedScroll(view), { initialProps: { view: "job-a" as string | null } });
  act(() => vi.advanceTimersByTime(20));
  act(() => { y = 1800; window.dispatchEvent(new Event("scroll")); });
  hook.rerender({ view: null });
  y = 0;
  hook.rerender({ view: "job-b" });
  act(() => vi.advanceTimersByTime(20));
  expect(y).toBe(0);
  hook.rerender({ view: "job-a" });
  act(() => vi.advanceTimersByTime(20));
  expect(y).toBe(1800);
  expect(sessionStorage.getItem("foremanhq.scroll:job-a")).toBe("1800");
});
it("waits for asynchronous cards without overwriting the saved offset", () => {
  sessionStorage.setItem("foremanhq.scroll:loading", "2400");
  height = 1000;
  renderHook(() => useRememberedScroll("loading"));
  act(() => vi.advanceTimersByTime(30));
  expect(window.scrollTo).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new Event("scroll")); height = 6000; resized(); });
  expect(y).toBe(2400);
});
it("does not force a delayed restoration after the user starts scrolling", () => {
  sessionStorage.setItem("foremanhq.scroll:interrupted", "2400");
  height = 1000;
  renderHook(() => useRememberedScroll("interrupted"));
  act(() => vi.advanceTimersByTime(30));
  act(() => { window.dispatchEvent(new Event("touchstart")); y = 100; window.dispatchEvent(new Event("scroll")); height = 6000; resized(); vi.advanceTimersByTime(500); });
  expect(y).toBe(100);
  expect(window.scrollTo).not.toHaveBeenCalled();
});
it("restores on remount from session storage once data is ready", () => {
  sessionStorage.setItem("foremanhq.scroll:ready", "1400");
  const hook = renderHook(({ ready }) => useRememberedScroll("ready", ready), { initialProps: { ready: false } });
  act(() => vi.advanceTimersByTime(30));
  expect(window.scrollTo).not.toHaveBeenCalled();
  hook.rerender({ ready: true });
  act(() => vi.advanceTimersByTime(30));
  expect(y).toBe(1400);
});

it("starts the job menu at the top without losing the material list position", () => {
  const hook = renderHook(({ menu }) => {
    useRememberedScroll(menu ? null : "material-only");
    useScrollToTop(menu ? "job-menu" : null);
  }, { initialProps: { menu: false } });
  act(() => vi.advanceTimersByTime(20));
  act(() => { y = 1800; window.dispatchEvent(new Event("scroll")); });
  hook.rerender({ menu: true });
  act(() => vi.advanceTimersByTime(20));
  expect(y).toBe(0);
  act(() => { y = 300; window.dispatchEvent(new Event("scroll")); });
  hook.rerender({ menu: false });
  act(() => vi.advanceTimersByTime(20));
  expect(y).toBe(1800);
  hook.rerender({ menu: true });
  act(() => vi.advanceTimersByTime(20));
  expect(y).toBe(0);
});
