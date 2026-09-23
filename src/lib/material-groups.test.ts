import { describe, expect, it } from "vitest";
import {
  initialPvcGroup,
  materialGroupEntries,
  materialGroupPathSchema,
} from "./material-groups";
const materials = [
  { id: "xfr", name: "XFR", groupPath: ["PVC"], count: 10 },
  { id: "dwv", name: "PVC DWV", groupPath: ["PVC"], count: 15 },
  {
    id: "dr25",
    name: "Gasketed DR25",
    groupPath: ["PVC", "Gasketed SDR"],
    count: 20,
  },
  {
    id: "dr35",
    name: "Gasketed DR35",
    groupPath: ["PVC", "Gasketed SDR"],
    count: 30,
  },
  { id: "copper", name: "Copper", count: 12 },
];
describe("material groups", () => {
  it("aggregates all descendants once and hides them at the root", () => {
    expect(materialGroupEntries(materials)).toEqual([
      expect.objectContaining({ kind: "material", name: "Copper" }),
      expect.objectContaining({
        kind: "group",
        name: "PVC",
        count: 75,
        materialCount: 4,
      }),
    ]);
  });
  it("shows intermediate groups and returns the original material IDs at leaves", () => {
    expect(
      materialGroupEntries(materials, ["PVC"]).map((row) => row.name),
    ).toEqual(["Gasketed SDR", "PVC DWV", "XFR"]);
    const children = materialGroupEntries(materials, ["PVC", "Gasketed SDR"]);
    expect(
      children.map((row) => row.kind === "material" && row.material.id),
    ).toEqual(["dr25", "dr35"]);
  });
  it("coalesces case differences and keeps legacy offline materials at the root", () => {
    expect(
      materialGroupEntries([
        ...materials,
        { id: "other", name: "Other PVC", groupPath: ["pvc"], count: 2 },
      ]).filter((row) => row.kind === "group"),
    ).toHaveLength(1);
    expect(
      materialGroupEntries([{ id: "legacy", name: "Legacy" }])[0]?.kind,
    ).toBe("material");
  });
  it("validates bounded paths and supports ungrouping", () => {
    expect(materialGroupPathSchema.parse([])).toEqual([]);
    expect(materialGroupPathSchema.parse([" PVC "])).toEqual(["PVC"]);
    for (const value of [[""], ["PVC/SDR"], Array(6).fill("group")])
      expect(materialGroupPathSchema.safeParse(value).success).toBe(false);
  });
  it("seeds only known PVC families", () => {
    expect(initialPvcGroup("XFR")).toEqual(["PVC"]);
    expect(initialPvcGroup("Gasketed DR35")).toEqual(["PVC", "Gasketed SDR"]);
    expect(initialPvcGroup("PVC Sch 80")).toEqual(["PVC"]);
    expect(initialPvcGroup("Copper")).toBeNull();
    expect(initialPvcGroup("CPVC Sch 80")).toBeNull();
  });
});
