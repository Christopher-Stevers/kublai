import { describe, expect, it } from "vitest";
import { Euler, Quaternion } from "three";
import { navigationDelta } from "./navigation";
import {
  DEFAULT_NAVIGATION,
  type NavigationAction,
} from "./navigation-settings";

describe("model keyboard navigation", () => {
  const orientation = new Quaternion().setFromEuler(
    new Euler(Math.PI / 4, Math.PI / 3, 0, "YXZ"),
  );
  const move = (...keys: NavigationAction[]) =>
    navigationDelta(orientation, new Set(keys), 0.04);
  it("flies forward along the view, including camera pitch, and reverses with S", () => {
    expect(move("forward").y).toBeGreaterThan(0);
    expect(move("forward").clone().add(move("backward")).length()).toBeCloseTo(
      0,
    );
    expect(move("forward").length()).toBeCloseTo(0.668);
  });
  it("strafes perpendicular to the view and reverses with A", () => {
    expect(move("right").dot(move("forward"))).toBeCloseTo(0);
    expect(move("right").y).toBeCloseTo(0);
    expect(move("right").add(move("left")).length()).toBeCloseTo(0);
  });
  it("keeps diagonal speed constant and cancels opposing keys", () => {
    expect(move("forward", "right").length()).toBeCloseTo(
      move("forward").length(),
    );
    expect(move("forward", "backward", "left", "right").length()).toBe(0);
    expect(move("boost").length()).toBe(0);
    expect(move("forward", "boost").length()).toBeCloseTo(2.1376);
  });
  it("keeps strafing available when looking straight up", () => {
    const vertical = new Quaternion().setFromEuler(
      new Euler(Math.PI / 2, 0, 0),
    );
    expect(navigationDelta(vertical, new Set(["right"]), 0.04).x).toBeCloseTo(
      0.668,
    );
  });
  it("supports horizontal travel and explicit elevation independently of pitch", () => {
    const settings = {
      ...DEFAULT_NAVIGATION,
      movement: "ground" as const,
      moveSpeed: 5,
    };
    const forward = navigationDelta(
      orientation,
      new Set(["forward"]),
      0.04,
      settings,
    );
    expect(forward.y).toBeCloseTo(0);
    expect(forward.length()).toBeCloseTo(0.2);
    expect(
      navigationDelta(orientation, new Set(["up"]), 0.04, settings).y,
    ).toBeCloseTo(0.2);
  });
  it("uses precision speed before boost and bounds elapsed time", () => {
    const delta = navigationDelta(
      orientation,
      new Set(["forward", "boost", "slow"]),
      1,
    );
    expect(delta.length()).toBeCloseTo(0.20875);
    expect(
      navigationDelta(orientation, new Set(["forward"]), -1).length(),
    ).toBe(0);
  });
});
