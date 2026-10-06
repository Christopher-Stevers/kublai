import { describe, expect, it } from "vitest";
import { SNAP_OPS, segmentsFromOperators } from "./pdf-snap-lines";

const toSheet = (x: number, y: number) => ({ x: x / 100, y: y / 100 });

function run(ops: Array<[number, unknown[] | null]>) {
  return segmentsFromOperators(
    ops.map((op) => op[0]),
    ops.map((op) => op[1]),
    toSheet,
  );
}

describe("lines from a PDF", () => {
  it("reads a constructPath stroke, including one that crosses the sheet", () => {
    const lines = run([
      [
        SNAP_OPS.constructPath,
        [
          SNAP_OPS.stroke,
          [Float32Array.from([0, 20, 30, 1, 70, 30])],
          [10, 10, 90, 90],
        ],
      ],
      [
        SNAP_OPS.constructPath,
        [
          SNAP_OPS.stroke,
          [Float32Array.from([0, 0, 40, 1, 90, 40])],
          [0, 0, 100, 100],
        ],
      ],
    ]);
    expect(lines).toEqual([
      { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.3 },
      { x1: 0, y1: 0.4, x2: 0.9, y2: 0.4 },
    ]);
  });

  it("keeps a dashed stroke and the edges of a fill", () => {
    const lines = run([
      [SNAP_OPS.setDash, [[4, 2], 0]],
      [SNAP_OPS.moveTo, [10, 10]],
      [SNAP_OPS.lineTo, [80, 10]],
      [SNAP_OPS.stroke, []],
      [SNAP_OPS.rectangle, [10, 20, 30, 40]],
      [SNAP_OPS.fill, []],
    ]);
    expect(lines[0]).toEqual({ x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.1 });
    expect(lines).toHaveLength(5);
  });

  it("skips a curve so a door swing is not a line", () => {
    const lines = run([
      [
        SNAP_OPS.constructPath,
        [
          SNAP_OPS.stroke,
          [Float32Array.from([0, 10, 10, 2, 20, 10, 30, 20, 40, 10])],
          [0, 0, 50, 50],
        ],
      ],
    ]);
    expect(lines).toEqual([]);
  });

  it("follows the current transform", () => {
    const lines = run([
      [SNAP_OPS.transform, [2, 0, 0, 2, 10, 5]],
      [SNAP_OPS.moveTo, [0, 0]],
      [SNAP_OPS.lineTo, [10, 0]],
      [SNAP_OPS.stroke, []],
    ]);
    expect(lines).toEqual([{ x1: 0.1, y1: 0.05, x2: 0.3, y2: 0.05 }]);
  });
});
