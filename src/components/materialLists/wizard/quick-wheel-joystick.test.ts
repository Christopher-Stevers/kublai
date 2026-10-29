import { describe, expect, it } from "vitest";
import {
  joystickWheelArc,
  wheelCarousel,
  wheelChoiceCone,
  wheelJoystickSpeed,
  wheelJoystickRadius,
  wheelJoystickMotion,
  wheelThumbAnchor,
} from "./quick-wheel-joystick";

describe("Quickwheel joystick", () => {
  it("has a neutral deadband, symmetric variable speed, and no rotation in the selection ring", () => {
    for (const dx of [-8, 0, 8]) expect(wheelJoystickSpeed(dx, 0, 170)).toBe(0);
    expect(wheelJoystickSpeed(12, 0, 170)).toBeGreaterThan(0);
    expect(wheelJoystickSpeed(48, 0, 170)).toBeGreaterThan(
      wheelJoystickSpeed(12, 0, 170),
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
  it("moves entering and leaving tiles toward the thumb and fades them there", () => {
    const tiles = wheelCarousel(0.5, 12, points, origin, false);
    expect(tiles[0]).toMatchObject({ x: 210, y: 230, opacity: 0.5 });
    expect(tiles.at(-1)).toMatchObject({ x: 350, y: 230, opacity: 0.5 });
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
