// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { initSync, compact, merge_lines } from "./geometry-wasm/geometry";
import { mergeCollinear, type SnapSegment } from "./sheet-snap";
import { compactGeometryTypeScript } from "./bim/compact-geometry";
import {
  initializeGeometryKernels,
  compactGeometryRust,
  mergeLinesRust,
} from "./geometry-kernels";
const bytes = readFileSync("public/wasm/foreman-geometry-v1.wasm");
beforeAll(() => {
  initSync({ module: bytes });
});
function flatten(lines: SnapSegment[]) {
  return Float64Array.from(lines.flatMap((p) => [p.x1, p.y1, p.x2, p.y2]));
}
let seed = 42;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
describe("Rust geometry parity", () => {
  it.each([0.5, 1, 1.7])(
    "matches snap guides with reversed dashes, rotated lines and nearby parallel walls (%s)",
    (aspect) => {
      const lines: SnapSegment[] = [];
      for (let i = 0; i < 300; i++) {
        const x = random(),
          y = random(),
          dx = random() * 0.03,
          dy = random() * 0.03;
        lines.push(
          { x1: x, y1: y, x2: x + dx, y2: y + dy },
          { x1: x + 3 * dx, y1: y + 3 * dy, x2: x + 2 * dx, y2: y + 2 * dy },
          { x1: x, y1: y + 0.00001, x2: x + dx, y2: y + dy + 0.00001 },
        );
      }
      lines.push(
        { x1: NaN, y1: 0, x2: 1, y2: 0 },
        { x1: 0, y1: 0, x2: 0, y2: 0 },
      );
      const expected = flatten(mergeCollinear(lines, aspect));
      const actual = merge_lines(flatten(lines), aspect);
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i++)
        expect(actual[i]).toBeCloseTo(expected[i]!, 12);
    },
  );
  it.each([3, 3000, 65538])(
    "preserves exact vertex bits, triangles, quantized normals and hard edges (%s)",
    (count) => {
      const v = new Float32Array(count * 6);
      for (let i = 0; i < count; i++)
        v.set(
          [
            i % 39,
            Math.floor(i / 39),
            i % 2 ? -0 : 0,
            random() - 0.5,
            random() - 0.5,
            random() - 0.5,
          ],
          i * 6,
        );
      const indices = Uint32Array.from({ length: count }, (_, i) => i);
      const expected = compactGeometryTypeScript(v, indices),
        actual = compact(v, indices);
      try {
        expect(actual.positions()).toEqual(expected.positions);
        expect(actual.normals()).toEqual(expected.normals);
        expect(actual.indices()).toEqual(new Uint32Array(expected.indices));
      } finally {
        actual.free();
      }
    },
  );
  it("deduplicates identical vertices but keeps normal seams and signed zero", () => {
    const vertices = new Float32Array([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 0, 0, 1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 2, 1]);
    const expected = compactGeometryTypeScript(vertices, indices),
      actual = compact(vertices, indices);
    try {
      expect(new Uint32Array(actual.positions().buffer)).toEqual(
        new Uint32Array(expected.positions.buffer),
      );
      expect(actual.normals()).toEqual(expected.normals);
      expect(actual.indices()).toEqual(new Uint32Array(expected.indices));
    } finally {
      actual.free();
    }
  });
  it("rejects malformed geometry", () => {
    expect(() => compact(new Float32Array(5), new Uint32Array())).toThrow();
    expect(() =>
      compact(new Float32Array(6), new Uint32Array([0, 1, 0])),
    ).toThrow();
    expect(() =>
      compact(
        new Float32Array([NaN, 0, 0, 0, 0, 1]),
        new Uint32Array([0, 0, 0]),
      ),
    ).toThrow();
    expect(() => merge_lines(new Float64Array(3), 1)).toThrow();
  });
  it("loads once and uses the real module through production wrappers", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(bytes));
    try {
      expect(await initializeGeometryKernels()).toBe(true);
      expect(await initializeGeometryKernels()).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const v = new Float32Array(6000);
      for (let i = 0; i < 1000; i++) v.set([i, 0, 0, 0, 0, 1], i * 6);
      expect(
        compactGeometryRust(v, new Uint32Array(3000))?.positions.length,
      ).toBe(3);
      const lines = Array.from({ length: 1000 }, () => ({
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
      }));
      expect(mergeLinesRust(lines, 1)).toEqual([
        { x1: 0, y1: 0, x2: 1, y2: 0 },
      ]);
    } finally {
      fetcher.mockRestore();
    }
  });
});
