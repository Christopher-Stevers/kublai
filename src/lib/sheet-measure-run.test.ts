import { describe, expect, it } from "vitest";
import {
  emptyMeasureRun,
  hitMeasureRun,
  measureRunReducer,
  measureRunWidths,
  runAngleReference,
  type MeasureRun,
} from "./sheet-measure-run";
function append(run: MeasureRun, x: number, y: number) {
  return measureRunReducer(run, {
    type: "append",
    point: { x, y },
    line: null,
  });
}
function trunk() {
  return append(append(emptyMeasureRun(), 0.1, 0.5), 0.9, 0.5);
}
function branch(run: MeasureRun, x: number, y: number, aspect = 0.5) {
  const hit = hitMeasureRun(run.nodes, { x, y }, aspect, 0.01);
  expect(hit).not.toBeNull();
  return measureRunReducer(run, { type: "branch", hit: hit! });
}
describe("branched manual measurement", () => {
  it("splits a trunk without adding distance and continues from the junction instead of the old tip", () => {
    const original = trunk();
    const junction = branch(original, 0.4, 0.501);
    expect(junction.nodes[2]!.point).toEqual({ x: 0.4, y: 0.5 });
    expect(junction.active).toBe(2);
    expect(junction.nodes[1]!.parent).toBe(2);
    expect(measureRunWidths(junction.nodes, 0.5)).toBeCloseTo(0.8);
    const complete = append(junction, 0.4, 0.1);
    expect(complete.nodes[3]!.parent).toBe(2);
    expect(measureRunWidths(complete.nodes, 0.5)).toBeCloseTo(1);
    expect(original.nodes[1]!.parent).toBe(0);
  });
  it("supports multiple branches and branching from an existing endpoint without duplicate nodes", () => {
    let run = append(branch(trunk(), 0.4, 0.5), 0.4, 0.1);
    run = append(branch(run, 0.7, 0.5), 0.7, 0.9);
    expect(measureRunWidths(run.nodes, 0.5)).toBeCloseTo(1.2);
    const count = run.nodes.length;
    run = branch(run, 0.1, 0.5);
    expect(run.active).toBe(0);
    expect(run.nodes).toHaveLength(count);
    expect(measureRunWidths(append(run, 0.1, 0.7).nodes, 0.5)).toBeCloseTo(1.3);
  });
  it("Undo restores split topology and the previous continuation tip", () => {
    const original = trunk();
    let run = append(branch(original, 0.4, 0.5), 0.4, 0.1);
    run = measureRunReducer(run, { type: "undo" });
    expect(run.active).toBe(2);
    expect(run.nodes).toHaveLength(3);
    run = measureRunReducer(run, { type: "undo" });
    expect(run.nodes).toEqual(original.nodes);
    expect(run.active).toBe(1);
    expect(append(run, 1, 0.5).nodes.at(-1)!.parent).toBe(1);
  });
  it("projects diagonal and vertical runs using sheet aspect, respects hit tolerance, and ignores empty space", () => {
    const diagonal = append(append(emptyMeasureRun(), 0.1, 0.1), 0.9, 0.9);
    const hit = hitMeasureRun(diagonal.nodes, { x: 0.5, y: 0.51 }, 2, 0.02)!;
    expect(hit.point.x).toBeCloseTo(0.508);
    expect(hit.point.y).toBeCloseTo(0.508);
    const split = measureRunReducer(diagonal, { type: "branch", hit });
    expect(measureRunWidths(split.nodes, 2)).toBeCloseTo(
      measureRunWidths(diagonal.nodes, 2),
    );
    expect(
      hitMeasureRun(trunk().nodes, { x: 0.5, y: 0.6 }, 2, 0.02),
    ).toBeNull();
    expect(hitMeasureRun([], { x: 0.5, y: 0.5 }, 1, 0.02)).toBeNull();
  });
  it("moving a junction updates all attached edges and Undo restores it", () => {
    const original = append(branch(trunk(), 0.4, 0.5), 0.4, 0.1);
    const moved = measureRunReducer(original, {
      type: "move",
      index: 2,
      point: { x: 0.4, y: 0.6 },
      line: null,
    });
    const expected = Math.hypot(0.3, 0.05) + Math.hypot(0.5, 0.05) + 0.25;
    expect(measureRunWidths(moved.nodes, 0.5)).toBeCloseTo(expected);
    expect(measureRunReducer(moved, { type: "undo" }).nodes).toEqual(
      original.nodes,
    );
  });
  it("angle references use the chosen junction and its connected trunk, rather than the previous array entry", () => {
    const run = branch(trunk(), 0.4, 0.5);
    const ref = runAngleReference(run.nodes, run.nodes.length, run.active)!;
    expect(ref.anchor).toEqual({ x: 0.4, y: 0.5 });
    expect(ref.previous).toEqual({ x: 0.1, y: 0.5 });
    expect(ref.reference).toEqual({ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5 });
  });
});

it("redos a branch and its points, and discards redo after a new edit", () => {
  const base = trunk();
  const fork = branch(base, 0.5, 0.5);
  const tip = append(fork, 0.5, 0.8);
  let run = measureRunReducer(tip, { type: "undo" });
  run = measureRunReducer(run, { type: "undo" });
  expect(run.nodes).toEqual(base.nodes);
  run = measureRunReducer(run, { type: "redo" });
  expect(run.nodes).toEqual(fork.nodes);
  expect(run.active).toBe(fork.active);
  run = measureRunReducer(run, { type: "redo" });
  expect(run.nodes).toEqual(tip.nodes);
  expect(run.future).toHaveLength(0);
  run = append(measureRunReducer(run, { type: "undo" }), 0.5, 0.2);
  expect(run.future).toHaveLength(0);
  expect(measureRunReducer(run, { type: "redo" })).toBe(run);
});

it("selects an existing node and extends from it without changing existing edges", () => {
  const original = append(trunk(), 0.9, 0.8);
  const selected = measureRunReducer(original, { type: "select", index: 0 });
  expect(selected.active).toBe(0);
  expect(selected.nodes.map(n => n.point)).toEqual(original.nodes.map(n => n.point));
  expect(selected.nodes.map(n => n.parent)).toEqual([null, 0, 1]);
  expect(runAngleReference(selected.nodes, selected.nodes.length, selected.active)?.reference).not.toBeNull();
  expect(append(selected, 0.1, 0.2).nodes.at(-1)?.parent).toBe(0);
  expect(measureRunReducer(selected, { type: "undo" }).active).toBe(2);
});
