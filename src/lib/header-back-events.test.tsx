import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHeaderBackOverride, useHeaderBackOverride } from "./header-back-events";

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const isGuard = () => Boolean((window.history.state as Record<string, unknown> | null)?.foremenhqBackGuard);
const systemBack = async () => {
  // jsdom's history.back() is async; emulate the browser popping the guard.
  window.history.replaceState({ page: "under" }, "");
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state as unknown }));
  await tick();
};

afterEach(async () => {
  // Unmount and let the guard settle so module state starts clean.
  vi.spyOn(window.history, "back").mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  cleanup();
  await tick();
  vi.restoreAllMocks();
});


describe("useHeaderBackOverride", () => {
  it("lets the newest active screen take the back arrow, and releases it", () => {
    expect(runHeaderBackOverride()).toBe(false);
    const outer = vi.fn();
    const inner = vi.fn();
    const first = renderHook(({ handler }) => useHeaderBackOverride(handler), {
      initialProps: { handler: outer as (() => void) | null },
    });
    const second = renderHook(({ handler }) => useHeaderBackOverride(handler), {
      initialProps: { handler: inner as (() => void) | null },
    });
    expect(runHeaderBackOverride()).toBe(true);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();

    // Passing null (e.g. the floor plan closed) hands the arrow back.
    second.rerender({ handler: null });
    expect(runHeaderBackOverride()).toBe(true);
    expect(outer).toHaveBeenCalledOnce();

    first.unmount();
    second.unmount();
    expect(runHeaderBackOverride()).toBe(false);
  });

  it("calls the latest handler without re-registering", () => {
    const a = vi.fn();
    const b = vi.fn();
    const view = renderHook(({ handler }) => useHeaderBackOverride(handler), {
      initialProps: { handler: a },
    });
    view.rerender({ handler: b });
    runHeaderBackOverride();
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe("useHeaderBackOverride and the phone's back", () => {
  it("adds a guard entry, routes system back to the handler, and re-arms while still open", async () => {
    window.history.replaceState({ page: "screen" }, "");
    const handler = vi.fn();
    const push = vi.spyOn(window.history, "pushState");
    renderHook(() => useHeaderBackOverride(handler));
    await tick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(isGuard()).toBe(true);
    expect(window.history.state.page).toBe("screen");

    await systemBack();
    expect(handler).toHaveBeenCalledTimes(1);
    // The screen is still open, so back is caught again next time.
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("removes its guard when the screen closes from the app bar arrow", async () => {
    window.history.replaceState({ page: "screen" }, "");
    let open = true;
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = renderHook(() =>
      useHeaderBackOverride(open ? () => { open = false; } : null),
    );
    await tick();
    expect(isGuard()).toBe(true);
    expect(runHeaderBackOverride()).toBe(true);
    rerender();
    await tick();
    expect(back).not.toHaveBeenCalled();
    expect(isGuard()).toBe(false);
    expect(runHeaderBackOverride()).toBe(false);
  });

  it("does not re-add a guard after system back closes the screen", async () => {
    window.history.replaceState({ page: "screen" }, "");
    let open = true;
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = renderHook(() =>
      useHeaderBackOverride(open ? () => { open = false; } : null),
    );
    await tick();
    expect(push).toHaveBeenCalledTimes(1);
    act(() => {
      window.history.replaceState({ page: "under" }, "");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state as unknown }));
      rerender();
    });
    await tick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});


it("gives nested screens priority even when a parent mounts later", () => {
  const child = vi.fn();
  const parent = vi.fn();
  renderHook(() => useHeaderBackOverride(child));
  renderHook(() => useHeaderBackOverride(parent, { priority: -100 }));
  runHeaderBackOverride();
  expect(child).toHaveBeenCalledOnce();
  expect(parent).not.toHaveBeenCalled();
});
