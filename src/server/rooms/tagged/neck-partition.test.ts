import { describe, expect, it } from "vitest";

import { partitionAtNecks } from "./neck-partition";

/**
 * Synthetic plan, 200×120 px: a corridor along the top (y 10-30) and two
 * suites below it. Each suite has a living room (with the room tag) and a
 * bedroom behind an inner door; each suite has one entry door off the corridor.
 */
function plan() {
  const W = 200, H = 120;
  const walls = new Uint8Array(W * H);
  const wall = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) walls[y * W + x] = 1;
  };
  wall(0, 0, W - 1, 9); wall(0, 110, W - 1, H - 1); wall(0, 0, 9, H - 1); wall(190, 0, W - 1, H - 1);
  wall(10, 30, 189, 33); // corridor wall
  wall(98, 34, 101, 109); // demising wall between suites
  wall(10, 70, 189, 73); // living / bedroom walls
  const door = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) walls[y * W + x] = 0;
  };
  door(40, 48, 30, 33); // suite A entry
  door(140, 148, 30, 33); // suite B entry
  door(50, 58, 70, 73); // suite A bedroom door
  door(150, 158, 70, 73); // suite B bedroom door
  return { walls, W, H };
}

describe("partitionAtNecks", () => {
  it("keeps each suite whole and the corridor separate", () => {
    const { walls, W, H } = plan();
    const seeds = [
      { name: "SUITE A A-101", x: 60 / W, y: 50 / H },
      { name: "SUITE B A-102", x: 150 / W, y: 50 / H },
    ];
    const r = partitionAtNecks(walls, W, H, seeds, { neck: 6, minRoomPx: 50 });
    const at = (x: number, y: number) => r.labels[y * W + x]!;
    // Bedrooms join their own suite.
    expect(at(30, 90)).toBe(1);
    expect(at(170, 90)).toBe(2);
    expect(at(60, 50)).toBe(1);
    // The corridor is its own (unnamed) space, not part of either suite.
    const corridor = at(100, 20);
    expect(corridor).toBeGreaterThan(seeds.length);
    expect(at(20, 20)).toBe(corridor);
    expect(at(180, 20)).toBe(corridor);
  });

  it("does not let a corridor be owned by a room through its doors", () => {
    const { walls, W, H } = plan();
    const seeds = [
      { name: "SUITE A A-101", x: 60 / W, y: 50 / H },
      { name: "SUITE B A-102", x: 150 / W, y: 50 / H },
      { name: "CORRIDOR A-103", x: 100 / W, y: 20 / H },
    ];
    const r = partitionAtNecks(walls, W, H, seeds, { neck: 6, minRoomPx: 50 });
    expect(r.labels[20 * W + 100]).toBe(3);
    expect(r.labels[90 * W + 30]).toBe(1);
    expect(r.labels[90 * W + 170]).toBe(2);
  });
});
