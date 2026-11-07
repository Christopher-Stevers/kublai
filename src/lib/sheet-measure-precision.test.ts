import { describe, expect, it } from "vitest";
import {
  advanceMeasurePrecision,
  beginMeasurePrecision,
  moveMeasurePrecision,
} from "./sheet-measure-precision";

function rest(
  state = beginMeasurePrecision({ x: 100, y: 200 }, 0),
  until = 10000,
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
    expect(early.zoom).toBe(1);
    expect(early.zoom).toBeLessThan(2);
    const settled = rest(early, 11000);
    expect(settled.zoom).toBe(8);
    expect(settled.aim).toEqual({ x: 180, y: 240 });
  });

  it("reduces both axes by the magnification ratio without re-anchoring the target", () => {
    const state = rest();
    const next = moveMeasurePrecision(state, { x: 102, y: 201 }, 10040);
    expect(next.zoom).toBe(8);
    expect(next.aim).toEqual({ x: 100.25, y: 200.125 });
    const reversed = moveMeasurePrecision(next, { x: 100, y: 200 }, 10080);
    expect(reversed.aim).toEqual(state.aim);
    expect(rest(reversed, 11000).aim).toEqual(state.aim);
  });

  it("zooms while moving slowly, not only while completely stationary", () => {
    let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    for (let t = 20; t <= 10000; t += 20)
      state = moveMeasurePrecision(state, { x: 100 + t * 0.04, y: 200 }, t);
    expect(state.zoom).toBe(8);
    expect(state.aim.x).toBeGreaterThan(180);
    expect(state.aim.x).toBeLessThan(300);
    expect(state.finger.x).toBe(500);
  });

  it("snaps back on faster movement even after a long stationary hold, then can enter precision again", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 10040);
    state = rest(state, 13000);
    state = moveMeasurePrecision(state, { x: 140, y: 220 }, 13016);
    expect(state.zoom).toBe(1);
    expect(state.aim).toEqual(state.finger);
    expect(rest(state, 15000).zoom).toBe(1);
    state = rest(state, 22000);
    expect(state.zoom).toBe(8);
    expect(state.aim).toEqual({ x: 140, y: 220 });
  });

  it("does not exit precision for tiny sensor jitter or drift toward the finger when it is still", () => {
    let state = moveMeasurePrecision(rest(), { x: 102, y: 200 }, 10040);
    for (let t = 10041; t <= 10060; t++)
      state = moveMeasurePrecision(
        state,
        { x: t % 2 ? 102.2 : 102, y: 200 },
        t,
      );
    expect(state.zoom).toBe(8);
    expect(state.aim.x).toBeCloseTo(100.25);
    expect(rest(state, 12000).aim).toEqual(state.aim);
  });

  it.each([8, 16, 32])(
    "keeps zoom time-based at a %s ms frame interval",
    (interval) => {
      let state = beginMeasurePrecision({ x: 100, y: 200 }, 0);
      for (let t = interval; t <= 2400; t += interval)
        state = advanceMeasurePrecision(state, t);
      expect(state.zoom).toBeGreaterThan(1.4);
      expect(state.zoom).toBeLessThan(1.55);
    },
  );

  it("waits two seconds before ramping at the slower rate", () => {
    const initial = beginMeasurePrecision({ x: 100, y: 200 }, 0);
    const waiting = rest(initial, 1984);
    expect(waiting.zoom).toBe(1);
    const growing = rest(waiting, 2800);
    expect(growing.zoom).toBeCloseTo(2, 1);
    expect(rest(growing, 7800).zoom).toBe(8);
  });

  it("starts each new hold at normal zoom and can preserve the exact node under an off-centre touch", () => {
    const finger = { x: 118, y: 202 };
    const node = { x: 100, y: 200 };
    const state = beginMeasurePrecision(finger, 0, node);
    expect(state.zoom).toBe(1);
    const next = moveMeasurePrecision(rest(state), { x: 120, y: 204 }, 10040);
    expect(next.aim).toEqual({ x: 100.25, y: 200.25 });
    expect(beginMeasurePrecision(finger, 11000).aim).toEqual(finger);
  });
});
