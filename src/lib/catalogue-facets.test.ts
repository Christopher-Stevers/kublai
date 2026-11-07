import { describe, expect, it } from "vitest";
import { expandLegacyFacets, facetCount } from "./catalogue-facets";

describe("catalogue facet weights", () => {
  it("preserves counts across grouped server and per-part offline records", () => {
    const grouped = [
      { material: "XFR", count: 12 },
      { material: "PVC", count: 4 },
    ];
    const legacy = expandLegacyFacets(grouped);
    expect(legacy).toHaveLength(16);
    for (const material of ["XFR", "PVC"]) {
      expect(
        grouped
          .filter((p) => p.material === material)
          .reduce((sum, p) => sum + facetCount(p), 0),
      ).toBe(legacy.filter((p) => p.material === material).length);
    }
    expect(facetCount({})).toBe(1);
  });
});
