import { describe, expect, it } from "vitest";

import type { PdfLabel } from "../pdf-walls";
import { findRoomTagSeeds, mergeRoomSeeds } from "./room-tags";

/** A horizontal label at (x, y) whose text spans ~`w` (normalized units). */
const label = (name: string, x: number, y: number, w = 0.012, angle = 0): PdfLabel => ({
  name,
  x,
  y,
  angle,
  anchors: [
    { x: x - w * 0.4, y },
    { x: x + w * 0.4, y },
  ],
});

describe("findRoomTagSeeds", () => {
  it("pairs room names above room tags and ignores door tags", () => {
    const labels = [
      label("SUITE K", 0.3, 0.3),
      label("A-S105", 0.3, 0.304, 0.01),
      label("EXIT CORRIDOR", 0.5, 0.4, 0.02),
      label("A-118", 0.5, 0.404, 0.008),
      label("JANITOR", 0.6, 0.5),
      label("A-119", 0.6, 0.504, 0.008),
      // Door tag repeating a room number, nothing written above it.
      label("A-118a", 0.55, 0.45, 0.008),
      label("A-119", 0.7, 0.7, 0.008),
    ];
    const seeds = findRoomTagSeeds(labels);
    expect(seeds.map((s) => s.name).sort()).toEqual(["EXIT CORRIDOR A-118", "JANITOR A-119", "SUITE K A-S105"]);
    const janitor = seeds.find((s) => s.tag === "A-119")!;
    expect(janitor.y).toBeGreaterThan(0.5);
    expect(janitor.y).toBeLessThan(0.504);
  });

  it("reads unit tags written above their type (N221 / MICRO)", () => {
    const labels = [
      label("N221", 0.2, 0.2, 0.006),
      label("MICRO", 0.2, 0.204, 0.008),
      label("28.5 m²", 0.2, 0.208),
      label("N222", 0.3, 0.2, 0.006),
      label("2 BD", 0.3, 0.204, 0.006),
      label("N223", 0.4, 0.2, 0.006),
      label("NANO", 0.4, 0.204, 0.006),
    ];
    expect(findRoomTagSeeds(labels).map((s) => s.name).sort()).toEqual(["N221 MICRO", "N222 2 BD", "N223 NANO"]);
  });

  it("ignores title-block text at the sheet edge", () => {
    const labels = [label("DWG No.", 0.95, 0.95), label("A202", 0.95, 0.954, 0.008)];
    expect(findRoomTagSeeds(labels)).toEqual([]);
  });

  it("does not seed a named room twice", () => {
    const tags = findRoomTagSeeds([label("STAIR B", 0.4, 0.4), label("A-117", 0.4, 0.404, 0.008), label("LOBBY", 0.1, 0.1), label("A-102", 0.1, 0.104, 0.008), label("VESTIBULE", 0.8, 0.8), label("A-101", 0.8, 0.804, 0.008)]);
    const merged = mergeRoomSeeds(tags, [
      { name: "STAIR B", x: 0.4, y: 0.4 },
      { name: "GARBAGE", x: 0.6, y: 0.6 },
    ]);
    expect(merged.map((s) => s.name).sort()).toEqual(["GARBAGE", "LOBBY A-102", "STAIR B A-117", "VESTIBULE A-101"]);
  });
});
