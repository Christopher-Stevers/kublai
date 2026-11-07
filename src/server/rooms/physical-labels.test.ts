import { describe, expect, it } from "vitest";
import { physicalRoomSeeds, splitPhysicalRoomSeeds } from "./physical-labels";

describe("physical room anchors", () => {
  it("keeps apartment descriptions from inventing bedrooms or partitioning a living room", () => {
    const names = [
      "2 BEDROOM",
      "1 BEDROOM-BF",
      "2 BEDROOM-BF",
      "2BEDROOM",
      " 3-Bedrooms ",
      "2 BEDROOM–BF",
      "1 BEDROOM BARRIER FREE",
      "2 BR UNIT",
      "2 BDRM SUITE",
    ];
    const seeds = names.map((name) => ({
      name,
      kind: "room" as const,
      x: 0.4,
      y: 0.4,
    }));
    const { physical, unitContext } = splitPhysicalRoomSeeds(seeds);
    expect(physical).toEqual([]);
    expect(unitContext).toEqual(seeds);
  });

  it("preserves numbered bedrooms, unlabeled trade names and corridor anchors", () => {
    const names = [
      "BEDROOM",
      "BEDROOM 2",
      "BEDROOM-2",
      "2ND BEDROOM",
      "BEDROOM #2",
      "MAIN LOBBY",
      "CORRIDOR",
      "EXIT CORRIDOR",
      "STAIR A",
      "JANITOR",
      "UNIV. WASHROOM",
      "2. BEDROOM",
    ];
    const seeds = names.map((name) => ({ name, x: 0.2, y: 0.3 }));
    expect(physicalRoomSeeds(seeds)).toEqual(seeds);
    expect(splitPhysicalRoomSeeds(seeds).unitContext).toEqual([]);
  });

  it("retains explicit unit anchors separately even when their name looks like a room", () => {
    const unit = Object.freeze({
      name: "STUDIO",
      kind: "unit" as const,
      x: 0.1,
      y: 0.2,
      areaSqFt: 500,
    });
    const room = Object.freeze({
      name: "BEDROOM 2",
      kind: "room" as const,
      x: 0.5,
      y: 0.6,
      areaSqFt: 120,
    });
    const seeds = Object.freeze([unit, room]);
    const result = splitPhysicalRoomSeeds(seeds);
    expect(result.physical).toEqual([room]);
    expect(result.unitContext).toEqual([unit]);
    expect(result.physical[0]).toBe(room);
    expect(result.unitContext[0]).toBe(unit);
    expect(seeds).toEqual([unit, room]);
  });

  it("does not discard a room because an annotation contains a bedroom count", () => {
    const seeds = [
      { name: "LOBBY TO 2 BEDROOM UNITS" },
      { name: "2 BEDROOM WALL DETAIL" },
      { name: "CORRIDOR 2 BR" },
    ];
    expect(physicalRoomSeeds(seeds)).toEqual(seeds);
  });
});
