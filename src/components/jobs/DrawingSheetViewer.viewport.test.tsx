import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import { SCROLL_PAGE_GAP } from "./drawing-scroll-pages";

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
    expect(onViewportChange.mock.lastCall![0].zoom).toBe(0.1);
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

it("scrolls through the pages either side with the wheel and opens the one it settles on, keeping the zoom", () => {
  vi.useFakeTimers();
  const { rerender, props, frame, onViewportChange, container } = open(null);
  const onPage = vi.fn<(offset: number, viewport: DrawingViewport) => void>();
  const page = (n: number) => ({ id: String(n), name: `Page ${n}`, imageUrl: `/${n}.webp`, width: 1000, height: 500 });
  rerender(<DrawingSheetViewer {...props} scrollPages scrollStack={{ previous: [], next: [page(1), page(2)], onPage }} />);
  expect(frame.style.touchAction).toBe("none");
  // Fit is 800 by 400; the next page starts a short gap below.
  const next = within(container).getByAltText("Page 1").closest<HTMLElement>("[data-drawing-scroll-page]")!;
  expect(next.style.top).toBe(`${200 + 200 + SCROLL_PAGE_GAP}px`);
  expect(next.style.height).toBe("400px");
  expect(next.style.maskImage).toBe("");
  fireEvent.wheel(frame, { deltaY: 100, clientX: 400, clientY: 300 });
  void act(() => vi.advanceTimersByTime(20));
  expect(next.style.maskImage).toBe("");
  expect(onPage).not.toHaveBeenCalled();
  // The first page rests against the top of the frame.
  expect(onViewportChange).toHaveBeenLastCalledWith({ center: { x: 0.5, y: 0.75 }, zoom: 1 });
  fireEvent.wheel(frame, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
  const zoom = onViewportChange.mock.lastCall![0].zoom;
  expect(zoom).toBeGreaterThan(1);
  fireEvent.wheel(frame, { deltaY: 400, clientX: 400, clientY: 300 });
  expect(onPage).not.toHaveBeenCalled();
  void act(() => vi.advanceTimersByTime(20));
  expect(next.style.maskImage).toBe("");
  expect(onPage).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(onPage).toHaveBeenCalledOnce();
  const [offset, viewport] = onPage.mock.lastCall!;
  expect(offset).toBe(1);
  expect(viewport.zoom).toBe(zoom);
  expect(viewport.center.y).toBeGreaterThan(0);
  expect(viewport.center.y).toBeLessThan(1);
  vi.useRealTimers();
});

it("zooms continuous pages below fit without jumping away from the first sheet", () => {
  vi.useFakeTimers();
  const { rerender, props, frame, onViewportChange } = open(null);
  const onPage = vi.fn<(offset: number, viewport: DrawingViewport) => void>();
  rerender(<DrawingSheetViewer {...props} scrollPages scrollStack={{ previous: [], next: [{ id: "next", name: "Next", imageUrl: "/next.webp", width: 1000, height: 500 }], onPage }} />);
  fireEvent.wheel(frame, { deltaY: 4000, ctrlKey: true, clientX: 400, clientY: 300 });
  void act(() => vi.advanceTimersByTime(120));
  expect(onViewportChange.mock.lastCall![0]).toEqual({ center: { x: 0.5, y: 0.5 }, zoom: 0.1 });
  expect(onPage).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it.each([0.1, 1, 4])("pans beyond sheet edges at zoom %s in both viewing modes", zoom => {
  for (const scrollPages of [false, true]) {
    const { rerender, props, onViewportChange, unmount } = open({ center: { x: 0.5, y: 0.5 }, zoom });
    rerender(<DrawingSheetViewer {...props} scrollPages={scrollPages} scrollStack={{ previous: [], next: [{ id: "next", name: "Next", imageUrl: "/next.webp", width: 1000, height: 500 }], onPage: vi.fn() }} />);
    for (let i = 0; i < 100; i++) {
      fireEvent.keyDown(window, { key: "a" });
      fireEvent.keyDown(window, { key: "w" });
    }
    const view = onViewportChange.mock.lastCall![0];
    expect(view.zoom).toBe(zoom);
    expect(view.center.x).toBeLessThan(0);
    expect(view.center.y).toBeLessThan(0);
    // The sheet still overlaps the viewport at the pan limit.
    expect(800 * zoom * view.center.x + 400).toBeGreaterThan(0);
    expect(400 * zoom * view.center.y + 300).toBeGreaterThan(0);
    unmount();
  }
});


it("reserves every page even when distant previews have not been requested", () => {
  const { rerender, props, container } = open({ center: { x: 0.5, y: 0.5 }, zoom: 0.3 });
  const next = Array.from({ length: 40 }, (_, i) => ({ id: String(i + 1), name: `Page ${i + 1}`, imageUrl: `/${i + 1}.webp`, width: 1000, height: 500 }));
  rerender(<DrawingSheetViewer {...props} scrollPages scrollStack={{ previous: [], next, onPage: vi.fn() }} />);
  expect(container.querySelectorAll("[data-drawing-scroll-page]")).toHaveLength(40);
  const far = container.querySelector<HTMLElement>('[data-drawing-scroll-page="40"]')!;
  expect(far.style.height).toBe("400px");
  expect(far).toHaveTextContent("Page 40");
  expect(far.querySelector("img")).toBeNull();
  const near = container.querySelector<HTMLElement>('[data-drawing-scroll-page="1"]')!;
  expect(near).toHaveTextContent("Loading preview");
  expect(near).toHaveAttribute("data-preview-ready", "false");
  fireEvent.load(near.querySelector("img")!);
  expect(near).toHaveAttribute("data-preview-ready", "true");
  expect(near.style.height).toBe("400px");
});
