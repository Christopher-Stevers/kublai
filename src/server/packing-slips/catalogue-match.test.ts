// @vitest-environment node
import { expect, it } from "vitest";
import { catalogueRanker, type CataloguePart } from "./catalogue-match";

const part = (
  id: string,
  name: string,
  more: Partial<CataloguePart> = {},
): CataloguePart => ({
  id,
  name,
  description: null,
  photoUrl: null,
  catalogId: "c",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
  aliases: [],
  codes: [],
  ...more,
});
const catalogue = [
  part("elbow-half", '1/2" Copper 90 Elbow C x C'),
  part("elbow-three-quarter", '3/4" Copper 90 Elbow C x C'),
  part("coupling-half", '1/2" Copper Coupling'),
  part("valve", '3/4" Brass Ball Valve', { aliases: ["BV 3/4 FIP"] }),
  part("tape", "Teflon Tape", { codes: ["TT-12"] }),
];

it("ranks the part of the same size and kind first, from supplier abbreviations", () => {
  const rank = catalogueRanker(catalogue);
  const likely = rank({ code: "", text: "1/2 CXC 90 ELL WROT" });
  expect(likely[0]).toMatchObject({ id: "elbow-half", code: false });
  // A different size is not a likely match for this line.
  expect(
    likely.find((p) => p.id === "elbow-three-quarter")?.score ?? 0,
  ).toBeLessThan(likely[0]!.score / 2);
});

it("lets this supplier's code decide, and reads earlier slip names", () => {
  const rank = catalogueRanker(catalogue);
  expect(rank({ code: "TT12", text: "PTFE 1/2 X 520" })[0]).toMatchObject({
    id: "tape",
    code: true,
  });
  expect(rank({ code: "", text: "BV 3/4 FIP" })[0]?.id).toBe("valve");
});

it("offers nothing for an unrelated line", () => {
  const rank = catalogueRanker(catalogue);
  expect(rank({ code: "", text: "Freight charge" })).toEqual([]);
  expect(catalogueRanker([])({ code: "", text: "elbow" })).toEqual([]);
});

it("keeps typed name matches and returns a chosen part", () => {
  const rank = catalogueRanker(catalogue);
  expect(
    rank({ code: "", text: "copper" }, { limit: 50, min: 0.15, typed: true })
      .map((p) => p.id)
      .sort(),
  ).toEqual(["coupling-half", "elbow-half", "elbow-three-quarter"]);
  expect(rank.part("tape")).toMatchObject({ id: "tape", name: "Teflon Tape" });
  expect(rank.part("gone")).toBeUndefined();
});
