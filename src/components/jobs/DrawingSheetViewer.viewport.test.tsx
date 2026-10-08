import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(initialViewport: DrawingViewport | null, height = 500) {
  const onViewportChange = vi.fn();
  const props = {
    src: "/sheet.webp",
    alt: "Sheet",
    sheetKey: "sheet",
    initialViewport,
    onViewportChange,
  };
  const result = render(<DrawingSheetViewer {...props} />);
  const image = screen.getByAltText("Sheet");
  const frame = image.parentElement!.parentElement!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: height },
  });
  Object.defineProperties(frame, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  return { ...result, frame, image, onViewportChange, props };
}
const inherited = { center: { x: 0.3, y: 0.75 }, zoom: 2 };

describe("drawing viewport navigation", () => {
  it.each([
    [500, 320, -200],
    [1000, 240, -300],
  ])(
    "restores zoom and sheet position after an image of height %i loads",
    (height, x, y) => {
      const { image, onViewportChange } = open(inherited, height);
      expect(image.parentElement!.style.transform).toContain(
        `translate3d(${x}px, ${y}px, 0) scale(2)`,
      );
      expect(onViewportChange).toHaveBeenCalledWith(inherited);
      expect(onViewportChange).not.toHaveBeenCalledWith({
        center: { x: 0.5, y: 0.5 },
        zoom: 1,
      });
    },
  );

  it("publishes wheel and pan changes immediately so navigation cannot capture a stale redraw", () => {
    const { frame, onViewportChange } = open(null);
    fireEvent.wheel(frame, { deltaY: -400, clientX: 400, clientY: 300 });
    const zoom = Math.exp(0.6);
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5, y: 0.5 },
      zoom,
    });
    fireEvent.pointerDown(frame, {
      clientX: 400,
      clientY: 300,
      pointerId: 1,
      button: 1,
      buttons: 4,
    });
    fireEvent.pointerMove(frame, {
      clientX: 480,
      clientY: 340,
      pointerId: 1,
      button: 1,
      buttons: 4,
    });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5 - 80 / (800 * zoom), y: 0.5 - 40 / (400 * zoom) },
      zoom,
    });
  });

  it("allows Fit to reset an inherited view and does not reapply it during later renders", () => {
    const { image, rerender, props, onViewportChange } = open(inherited);
    rerender(
      <DrawingSheetViewer
        {...props}
        navigateTo={{ center: { x: 0.5, y: 0.5 }, zoom: 1, requestId: "fit" }}
      />,
    );
    expect(image.parentElement!.style.transform).toContain(
      "translate3d(0px, 0px, 0) scale(1)",
    );
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5, y: 0.5 },
      zoom: 1,
    });
    rerender(<DrawingSheetViewer {...props} />);
    expect(image.parentElement!.style.transform).toContain("scale(1)");
  });
});
