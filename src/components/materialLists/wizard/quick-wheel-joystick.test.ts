import { describe, expect, it } from "vitest";
import {
  joystickWheelArc,
  wheelMinimumArcRadius,
  wheelCarousel,
  wheelChoiceCone,
  wheelJoystickSpeed,
  wheelJoystickRadius,
  wheelJoystickMotion,
  wheelThumbAnchor,
} from "./quick-wheel-joystick";

describe("Quickwheel joystick", () => {
  it("has a neutral deadband, symmetric variable speed, and no rotation in the selection ring", () => {
    for (const dx of [-24, -8, 0, 8, 24]) expect(wheelJoystickSpeed(dx, 0, 170)).toBe(0);
    expect(wheelJoystickSpeed(28, 0, 170)).toBeGreaterThan(0);
    expect(wheelJoystickSpeed(48, 0, 170)).toBeGreaterThan(
      wheelJoystickSpeed(28, 0, 170),
    );
    expect(wheelJoystickSpeed(-48, 0, 170)).toBe(
      -wheelJoystickSpeed(48, 0, 170),
    );
    expect(wheelJoystickSpeed(0, 50, 170)).toBe(0);
    expect(wheelJoystickSpeed(80, 0, 170)).toBeGreaterThan(0);
    expect(wheelJoystickSpeed(50, 50, 170)).toBeGreaterThan(0);
    expect(wheelJoystickRadius(170)).toBe(128);
    expect(wheelJoystickSpeed(128, 0, 170)).toBeCloseTo(3.5 * 1.75);
    expect(wheelJoystickSpeed(-128, 0, 170)).toBeCloseTo(-3.5 * 1.75);
    expect(wheelJoystickSpeed(129, 0, 170)).toBe(0);
    expect(wheelJoystickSpeed(0, 128, 170)).toBe(0);
    const diagonal = 128 / Math.sqrt(2);
    expect(wheelJoystickSpeed(diagonal, diagonal, 170)).toBeCloseTo(
      3.5 * 1.75 / Math.sqrt(2),
    );
  });
  it("protects a visible choice approach before arming selection", () => {
    const origin = { x: 0, y: 0 };
    const tile = { x: 180, y: -180 };
    for (const distance of [30, 60, 100, 128]) {
      const pointer = { x: distance / Math.sqrt(2), y: -distance / Math.sqrt(2) };
      expect(wheelChoiceCone(origin, pointer, 170, [tile], 24)).toBe(tile);
      expect(wheelChoiceCone(origin, pointer, 170, [tile])).toBeUndefined();
    }
    expect(wheelChoiceCone(origin, { x: 80, y: 0 }, 170, [tile], 24)).toBeUndefined();
    expect(wheelChoiceCone(origin, { x: 100, y: -100 }, 170, [tile])).toBe(tile);
  });
  const origin = { x: 300, y: 300 };
  const points = [
    { x: 120, y: 160 },
    { x: 250, y: 100 },
    { x: 400, y: 160 },
  ];
  it("wraps in both directions and only materializes visible choices plus fading endpoints", () => {
    expect(
      wheelCarousel(0, 10000, points, origin, false).map((tile) => tile.index),
    ).toEqual([0, 1, 2]);
    expect(
      wheelCarousel(-1, 10000, points, origin, false).map((tile) => tile.index),
    ).toEqual([9999, 0, 1]);
    expect(
      wheelCarousel(10001, 10000, points, origin, false).map(
        (tile) => tile.index,
      ),
    ).toEqual([1, 2, 3]);
    expect(wheelCarousel(0.5, 10000, points, origin, false)).toHaveLength(4);
  });
  it("continues past each rail endpoint while fading", () => {
    const tiles = wheelCarousel(0.5, 12, points, origin, false);
    expect(tiles[0]).toMatchObject({ x: 55, y: 190, opacity: 0.5 });
    expect(tiles.at(-1)).toMatchObject({ x: 475, y: 190, opacity: 0.5 });
    expect(tiles[1]?.opacity).toBe(1);
    for (let offset = 0; offset < 15; offset += 0.05) {
      const frame = wheelCarousel(offset, 12, points, origin, false);
      expect(new Set(frame.map((tile) => tile.index)).size).toBe(frame.length);
      frame.forEach((tile) => {
        expect(tile.opacity).toBeGreaterThan(0);
        expect(tile.opacity).toBeLessThanOrEqual(1);
      });
    }
  });
  it("keeps fading thumb options on the arc radius in both directions", () => {
    const arc = { radius: 240, start: -0.6, step: 0.5 };
    const rail = Array.from({ length: 3 }, (_, i) => ({
      x: origin.x + Math.sin(arc.start + i * arc.step) * arc.radius,
      y: origin.y - Math.cos(arc.start + i * arc.step) * arc.radius,
    }));
    for (const offset of [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]) {
      const frame = wheelCarousel(offset, 12, rail, origin, false, arc);
      const fading = frame.filter(tile => tile.opacity < 0.75);
      expect(fading).toHaveLength(2);
      for (const tile of fading) {
        expect(Math.hypot(tile.x - origin.x, tile.y - origin.y)).toBeCloseTo(240);
        const angle = Math.atan2(tile.x - origin.x, origin.y - tile.y);
        expect(angle < arc.start || angle > arc.start + 2 * arc.step).toBe(true);
      }
    }
  });
  it("keeps a fade cue at rest and throughout scrolling", () => {
    const arc = { radius: 208, start: -.6, step: .5 };
    for (const count of [2, 3, 12]) {
      for (let offset = 0; offset < count + 1; offset += .125) {
        const tiles = wheelCarousel(offset, count, points.slice(0, Math.min(count, 3)), origin, false, arc);
        expect(tiles.some(tile => tile.opacity > 0 && tile.opacity < 1)).toBe(true);
      }
    }
  });
  it("rotates small lists without introducing pagination or duplicate choices", () => {
    for (let offset = -5; offset < 5; offset += 0.1) {
      const frame = wheelCarousel(offset, 3, points, origin, false);
      expect(frame).toHaveLength(3);
      expect(new Set(frame.map((tile) => tile.index)).size).toBe(3);
    }
    expect(wheelCarousel(0, 0, [], origin, false)).toEqual([]);
  });
});

