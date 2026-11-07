import { expect, it } from "vitest";
import { catalogueHideCriteriaSchema, isPartHidden, sameCriteria, visibleParts } from "./catalogue-hidden";
import { addHideRule, removeHideRule } from "~/server/catalogue/hidden-parts";

const part = { id: "p1", catalogId: "c1", materialId: "m1", sizeNominal: "0.500", sizeUnit: "in", categoryId: "k1" };

it("hides a part only when it matches every criterion the rule sets", () => {
  expect(isPartHidden(part, [{ catalogId: "c1" }])).toBe(true);
  expect(isPartHidden(part, [{ catalogId: "c1", materialId: "m2" }])).toBe(false);
  expect(isPartHidden(part, [{ size: { nominal: 0.5, unit: "in" }, categoryId: "k1" }])).toBe(true);
  expect(isPartHidden(part, [{ size: { nominal: 0.5, unit: "mm" } }])).toBe(false);
  expect(isPartHidden({ ...part, sizeNominal: null }, [{ size: { nominal: 0, unit: "in" } }])).toBe(false);
  expect(isPartHidden(part, [{ partId: "p2" }, { materialId: "m1" }])).toBe(true);
});

it("keeps grouped summary rows that carry no part id under a single-part rule", () => {
  const facet = { ...part, id: undefined };
  expect(visibleParts([facet], [{ partId: "p1" }])).toEqual([facet]);
  expect(visibleParts([part], [{ partId: "p1" }])).toEqual([]);
});

it("refuses a rule that would hide everything", () => {
  expect(catalogueHideCriteriaSchema.safeParse({}).success).toBe(false);
  expect(catalogueHideCriteriaSchema.safeParse({ materialId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
});

it("adds a rule once and removes it by id", () => {
  const once = addHideRule({ materialId: "m1" })([]);
  expect(addHideRule({ materialId: "m1" })(once)).toBe(once);
  expect(sameCriteria(once[0]!, { materialId: "m1" })).toBe(true);
  const twice = addHideRule({ materialId: "m1", size: { nominal: 1, unit: "in" } })(once);
  expect(twice).toHaveLength(2);
  expect(removeHideRule(once[0]!.id)(twice)).toEqual([twice[1]]);
});


import { restoreHiddenSelection } from "./catalogue-hidden";
it("restores a child without exposing siblings and can hide it again", () => {
  const rules = restoreHiddenSelection([{ id: "rule", catalogId: "catalog" }], [{ partId: "one" }]);
  const part = { catalogId: "catalog", materialId: null, sizeNominal: null, sizeUnit: null, categoryId: null };
  expect(isPartHidden({ ...part, id: "one" }, rules)).toBe(false);
  expect(isPartHidden({ ...part, id: "two" }, rules)).toBe(true);
  expect(isPartHidden({ ...part, id: "one" }, [...rules, { partId: "one" }])).toBe(true);
  expect(restoreHiddenSelection(rules, [{ catalogId: "catalog" }])).toEqual([]);
});
