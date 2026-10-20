import { describe, expect, it } from "vitest";
import { clipPipeSelection, insideLasso, lassoIntervals, simplifyLasso } from "./pipe-lasso";
import type { PipeSegment, PipeSystemSelection } from "./pipe-system";

const square = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];
const segment = (id: string, x1: number, y1: number, x2: number, y2: number): PipeSegment => ({
  id, pathId: id, stroke: "#000", width: 1, dash: [], x1, y1, x2, y2,
});
const selection = (segments: PipeSegment[]): PipeSystemSelection => ({
  system: "DCW", segments, lengthInSheetWidths: 99, warnings: [], truncated: false,
});

describe("pipe lasso", () => {
  it("tests points inside the drawn loop", () => {
    expect(insideLasso({ x: 0.4, y: 0.4 }, square)).toBe(true);
    expect(insideLasso({ x: 0.7, y: 0.4 }, square)).toBe(false);
  });

  it("cuts a crossing segment at the loop edge", () => {
    const [part] = lassoIntervals(segment("a", 0, 0.4, 1, 0.4), square);
    expect(part![0]).toBeCloseTo(0.2);
    expect(part![1]).toBeCloseTo(0.6);
  });

  it("keeps two pieces when a segment leaves and re-enters a concave loop", () => {
    const u = [
      { x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.1 }, { x: 0.7, y: 0.1 }, { x: 0.7, y: 0.7 }, { x: 0.1, y: 0.7 },
    ];
    expect(lassoIntervals(segment("a", 0, 0.3, 1, 0.3), u)).toHaveLength(2);
  });

  it("only counts the length and segments inside the loop", () => {
    const clipped = clipPipeSelection(
      selection([
        segment("in", 0.3, 0.3, 0.5, 0.3),
        segment("cross", 0.4, 0.5, 0.4, 0.9),
        segment("out", 0.8, 0.8, 0.9, 0.9),
      ]),
      square,
      0.5,
    );
    expect(clipped.segments.map((s) => s.id)).toEqual(["in", "cross"]);
    expect(clipped.segments[0]).toMatchObject({ x1: 0.3, x2: 0.5 });
    expect(clipped.segments[1]!.y2).toBeCloseTo(0.6);
    // 0.2 horizontal + 0.1 tall at aspect 0.5.
    expect(clipped.lengthInSheetWidths).toBeCloseTo(0.25);
    expect(clipped.system).toBe("DCW");
  });

  it("thins a freehand stroke", () => {
    expect(
      simplifyLasso([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 0.01, y: 0 }], 0.001, 1),
    ).toHaveLength(2);
  });
});
