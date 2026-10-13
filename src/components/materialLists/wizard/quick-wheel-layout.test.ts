import { describe, expect, it } from "vitest";
import { fanChoiceAt, quickWheelLayout } from "./quick-wheel-layout";

describe("edge-aware wheel layout", () => {
  it("preserves the circular wheel when it fits", () => {
    expect(
      quickWheelLayout(300, 300, 170, 8, {
        left: 12,
        top: 12,
        right: 900,
        bottom: 800,
      }),
    ).toEqual({ kind: "circle" });
  });
  for (const [width, height] of [
    [320, 600],
    [390, 720],
    [820, 230],
    [1024, 768],
  ]) {
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 0.5],
      [1, 0.5],
      [0.5, 0],
      [0.5, 1],
    ]) {
      it(`fits every choice at ${u},${v} on ${width}x${height}`, () => {
        const bounds = {
          left: 12,
          top: 12,
          right: width! - 12,
          bottom: height! - 24,
        };
        const x = bounds.left + u! * (bounds.right - bounds.left),
          y = bounds.top + v! * (bounds.bottom - bounds.top);
        for (let count = 1; count <= 8; count++) {
          const layout = quickWheelLayout(x, y, 170, count, bounds);
          expect(layout.kind).toBe("fan");
          if (layout.kind !== "fan") continue;
          expect(layout.choices).toHaveLength(count);
          layout.choices.forEach((box, index) => {
            expect(box.x).toBeGreaterThanOrEqual(bounds.left);
            expect(box.y).toBeGreaterThanOrEqual(bounds.top);
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.right + 0.001);
            expect(box.y + box.height).toBeLessThanOrEqual(
              bounds.bottom + 0.001,
            );
            expect(box.width).toBeGreaterThanOrEqual(60);
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(
              fanChoiceAt(
                layout,
                box.x + box.width / 2,
                box.y + box.height / 2,
                x,
                y,
              ),
            ).toBe(index);
            for (const other of layout.choices.slice(index + 1)) {
              expect(
                box.x + box.width <= other.x ||
                  other.x + other.width <= box.x ||
                  box.y + box.height <= other.y ||
                  other.y + other.height <= box.y,
              ).toBe(true);
            }
          });
          expect(fanChoiceAt(layout, x, y, x, y)).toBeNull();
        }
      });
    }
  }
});
