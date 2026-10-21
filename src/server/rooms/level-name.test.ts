import { describe, expect, it } from "vitest";
import { roomLevelName } from "./level-name";

describe("Rooms level labels", () => {
  it.each([
    ["Level P1", "Level P1"],
    ["Level 9 NB - MPH SB", "Level 9 NB - Mechanical Penthouse SB"],
    ["MPH NB - Roof Plan SB", "Mechanical Penthouse NB - Roof Plan SB"],
    ["LEVEL ONE FLOOR PLAN", "Level 1"],
    ["GROUND FLOOR PLAN", "Level 1"],
    ["FLOOR 8 PLAN", "Level 8"],
    ["EIGHTH FLOOR PLAN", "Level 8"],
    ["8TH FLOOR - MECHANICAL", "Level 8"],
    ["MECHANICAL PENTHOUSE PLAN", "Mechanical Penthouse"],
    ["BASEMENT FLOOR PLAN", "Basement"],
    ["LEVEL 02 FLOOR PLAN", "Level 2"],
    ["LEVEL 1 AND LEVEL 2", "LEVEL 1 AND LEVEL 2"],
    ["LOWER GROUND FLOOR", "Lower Ground"],
  ])("labels %s as %s", (title, expected) => {
    expect(roomLevelName(title, "A-108")).toBe(expected);
  });
  it("does not interpret drawing IDs or source page numbers as levels", () => {
    expect(roomLevelName(undefined, "A-108")).toBe("A-108");
    expect(roomLevelName("GENERAL PLAN", "page 8")).toBe("page 8");
    expect(roomLevelName(undefined, "Floor 8")).toBe("Level 8");
  });
});