describe("single thumb rail", () => {
  it.each([
    [430, 850, 350, 520, "right"],
    [430, 850, 75, 520, "left"],
    [1024, 768, 850, 520, "right"],
    [390, 720, 190, 360, "right"],
    [850, 430, 730, 250, "right"],
  ] as const)("fits moving options on %ix%i", (width, height, x, y, hand) => {
    const origin = { x, y };
    const bounds = {
      left: 12,
      top: 88,
      right: width - 12,
      bottom: height - 12,
    };
    const rail = joystickWheelArc(origin, bounds, 170, 20, hand);
    expect(rail).toBeDefined();
    if (!rail) return;
    expect(rail.arc.radius).toBeGreaterThanOrEqual(wheelMinimumArcRadius(170));
    for (let offset = 0; offset < 20; offset += 0.25) {
      const tiles = wheelCarousel(
        offset,
        20,
        rail.points,
        origin,
        false,
        rail.arc,
      );
      expect(tiles.length).toBeLessThanOrEqual(7);
      expect(new Set(tiles.map((tile) => tile.index)).size).toBe(tiles.length);
      const full = tiles.filter((tile) => tile.opacity === 1);
      full.forEach((tile, i) => {
        expect(tile.x - 52).toBeGreaterThanOrEqual(bounds.left - 0.1);
        expect(tile.x + 52).toBeLessThanOrEqual(bounds.right + 0.1);
        expect(tile.y - 52).toBeGreaterThanOrEqual(bounds.top - 0.1);
        expect(tile.y + 52).toBeLessThanOrEqual(bounds.bottom + 0.1);
        full
          .slice(i + 1)
          .forEach((other) =>
            expect(
              Math.hypot(other.x - tile.x, other.y - tile.y),
            ).toBeGreaterThan(110),
          );
      });
    }
  });
  it("never falls back to a tight ring even when the viewport cannot fit the rail", () => {
    const origin = { x: 150, y: 150 };
    const rail = joystickWheelArc(origin, { left: 0, top: 0, right: 300, bottom: 300 }, 170, 20, "right", { x: 300, y: 204 })!;
    expect(rail.arc.radius).toBe(208);
    expect(rail.points).toHaveLength(1);
    for (const point of rail.points)
      expect(Math.hypot(point.x-origin.x, point.y-origin.y)).toBeCloseTo(208);
  });
  it("keeps short lists unique across the gap beneath the thumb", () => {
    const origin = { x: 350, y: 520 },
      bounds = { left: 12, top: 88, right: 418, bottom: 838 };
    for (const count of [2, 3, 6, 7]) {
      const rail = joystickWheelArc(origin, bounds, 170, count, "right")!;
      for (let offset = 0; offset < count + 1; offset += 0.125) {
        const tiles = wheelCarousel(
          offset,
          count,
          rail.points,
          origin,
          false,
          rail.arc,
        );
        expect(tiles.length).toBeGreaterThan(0);
        expect(new Set(tiles.map((tile) => tile.index)).size).toBe(
          tiles.length,
        );
      }
    }
  });
});

