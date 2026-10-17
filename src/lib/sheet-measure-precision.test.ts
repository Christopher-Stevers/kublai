import { describe, expect, it } from "vitest";
import {
  advanceMeasurePrecision,
  beginMeasurePrecision,
  moveMeasurePrecision,
} from "./sheet-measure-precision";

function rest(
  state = beginMeasurePrecision({ x: 100, y: 200 }, 0),
  until = 1000,
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
    expect(early.zoom).toBeLessThan(4);
    const settled = rest(early, 1500);
    expect(settled.zoom).toBe(4);
    expect(settled.aim).toEqual({ x: 180, y: 240 });
  });

  it("reduces both axes by the magnification ratio without re-anchoring the target", () => {
    const state = rest();
    const next = moveMeasurePrecision(state, { x: 102, y: 201 }, 1040);
    expect(next.zoom).toBe(4);
    expect(next.aim).toEqual({ x: 100.5, y: 200.25 });
    const reversed = moveMeasurePrecision(next, { x: 100, y: 200 }, 1080);
    expect(reversed.aim).toEqual(state.aim);
    expect(rest(reversed, 2000).aim).toEqual(state.aim);
  });

  it("zooms while moving slowly, not only while completely stationary", () => {
    let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    for (let t = 20; t <= 1000; t += 20)
      state = moveMeasurePrecision(state, { x: 100 + t * 0.04, y: 200 }, t);
    expect(state.zoom).toBe(4);
    expect(state.aim.x).toBeGreaterThan(110);
    expect(state.aim.x).toBeLessThan(130);
    expect(state.finger.x).toBe(140);
  });

  it("snaps back on faster movement even after a long stationary hold, then can enter precision again", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 1040);
    state = rest(state, 4000);
    state = moveMeasurePrecision(state, { x: 140, y: 220 }, 4016);
    expect(state.zoom).toBe(1);
    expect(state.aim).toEqual(state.finger);
    state = rest(state, 5500);
    expect(state.zoom).toBe(4);
    expect(state.aim).toEqual({ x: 140, y: 220 });
  });

  it("does not exit precision for tiny sensor jitter or drift toward the finger when it is still", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 1040);
    for (let t = 1041; t <= 1060; t++)
      state = moveMeasurePrecision(
        state,
        { x: t % 2 ? 102.2 : 102, y: 200 },
        t,
      );
    expect(state.zoom).toBe(4);
    expect(state.aim.x).toBeCloseTo(100.5);
    expect(rest(state, 3000).aim).toEqual(state.aim);
  });

  it.each([8, 16, 32])(
    "keeps zoom time-based at a %s ms frame interval",
    (interval) => {
      let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
      for (let t = interval; t <= 400; t += interval)
        state = advanceMeasurePrecision(state, t);
      expect(state.zoom).toBeGreaterThan(2.2);
      expect(state.zoom).toBeLessThan(2.6);
    },
  );

  it("starts each new hold at normal zoom and can preserve the exact node under an off-centre touch", () => {
    const finger = { x: 118, y: 202 };
    const node = { x: 100, y: 200 };
    const state = beginMeasurePrecision(finger, 0, node);
    expect(state.zoom).toBe(1);
    const next = moveMeasurePrecision(rest(state), { x: 120, y: 204 }, 1040);
    expect(next.aim).toEqual({ x: 100.5, y: 200.5 });
    expect(beginMeasurePrecision(finger, 2000).aim).toEqual(finger);
  });
});
