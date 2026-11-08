import { describe, expect, it } from "vitest";
import { dragScrollVelocity } from "./drag-scroll";

describe("drag edge scrolling", () => {
  it("starts near the edge and accelerates toward it in either direction", () => {
    expect(dragScrollVelocity(500, 100, 900)).toBe(0);
    const speeds = [220, 140, 60, 0].map(distance => dragScrollVelocity(900 - distance, 100, 900));
    expect(speeds[0]).toBeGreaterThan(0);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]!);
    expect(speeds.at(-1)).toBe(3000);
    for (const distance of [220, 140, 60, 0]) {
      expect(dragScrollVelocity(100 + distance, 100, 900)).toBe(-dragScrollVelocity(900 - distance, 100, 900));
    }
  });
  it("caps speed outside the viewport and keeps a neutral middle on short screens", () => {
    expect(dragScrollVelocity(-100, 100, 900)).toBe(-3000);
    expect(dragScrollVelocity(1100, 100, 900)).toBe(3000);
    expect(dragScrollVelocity(200, 100, 300)).toBe(0);
    expect(dragScrollVelocity(200, 300, 100)).toBe(0);
  });
});
