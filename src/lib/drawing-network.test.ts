import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawingLinkSlow,
  noteDrawingTransfer,
  onDrawingLinkChange,
  resetDrawingNetworkForTest,
} from "./drawing-network";

const connection = (value: object | undefined) =>
  Object.defineProperty(navigator, "connection", { value, configurable: true });

describe("drawing connection estimate", () => {
  afterEach(() => {
    resetDrawingNetworkForTest();
    connection(undefined);
  });

  it("is unknown until a drawing download shows the speed", () => {
    expect(drawingLinkSlow()).toBeNull();
    // The browser's estimate reads 4g on a fresh page whatever the signal.
    connection({ effectiveType: "4g", downlink: 10 });
    expect(drawingLinkSlow()).toBeNull();
  });

  it("takes an early warning from the browser", () => {
    connection({ effectiveType: "3g", downlink: 0.7 });
    expect(drawingLinkSlow()).toBe(true);
    connection({ effectiveType: "4g", saveData: true });
    expect(drawingLinkSlow()).toBe(true);
  });

  it("judges by measured downloads, waiting time included", () => {
    const changed = vi.fn();
    onDrawingLinkChange(changed);
    // 76 KB in 1.9 s: a weak signal.
    noteDrawingTransfer(76_000, 1900);
    expect(drawingLinkSlow()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    // A good signal overrules the browser's stale warning.
    resetDrawingNetworkForTest();
    connection({ effectiveType: "3g" });
    noteDrawingTransfer(1_300_000, 900);
    expect(drawingLinkSlow()).toBe(false);
  });

  it("ignores transfers too small to show speed", () => {
    noteDrawingTransfer(119, 800);
    expect(drawingLinkSlow()).toBeNull();
  });
});
