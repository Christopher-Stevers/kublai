import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runHeaderBackOverride, useHeaderBackOverride } from "./header-back-events";

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
