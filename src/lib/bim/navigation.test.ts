import { describe, expect, it } from "vitest";
import { Euler, Quaternion } from "three";
import { navigationDelta } from "./navigation";

describe("model keyboard navigation", () => {
  const orientation = new Quaternion().setFromEuler(
    new Euler(Math.PI / 4, Math.PI / 3, 0, "YXZ"),
  );
  const move = (...keys: string[]) =>
    navigationDelta(orientation, new Set(keys), 0.04);
  it("flies forward along the view, including camera pitch, and reverses with S", () => {
    expect(move("w").y).toBeGreaterThan(0);
    expect(move("w").clone().add(move("s")).length()).toBeCloseTo(0);
    expect(move("w").length()).toBeCloseTo(0.1);
  });
  it("strafes perpendicular to the view and reverses with A", () => {
    expect(move("d").dot(move("w"))).toBeCloseTo(0);
    expect(move("d").y).toBeCloseTo(0);
    expect(move("d").add(move("a")).length()).toBeCloseTo(0);
  });
  it("keeps diagonal speed constant and cancels opposing keys", () => {
    expect(move("w", "d").length()).toBeCloseTo(move("w").length());
    expect(move("w", "s", "a", "d").length()).toBe(0);
    expect(move("shift").length()).toBe(0);
    expect(move("w", "shift").length()).toBeCloseTo(0.32);
  });
  it("keeps strafing available when looking straight up", () => {
    const vertical = new Quaternion().setFromEuler(
      new Euler(Math.PI / 2, 0, 0),
    );
    expect(navigationDelta(vertical, new Set(["d"]), 0.04).x).toBeCloseTo(0.1);
  });
});