describe("thumb-anchor neutral and relocation", () => {
  const centre = { x: 500, y: 400 };
  it.each([
    { x: 850, y: 600 },
    { x: 150, y: 600 },
    { x: 850, y: 150 },
    { x: 150, y: 150 },
  ])("points neutral away from the anchor through %j", (origin) => {
    const dx = origin.x - centre.x,
      dy = origin.y - centre.y,
      d = Math.hypot(dx, dy);
    const point = (forward: number, side: number) => ({
      x: origin.x + (dx / d) * forward - (dy / d) * side,
      y: origin.y + (dy / d) * forward + (dx / d) * side,
    });
    expect(wheelJoystickMotion(origin, point(40, 0), centre, 170)).toEqual({
      relocate: false,
      speed: 0,
    });
    const clockwise = wheelJoystickMotion(origin, point(15, 35), centre, 170);
    const counterclockwise = wheelJoystickMotion(
      origin,
      point(15, -35),
      centre,
      170,
    );
    expect(clockwise.speed).toBeGreaterThan(0);
    expect(counterclockwise.speed).toBeCloseTo(-clockwise.speed);
    expect(wheelJoystickMotion(origin, point(-30, 0), centre, 170)).toEqual({
      relocate: true,
      speed: 0,
    });
    expect(
      wheelJoystickMotion(origin, point(-1, 0), centre, 170, true),
    ).toEqual({ relocate: true, speed: 0 });
    expect(
      wheelJoystickMotion(origin, point(1, 0), centre, 170, true).relocate,
    ).toBe(false);
    expect(wheelJoystickMotion(origin, point(140, 0), centre, 170)).toEqual({
      relocate: false,
      speed: 0,
    });
  });
  it("does not drift with thumb jitter and has a stable axis exactly at screen centre", () => {
    expect(
      wheelJoystickMotion(centre, { x: 500, y: 404 }, centre, 170),
    ).toEqual({ relocate: false, speed: 0 });
    expect(
      wheelJoystickMotion(centre, { x: 500, y: 360 }, centre, 170),
    ).toEqual({ relocate: false, speed: 0 });
  });
});

it("anchors to the thumb side one CSS inch above the visible bottom", () => {
  const viewport = { left: 12, top: 30, right: 412, bottom: 830 };
  expect(wheelThumbAnchor(viewport, "right")).toEqual({ x: 412, y: 734 });
  expect(wheelThumbAnchor(viewport, "left")).toEqual({ x: 12, y: 734 });
  expect(
    wheelThumbAnchor({ left: 0, top: 0, right: 700, bottom: 400 }, "right"),
  ).toEqual({ x: 700, y: 304 });
});

it("keeps every resting option ahead of the thumb anchor, outside the relocation zone", () => {
  for (const hand of ["left", "right"] as const) {
    const viewport = { left: 0, top: 0, right: 430, bottom: 850 };
    const anchor = wheelThumbAnchor(viewport, hand);
    const origin = { x: hand === "right" ? 350 : 75, y: 520 };
    const bounds = { left: 12, top: 88, right: 418, bottom: 838 };
    const rail = joystickWheelArc(origin, bounds, 170, 20, hand, anchor)!;
    expect(rail).toBeDefined();
    rail.points.forEach((point) =>
      expect(wheelJoystickMotion(origin, point, anchor, 170).relocate).toBe(
        false,
      ),
    );
  }
});

describe("live choice cones", () => {
  const origin = { x: 300, y: 400 };
  const tile = { x: 300, y: 100, id: "far choice" };
  it("targets a distant tile immediately outside joystick reach", () => {
    expect(wheelChoiceCone(origin, { x: 300, y: 272 }, 170, [tile])).toBeUndefined();
    expect(wheelChoiceCone(origin, { x: 300, y: 271 }, 170, [tile])).toBe(tile);
    expect(wheelChoiceCone(origin, { x: 315, y: 271 }, 170, [tile])).toBe(tile);
    expect(wheelChoiceCone(origin, { x: 350, y: 271 }, 170, [tile])).toBeUndefined();
  });
  it("uses the current item directions after scrolling, without stale sectors", () => {
    const moved = { ...tile, x: 600, y: 400 };
    expect(wheelChoiceCone(origin, { x: 300, y: 271 }, 170, [moved])).toBeUndefined();
    expect(wheelChoiceCone(origin, { x: 429, y: 400 }, 170, [moved])).toBe(moved);
    expect(wheelChoiceCone(origin, { x: 171, y: 400 }, 170, [moved])).toBeUndefined();
  });
});
