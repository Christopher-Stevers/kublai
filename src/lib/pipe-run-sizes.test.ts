import { describe, expect, it } from "vitest";
import type { PipeSegment } from "./pipe-system";
import {
  formatPipeSize,
  nearestPipeSize,
  parsePipeSize,
  pipeRunSizes,
  pipeSizeTags,
} from "./pipe-run-sizes";

const seg = (id: string, x1: number, y1: number, x2: number, y2: number): PipeSegment => ({
  id,
  pathId: id,
  x1,
  y1,
  x2,
  y2,
  stroke: "#000",
  width: 1,
  dash: [],
});
const text = (value: string, x: number, y: number) => ({
  text: value,
  left: x - 0.004,
  right: x + 0.004,
  top: y - 0.001,
  bottom: y + 0.001,
});

describe("parsePipeSize", () => {
  it.each([
    ['4"Ø SAN', { unit: "in", nominal: 4 }],
    ["150Ø SAN @ 1%", { unit: "mm", nominal: 150 }],
    ["Ø100", { unit: "mm", nominal: 100 }],
    ["3Ø V", { unit: "in", nominal: 3 }],
    ['1-1/2" DCW', { unit: "in", nominal: 1.5 }],
    ['3/4"', { unit: "in", nominal: 0.75 }],
    ["DN65", { unit: "mm", nominal: 65 }],
    ["2'' CW", { unit: "in", nominal: 2 }],
    ['4" PIPE UP', { unit: "in", nominal: 4 }],
  ])("reads %s", (value, size) => {
    expect(parsePipeSize(value)).toEqual(size);
  });

  it.each([
    "12'-6\"",
    '4"x3" REDUCER',
    '6" CONCRETE SLAB',
    "INV 98.50",
    "1%",
    '2" SAN 3" VENT',
    "ROOM 104",
  ])("ignores %s", (value) => {
    expect(parsePipeSize(value)).toBeNull();
  });
});

describe("formatPipeSize", () => {
  it("prints nominal sizes the way they are ordered", () => {
    expect(formatPipeSize({ unit: "in", nominal: 1.5 })).toBe('1-1/2"');
    expect(formatPipeSize({ unit: "in", nominal: 0.75 })).toBe('3/4"');
    expect(formatPipeSize({ unit: "in", nominal: 4 })).toBe('4"');
    expect(formatPipeSize({ unit: "mm", nominal: 100 })).toBe("100 mm");
    expect(formatPipeSize(null)).toBe("Unknown size");
  });
});

describe("pipeRunSizes", () => {
  // A 4" main bending once, a straight-through tee, a 2" branch and an
  // unlabeled stub off a second tee.
  const segments = [
    seg("a", 0.1, 0.1, 0.3, 0.1),
    seg("b", 0.3, 0.1, 0.5, 0.1),
    seg("c", 0.5, 0.1, 0.5, 0.3), // bend: still 4"
    seg("d", 0.5, 0.3, 0.5, 0.5),
    seg("branch", 0.5, 0.3, 0.7, 0.3),
    seg("e", 0.5, 0.5, 0.5, 0.6),
    seg("stub", 0.5, 0.5, 0.4, 0.5),
  ];
  const selection = { system: "SAN", segments };

  it("follows each size along the pipe and straight through tees only", () => {
    const tags = pipeSizeTags([
      text('4"Ø SAN', 0.2, 0.098),
      text('2"Ø SAN', 0.6, 0.298),
      text("ROOM 101", 0.3, 0.2),
    ]);
    const result = pipeRunSizes(selection, tags, 1);
    expect(result.tagCount).toBe(2);
    const size = (id: string) => result.segmentSizes.get(id)?.nominal;
    expect(["a", "b", "c", "d", "e"].map(size)).toEqual([4, 4, 4, 4, 4]);
    expect(size("branch")).toBe(2);
    expect(size("stub")).toBeUndefined();
    expect(result.runs.map((run) => [run.size?.nominal ?? null, +run.lengthInSheetWidths.toFixed(3)])).toEqual([
      [4, 0.9],
      [2, 0.2],
      [null, 0.1],
    ]);
  });

  it("ignores a tag that names another system", () => {
    const tags = pipeSizeTags([text('3"Ø VENT', 0.2, 0.098)]);
    const result = pipeRunSizes(selection, tags, 1);
    expect(result.tagCount).toBe(0);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.size).toBeNull();
  });

  it("splits a run between two tags at the halfway point along the pipe", () => {
    const line = [seg("p", 0, 0, 0.1, 0), seg("q", 0.1, 0, 0.2, 0), seg("r", 0.2, 0, 0.3, 0), seg("s", 0.3, 0, 0.4, 0)];
    const tags = pipeSizeTags([text('4"', 0.05, -0.002), text('3"', 0.35, -0.002)]);
    const result = pipeRunSizes({ system: null, segments: line }, tags, 1);
    expect(["p", "q", "r", "s"].map((id) => result.segmentSizes.get(id)?.nominal)).toEqual([4, 4, 3, 3]);
  });

  it("sizes a fitting from the nearest sized pipe", () => {
    const tags = pipeSizeTags([text('4"Ø SAN', 0.2, 0.098)]);
    const result = pipeRunSizes(selection, tags, 1);
    expect(nearestPipeSize({ x: 0.5, y: 0.101 }, selection, result.segmentSizes, 1)).toEqual({ unit: "in", nominal: 4 });
    expect(nearestPipeSize({ x: 0.9, y: 0.9 }, selection, result.segmentSizes, 1)).toBeNull();
  });
});
