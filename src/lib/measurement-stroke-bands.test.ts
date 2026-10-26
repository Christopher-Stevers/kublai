import { describe, expect, it } from "vitest";
import { measurementStrokeBands } from "./measurement-stroke-bands";
const segments = (paths: string[]) =>
  paths.flatMap((path) =>
    Array.from(
      path.matchAll(/M ([\d.e+-]+) ([\d.e+-]+) L ([\d.e+-]+) ([\d.e+-]+)/g),
      (match) => match.slice(1).map(Number),
    ),
  );
describe("measurement endpoint fading", () => {
  it.each([0.1, 1, 100])(
    "never reverses, overshoots, or doubles short edges (length %s)",
    (length) => {
      const paths = measurementStrokeBands(
        [
          { x: 0, y: 0 },
          { x: length, y: 0 },
        ],
        [{ from: 0, to: 1 }],
        6,
      );
      let total = 0;
      for (const [x1, y1, x2, y2] of segments(paths)) {
        expect(x1).toBeGreaterThanOrEqual(0);
        expect(x2).toBeLessThanOrEqual(length);
        expect(x2).toBeGreaterThan(x1!);
        expect(y1).toBe(0);
        expect(y2).toBe(0);
        total += x2! - x1!;
      }
      expect(total).toBeCloseTo(Math.max(0, length - 2.4));
    },
  );
  it("keeps independent branches independent and ignores zero-length edges", () => {
    const paths = measurementStrokeBands(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ],
      [
        { from: 0, to: 1 },
        { from: 0, to: 2 },
        { from: 2, to: 3 },
      ],
      6,
    );
    expect(paths.join("")).not.toMatch(/NaN|Infinity/);
    for (const [x1, y1, x2, y2] of segments(paths)) {
      expect(
        (y1 === 0 && y2 === 0) ||
          (Math.abs(x1! - y1!) < 0.000001 && Math.abs(x2! - y2!) < 0.000001),
      ).toBe(true);
    }
  });
});
