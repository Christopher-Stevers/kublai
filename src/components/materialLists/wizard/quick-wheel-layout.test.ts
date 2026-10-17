import { describe, expect, it } from "vitest";
import {
  curvedChoiceAt,
  quickWheelLayout,
  wheelVisibleLimit,
} from "./quick-wheel-layout";

describe("edge-aware wheel layout", () => {
  it("preserves the circular wheel when it fits", () => {
    expect(
      quickWheelLayout(300, 300, 170, 6, {
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
        for (let count = 1; count <= wheelVisibleLimit(bounds); count++) {
          const layout = quickWheelLayout(x, y, 170, count, bounds);
          expect(layout.kind).toBe("curved");
          if (layout.kind !== "curved") continue;
          expect(layout.choices).toHaveLength(count);
          layout.choices.forEach((choice, index) => {
            const box = {
              x: choice.label.x - 52,
              y: choice.label.y - 52,
              width: 104,
              height: 104,
            };
            expect(box.x).toBeGreaterThanOrEqual(bounds.left - 1);
            expect(box.y).toBeGreaterThanOrEqual(bounds.top - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.right + 1);
            expect(box.y + box.height).toBeLessThanOrEqual(bounds.bottom + 1);
            expect(
              curvedChoiceAt(layout, choice.label.x, choice.label.y, x, y),
            ).toBe(index);
            for (const other of layout.choices.slice(index + 1)) {
              expect(
                Math.hypot(
                  choice.label.x - other.label.x,
                  choice.label.y - other.label.y,
                ) >= 108,
              ).toBe(true);
            }
          });
          expect(curvedChoiceAt(layout, x, y, x, y)).toBeNull();
          // Every direction inside the activation dead zone must remain non-selectable,
          // including areas that used to belong to the narrow wedge tips.
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
            expect(
              curvedChoiceAt(
                layout,
                x + Math.cos(angle) * (layout.deadZoneRadius - 1),
                y + Math.sin(angle) * (layout.deadZoneRadius - 1),
                x,
                y,
              ),
            ).toBeNull();
          }
        }
      });
    }
  }
});
