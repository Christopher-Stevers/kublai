import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runHeaderBackOverride,
  useHeaderBackOverride,
} from "./header-back-events";

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const isGuard = () =>
  Boolean(
    (window.history.state as Record<string, unknown> | null)
      ?.foremenhqBackGuard,
  );
const systemBack = async () => {
  // jsdom's history.back() is async; emulate the browser popping the guard.
  window.history.replaceState({ page: "under" }, "");
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state as unknown }),
  );
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
  vi.unstubAllGlobals();
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
      useHeaderBackOverride(
        open
          ? () => {
              open = false;
            }
          : null,
      ),
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
      useHeaderBackOverride(
        open
          ? () => {
              open = false;
            }
          : null,
      ),
    );
    await tick();
    expect(push).toHaveBeenCalledTimes(1);
    act(() => {
      window.history.replaceState({ page: "under" }, "");
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: window.history.state as unknown,
        }),
      );
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

describe("Android native Back from a fresh launch", () => {
  function android() {
    const watchers: Array<EventTarget & { destroy: ReturnType<typeof vi.fn> }> =
      [];
    class Watcher extends EventTarget {
      destroy = vi.fn();
      constructor() {
        super();
        watchers.push(this);
      }
    }
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 15)",
    );
    vi.stubGlobal("CloseWatcher", Watcher);
    return watchers;
  }
  it("handles repeated native requests without prior taps or browser history, one parent per request", async () => {
    const watchers = android();
    const push = vi.spyOn(window.history, "pushState");
    const parents = ["set", "drawings", "job", "jobs"];
    let level = 0;
    const navigate = vi.fn(() => {
      level++;
    });
    const hook = renderHook(() =>
      useHeaderBackOverride(level < parents.length ? navigate : null),
    );
    await tick();
    for (let i = 0; i < parents.length; i++) {
      expect(watchers).toHaveLength(i + 1);
      act(() => {
        watchers[i]!.dispatchEvent(new Event("close"));
        hook.rerender();
      });
      await tick();
      expect(navigate).toHaveBeenCalledTimes(i + 1);
      expect(level).toBe(i + 1);
    }
    expect(push).not.toHaveBeenCalled();
    expect(watchers).toHaveLength(4); // Jobs has no parent; no close trap remains.
  });
  it("uses only one watcher and the latest highest-priority screen when parents mount later", async () => {
    const watchers = android();
    const child = vi.fn(),
      parent = vi.fn();
    const nested = renderHook(() => useHeaderBackOverride(child));
    renderHook(() => useHeaderBackOverride(parent, { priority: -100 }));
    await tick();
    expect(watchers).toHaveLength(1);
    act(() => watchers[0]!.dispatchEvent(new Event("close")));
    expect(child).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    nested.unmount();
    await tick();
    act(() => watchers[1]!.dispatchEvent(new Event("close")));
    expect(parent).toHaveBeenCalledOnce();
  });
  it("destroys the watcher on teardown and ignores late close events", async () => {
    const watchers = android();
    const handler = vi.fn();
    const hook = renderHook(() => useHeaderBackOverride(handler));
    await tick();
    hook.unmount();
    await tick();
    expect(watchers[0]!.destroy).toHaveBeenCalledOnce();
    act(() => watchers[0]!.dispatchEvent(new Event("close")));
    expect(handler).not.toHaveBeenCalled();
  });
  it("falls back to history when the native constructor fails", async () => {
    android();
    vi.stubGlobal(
      "CloseWatcher",
      class {
        constructor() {
          throw new Error("Unavailable");
        }
      },
    );
    const handler = vi.fn();
    renderHook(() => useHeaderBackOverride(handler));
    await tick();
    expect(isGuard()).toBe(true);
    await systemBack();
    expect(handler).toHaveBeenCalledOnce();
  });
});

it("clears an inherited guard marker before adding the fallback sentinel", async () => {
  window.history.replaceState(
    { __NA: true, foremenhqBackGuard: true, page: "restored" },
    "",
  );
  const handler = vi.fn();
  renderHook(() => useHeaderBackOverride(handler));
  await tick();
  act(() => window.history.back());
  await tick();
  await tick();
  expect(handler).toHaveBeenCalledOnce();
  expect(window.history.state.__NA).toBe(true);
});
