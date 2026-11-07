import { describe, expect, it } from "vitest";
import { drawingVectorViewBox } from "./drawing-viewport";

describe("viewport-sized vector camera", () => {
  it.each([
    [
      { width: 800, height: 400 },
      { width: 800, height: 600 },
      { scale: 1, x: 0, y: 0 },
    ],
    [
      { width: 390, height: 292.5 },
      { width: 390, height: 647 },
      { scale: 18.31, x: 92.4, y: -527.3 },
    ],
    [
      { width: 390, height: 292.5 },
      { width: 390, height: 647 },
      { scale: 24, x: -1000, y: 500 },
    ],
    [
      { width: 300, height: 600 },
      { width: 800, height: 600 },
      { scale: 2.4, x: 250, y: -200 },
    ],
  ])(
    "matches the image's pixel placement at every zoom and pan",
    (fit, frame, view) => {
      for (const coordinateWidth of [1000, fit.width]) {
        const [left, top, width, height] = drawingVectorViewBox(
          fit,
          frame,
          view,
          coordinateWidth,
        )!
          .split(" ")
          .map(Number) as [number, number, number, number];
        expect(width / height).toBeCloseTo(frame.width / frame.height, 10);
        for (const point of [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.7 },
          { x: 1, y: 1 },
        ]) {
          const x = ((point.x * coordinateWidth - left) / width) * frame.width;
          const y =
            (((point.y * coordinateWidth * fit.height) / fit.width - top) /
              height) *
            frame.height;
          expect(x).toBeCloseTo(
            frame.width / 2 + view.x + (point.x - 0.5) * fit.width * view.scale,
            8,
          );
          expect(y).toBeCloseTo(
            frame.height / 2 +
              view.y +
              (point.y - 0.5) * fit.height * view.scale,
            8,
          );
        }
      }
    },
  );

  it("retains margins and off-sheet coordinates without stretching the overlay", () => {
    expect(
      drawingVectorViewBox(
        { width: 800, height: 400 },
        { width: 800, height: 600 },
        { scale: 1, x: 0, y: 0 },
      ),
    ).toBe("0 -125 1000 750");
  });

  it("waits for valid layout dimensions", () => {
    const size = { width: 390, height: 600 };
    const view = { scale: 1, x: 0, y: 0 };
    expect(drawingVectorViewBox(size, { ...size, width: 0 }, view)).toBeNull();
    expect(
      drawingVectorViewBox(size, size, { ...view, scale: NaN }),
    ).toBeNull();
    expect(drawingVectorViewBox(size, size, view, Infinity)).toBeNull();
  });
});
