import { expect, it, vi } from "vitest";
import { recoverPipeSymbols } from "./pipe-symbol-recovery";
import type { PipeLinework, PipeSegment } from "./pipe-system";
const segment = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): PipeSegment => ({
  id,
  pathId: "closed-symbol",
  x1,
  y1,
  x2,
  y2,
  closed: true,
  stroke: "#000000",
  width: 0.001,
  dash: [],
});
const linework: PipeLinework = {
  aspect: 1,
  truncated: false,
  componentDataPartial: true,
  labels: [],
  symbols: [],
  segments: [
    segment("a", 0.1, 0.1, 0.11, 0.11),
    segment("b", 0.11, 0.11, 0.1, 0.11),
    segment("c", 0.1, 0.11, 0.1, 0.1),
  ],
};
it("uses cached whole geometry near a selected line without altering its measured segments", () => {
  const before = JSON.stringify(linework.segments),
    near = vi.fn(() => [{ segment: linework.segments[0]!, distance: 0 }]);
  const result = recoverPipeSymbols(linework, near, vi.fn());
  expect(result).toHaveLength(1);
  expect(result[0]!.points).toHaveLength(4);
  expect(JSON.stringify(linework.segments)).toBe(before);
  expect(recoverPipeSymbols(linework, () => [], vi.fn())).toEqual([]);
});
it("does not invent a closed shape by connecting disconnected clipped strokes", () => {
  const broken = {
    ...linework,
    segments: [
      linework.segments[0]!,
      { ...linework.segments[1]!, x1: 0.105 },
      linework.segments[2]!,
    ],
  };
  expect(
    recoverPipeSymbols(
      broken,
      () => [{ segment: linework.segments[0]!, distance: 0 }],
      vi.fn(),
    ),
  ).toEqual([]);
});
it("does not recover when the complete symbol cache already supplies the page", () => {
  const near = vi.fn(() => []);
  const complete = { ...linework, componentDataPartial: false };
  expect(recoverPipeSymbols(complete, near, vi.fn())).toBe(complete.symbols);
  expect(near).not.toHaveBeenCalled();
});
