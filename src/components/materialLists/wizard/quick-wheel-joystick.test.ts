import { describe, expect, it } from "vitest";
import {
  joystickWheelArc,
  wheelCarousel,
  wheelJoystickSpeed,
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
    expect(wheelJoystickSpeed(80, 0, 170)).toBe(0);
    expect(wheelJoystickSpeed(50, 50, 170)).toBe(0);
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
