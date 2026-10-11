import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import { drawingVectorViewBox } from "~/lib/drawing-viewport";
import type { DrawingEntity } from "~/lib/drawing-workspace";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
  HTMLElement.prototype.setPointerCapture = () => undefined;
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entity: DrawingEntity = {
  id: "count",
  sheetId: "sheet",
  kind: "markup",
  revision: 1,
  visibility: "published",
  authorId: "user",
  authorName: "Tim",
  createdAt: "",
  updatedAt: "",
  comments: [],
  data: {
    sourceSheetId: "sheet",
    type: "count",
    points: [{ x: 0.5, y: 0.5 }],
    stroke: "#ef4444",
    width: 2,
  },
};
function open(
  zoom: number,
  props: Partial<ComponentProps<typeof DrawingSheetViewer>> = {},
) {
  const onViewportChange = vi.fn<(viewport: DrawingViewport) => void>();
  const result = render(
    <DrawingSheetViewer
      src="/sheet.webp"
      alt="Sheet"
      tool="pan"
      annotations={[entity]}
      initialViewport={{ center: { x: 0.5, y: 0.5 }, zoom }}
      onViewportChange={onViewportChange}
      {...props}
    />,
  );
  const image = screen.getByAltText("Sheet");
  const sheet = image.closest<HTMLElement>("[data-drawing-sheet-layer]")!;
  const frame = sheet.parentElement!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 750 },
  });
  Object.defineProperties(frame, {
    clientWidth: { value: 390 },
    clientHeight: { value: 600 },
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 390,
    bottom: 600,
    width: 390,
    height: 600,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  return {
    ...result,
    sheet,
    frame,
    onViewportChange,
    annotations: screen.getByLabelText("Drawing annotations"),
  };
}

describe("crisp drawing overlays", () => {
  it.each([1, 18.31, 24])(
    "draws at %s zoom in an unscaled viewport SVG",
    (scale) => {
      const { frame, sheet, annotations } = open(scale);
      expect(sheet.style.transform).toContain(`scale(${scale})`);
      expect(annotations.parentElement).toBe(frame);
      expect(annotations.closest("[data-drawing-sheet-layer]")).toBeNull();
      expect(annotations.style.transform).toBe("");
      expect(annotations.classList.contains("overflow-hidden")).toBe(true);
      expect(annotations.getAttribute("viewBox")).toBe(
        drawingVectorViewBox(
          { width: 390, height: 292.5 },
          { width: 390, height: 600 },
          { scale, x: 0, y: 0 },
        ),
      );
    },
  );

  it("keeps active dimensions in the same unscaled, clipped camera at maximum zoom", () => {
    const { frame, annotations } = open(24, {
      sharedScale: { unit: "m", unitsPerSheetWidth: 100 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    for (const x of [160, 230]) {
      fireEvent.pointerDown(frame, {
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: 300,
      });
      fireEvent.pointerUp(frame, {
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: 300,
      });
    }
    const measure = frame.querySelector("[data-measure-path]")!.closest("svg")!;
    expect(measure.parentElement).toBe(frame);
    expect(measure.closest("[data-drawing-sheet-layer]")).toBeNull();
    expect(measure.style.transform).toBe("");
    expect(measure.classList.contains("overflow-hidden")).toBe(true);
    expect(measure.getAttribute("viewBox")).toBe(
      drawingVectorViewBox(
        { width: 390, height: 292.5 },
        { width: 390, height: 600 },
        { scale: 24, x: 0, y: 0 },
        390,
      ),
    );
    expect(annotations.classList.contains("overflow-hidden")).toBe(true);
  });

  it("follows each gesture frame before the throttled geometry state commits", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const { frame, annotations, onViewportChange } = open(18.31);
    const text = annotations.querySelector("text");
    fireEvent.wheel(frame, { deltaY: -50, clientX: 125, clientY: 220 });
    act(() => {
      while (frames.length) frames.shift()!(performance.now());
    });
    const viewport = onViewportChange.mock.lastCall![0];
    const scale = viewport.zoom;
    const view = {
      scale,
      x: (0.5 - viewport.center.x) * 390 * scale,
      y: (0.5 - viewport.center.y) * 292.5 * scale,
    };
    const expected = drawingVectorViewBox(
      { width: 390, height: 292.5 },
      { width: 390, height: 600 },
      view,
    )!
      .split(" ")
      .map(Number);
    const actual = annotations.getAttribute("viewBox")!.split(" ").map(Number);
    expected.forEach((value, index) =>
      expect(actual[index]).toBeCloseTo(value, 10),
    );
    expect(annotations.querySelector("text")).toBe(text);
  });
});
