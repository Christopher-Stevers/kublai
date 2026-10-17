import { describe, expect, it } from "vitest";
import {
  advanceMeasurePrecision,
  beginMeasurePrecision,
  moveMeasurePrecision,
} from "./sheet-measure-precision";

function rest(
  state = beginMeasurePrecision({ x: 100, y: 200 }, 0),
  until = 5000,
) {
  for (let time = state.updatedAt + 16; time <= until; time += 16)
    state = advanceMeasurePrecision(state, time);
  return state;
}

describe("measurement precision", () => {
  it("keeps quick placement direct, then gradually zooms during a pause without moving the aim", () => {
    let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    state = moveMeasurePrecision(state, { x: 180, y: 240 }, 16);
    expect(state.aim).toEqual(state.finger);
    expect(state.zoom).toBe(1);
    const early = rest(state, 500);
    expect(early.zoom).toBeGreaterThan(1);
    expect(early.zoom).toBeLessThan(2);
    const settled = rest(early, 6000);
    expect(settled.zoom).toBe(8);
    expect(settled.aim).toEqual({ x: 180, y: 240 });
  });

  it("reduces both axes by the magnification ratio without re-anchoring the target", () => {
    const state = rest();
    const next = moveMeasurePrecision(state, { x: 102, y: 201 }, 5040);
    expect(next.zoom).toBe(8);
    expect(next.aim).toEqual({ x: 100.25, y: 200.125 });
    const reversed = moveMeasurePrecision(next, { x: 100, y: 200 }, 5080);
    expect(reversed.aim).toEqual(state.aim);
    expect(rest(reversed, 6000).aim).toEqual(state.aim);
  });

  it("zooms while moving slowly, not only while completely stationary", () => {
    let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    for (let t = 20; t <= 5000; t += 20)
      state = moveMeasurePrecision(state, { x: 100 + t * 0.04, y: 200 }, t);
    expect(state.zoom).toBe(8);
    expect(state.aim.x).toBeGreaterThan(145);
    expect(state.aim.x).toBeLessThan(170);
    expect(state.finger.x).toBe(300);
  });

  it("snaps back on faster movement even after a long stationary hold, then can enter precision again", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 5040);
    state = rest(state, 9000);
    state = moveMeasurePrecision(state, { x: 140, y: 220 }, 9016);
    expect(state.zoom).toBe(1);
    expect(state.aim).toEqual(state.finger);
    state = rest(state, 15000);
    expect(state.zoom).toBe(8);
    expect(state.aim).toEqual({ x: 140, y: 220 });
  });

  it("does not exit precision for tiny sensor jitter or drift toward the finger when it is still", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 5040);
    for (let t = 5041; t <= 5060; t++)
      state = moveMeasurePrecision(
        state,
        { x: t % 2 ? 102.2 : 102, y: 200 },
        t,
      );
    expect(state.zoom).toBe(8);
    expect(state.aim.x).toBeCloseTo(100.25);
    expect(rest(state, 7000).aim).toEqual(state.aim);
  });

  it.each([8, 16, 32])(
    "keeps zoom time-based at a %s ms frame interval",
    (interval) => {
      let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
      for (let t = interval; t <= 400; t += interval)
        state = advanceMeasurePrecision(state, t);
      expect(state.zoom).toBeGreaterThan(1.4);
      expect(state.zoom).toBeLessThan(1.55);
    },
  );

  it("takes three times as long to reach the old zoom, then continues to twice that maximum", () => {
    const initial = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    const afterOldRamp = rest(initial, 720); // 120 ms dwell + the old 600 ms ramp.
    expect(afterOldRamp.zoom).toBeCloseTo(2, 1);
    const afterTripleRamp = rest(afterOldRamp, 1920);
    expect(afterTripleRamp.zoom).toBeCloseTo(4, 1);
    expect(rest(afterTripleRamp, 4500).zoom).toBe(8);
  });

  it("starts each new hold at normal zoom and can preserve the exact node under an off-centre touch", () => {
    const finger = { x: 118, y: 202 };
    const node = { x: 100, y: 200 };
    const state = beginMeasurePrecision(finger, 0, node);
    expect(state.zoom).toBe(1);
    const next = moveMeasurePrecision(rest(state), { x: 120, y: 204 }, 5040);
    expect(next.aim).toEqual({ x: 100.25, y: 200.25 });
    expect(beginMeasurePrecision(finger, 6000).aim).toEqual(finger);
  });
});
