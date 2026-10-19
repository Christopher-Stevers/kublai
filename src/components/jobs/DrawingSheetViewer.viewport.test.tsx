import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
  const onViewportChange = vi.fn<(viewport: DrawingViewport) => void>();
  const props = {
    src: "/sheet.webp",
    alt: "Sheet",
    sheetKey: "sheet",
    initialViewport,
    onViewportChange,
  };
  const result = render(<DrawingSheetViewer {...props} />);
  const image = within(result.container).getByAltText("Sheet");
  const frame = image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.parentElement!;
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

describe("drawing and document keyboard camera controls", () => {
  it("pans the camera with WASD and zooms about its centre with Q/E", () => {
    const { onViewportChange } = open(null);
    fireEvent.keyDown(window, { key: "w" });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5, y: 0.5 - 64 / 400 },
      zoom: 1,
    });
    fireEvent.keyDown(window, { key: "a" });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5 - 64 / 800, y: 0.5 - 64 / 400 },
      zoom: 1,
    });
    const centre = onViewportChange.mock.lastCall![0].center;
    fireEvent.keyDown(window, { key: "q" });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: centre,
      zoom: 1.15,
    });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "s" });
    fireEvent.keyDown(window, { key: "d" });
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5, y: 0.5 },
      zoom: 1,
    });
  });
  it("supports held keys and enforces existing zoom limits", () => {
    const { onViewportChange } = open(null);
    fireEvent.keyDown(window, { key: "q", repeat: true });
    expect(onViewportChange.mock.lastCall![0].zoom).toBe(1.15);
    for (let i = 0; i < 60; i++)
      fireEvent.keyDown(window, { key: "q", repeat: true });
    expect(onViewportChange.mock.lastCall![0].zoom).toBe(50);
    for (let i = 0; i < 60; i++)
      fireEvent.keyDown(window, { key: "e", repeat: true });
    expect(onViewportChange.mock.lastCall![0].zoom).toBe(1);
  });
  it("does not move sheets while typing, composing or using modifier shortcuts", () => {
    const { frame, onViewportChange } = open(null);
    const input = document.createElement("input");
    frame.append(input);
    onViewportChange.mockClear();
    fireEvent.keyDown(input, { key: "w" });
    fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    fireEvent.keyDown(window, { key: "a", isComposing: true });
    expect(onViewportChange).not.toHaveBeenCalled();
  });
  it("moves only the focused viewer and restores the remaining viewer on unmount", () => {
    const first = open(null),
      second = open(null);
    first.onViewportChange.mockClear();
    second.onViewportChange.mockClear();
    first.frame.focus();
    fireEvent.keyDown(window, { key: "w" });
    expect(first.onViewportChange).toHaveBeenCalledOnce();
    expect(second.onViewportChange).not.toHaveBeenCalled();
    second.frame.focus();
    fireEvent.keyDown(window, { key: "a" });
    expect(second.onViewportChange).toHaveBeenCalledOnce();
    second.unmount();
    fireEvent.keyDown(window, { key: "s" });
    expect(first.onViewportChange).toHaveBeenCalledTimes(2);
  });
  it("leaves a background sheet alone while a dialog is open", () => {
    const { onViewportChange } = open(null);
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    document.body.append(modal);
    onViewportChange.mockClear();
    fireEvent.keyDown(window, { key: "q" });
    expect(onViewportChange).not.toHaveBeenCalled();
    modal.remove();
  });
});

describe("drawing viewport navigation", () => {
  it.each([
    [500, 320, -200],
    [1000, 240, -300],
  ])(
    "restores zoom and sheet position after an image of height %i loads",
    (height, x, y) => {
      const { image, onViewportChange } = open(inherited, height);
      expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain(
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
      pointerType: "mouse",
      button: 1,
      buttons: 4,
    });
    fireEvent.pointerMove(frame, {
      clientX: 480,
      clientY: 340,
      pointerId: 1,
      pointerType: "mouse",
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
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain(
      "translate3d(0px, 0px, 0) scale(1)",
    );
    expect(onViewportChange).toHaveBeenLastCalledWith({
      center: { x: 0.5, y: 0.5 },
      zoom: 1,
    });
    rerender(<DrawingSheetViewer {...props} />);
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("scale(1)");
  });
});

it("lets ordinary wheel movement scroll pages while retaining modifier zoom", () => {
  const { rerender, props, frame, onViewportChange } = open(null);
  rerender(<DrawingSheetViewer {...props} scrollPages />);
  onViewportChange.mockClear();
  fireEvent.wheel(frame, { deltaY: 100, clientX: 400, clientY: 300 });
  expect(onViewportChange).not.toHaveBeenCalled();
  fireEvent.wheel(frame, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
  expect(onViewportChange).toHaveBeenCalled();
});
