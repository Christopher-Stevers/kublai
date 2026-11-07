import { describe, expect, it } from "vitest";
import { createDrawingRenderStrain } from "./drawing-render-strain";

/** Feeds frames at `period`, every `everyLate`th one twice as long. */
function run(
  strain: ReturnType<typeof createDrawingRenderStrain>,
  from: number,
  frames: number,
  rendering: boolean,
  everyLate = 0,
  period = 1000 / 60,
) {
  let at = from;
  for (let frame = 1; frame <= frames; frame++) {
    at += everyLate && frame % everyLate === 0 ? period * 2 : period;
    strain.frame(at, rendering);
  }
  return at;
}

describe("drawing render strain", () => {
  it("stays relaxed on a device that keeps pace while detail renders", () => {
    const strain = createDrawingRenderStrain();
    // An occasional missed frame (a garbage collection) is not a pattern.
    run(strain, 0, 400, true, 90);
    expect(strain.strained).toBe(false);
  });

  it("is strained when frames are missed only while rendering, and recovers", () => {
    const strain = createDrawingRenderStrain();
    let at = run(strain, 0, 80, false);
    // One missed frame per detail render, about every twelve frames.
    at = run(strain, at, 80, true, 12);
    expect(strain.strained).toBe(true);
    // A long pause is a new gesture, not a missed frame.
    at = run(strain, at + 2000, 80, true);
    expect(strain.strained).toBe(false);
    expect(at).toBeGreaterThan(0);
  });

  it("takes a couple of hitches in one window for chance, not a pattern", () => {
    const strain = createDrawingRenderStrain();
    let at = run(strain, 0, 80, false);
    // Two missed frames together, then none.
    at = run(strain, at, 40, true, 20);
    expect(strain.strained).toBe(false);
    at = run(strain, at, 40, true);
    expect(strain.strained).toBe(false);
    // Missed again and again, it is.
    run(strain, at, 80, true, 20);
    expect(strain.strained).toBe(true);
  });

  it("does not blame rendering on a page that misses frames anyway", () => {
    const strain = createDrawingRenderStrain();
    const at = run(strain, 0, 80, false, 12);
    run(strain, at, 80, true, 12);
    expect(strain.strained).toBe(false);
  });

  it("measures lateness against the display's own rate", () => {
    for (const period of [1000 / 120, 1000 / 30]) {
      const strain = createDrawingRenderStrain();
      let at = 0;
      for (let window = 0; window < 4; window++) {
        at = run(strain, at, 40, true, 0, period);
        expect(strain.strained).toBe(false);
      }
    }
  });
});
