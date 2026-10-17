import { describe, expect, it } from "vitest";
import { planPrefabAdd } from "./prefab-add";

const prefab = [
  { partDefinitionId: "pipe", supplierPartId: "pipe-a", quantity: 10 },
  { partDefinitionId: "elbow", supplierPartId: "elbow-a", quantity: 4 },
  { partDefinitionId: "tape", supplierPartId: null, quantity: 0.1 },
];

describe("planPrefabAdd", () => {
  it("adds every part times the multiplier to an empty list", () => {
    const plan = planPrefabAdd(prefab, [], 3);
    expect(plan.updates).toEqual([]);
    expect(plan.adds.map((line) => [line.partDefinitionId, line.quantity])).toEqual([
      ["pipe", 30],
      ["elbow", 12],
      ["tape", 0.3],
    ]);
  });

  it("adds to the existing line, preferring the same supplier", () => {
    const plan = planPrefabAdd(
      prefab,
      [
        { id: "l1", partDefinitionId: "pipe", supplierPartId: "pipe-b", quantity: "5" },
        { id: "l2", partDefinitionId: "pipe", supplierPartId: "pipe-a", quantity: "2" },
        { id: "l3", partDefinitionId: "elbow", supplierPartId: "elbow-b", quantity: "1" },
      ],
      2,
    );
    expect(plan.updates).toEqual([
      { itemId: "l2", quantity: 22 },
      { itemId: "l3", quantity: 9 },
    ]);
    expect(plan.adds.map((line) => line.partDefinitionId)).toEqual(["tape"]);
  });

  it("skips a zero multiplier", () => {
    expect(planPrefabAdd(prefab, [], 0)).toEqual({ updates: [], adds: [] });
  });
});

it("adds a new editable row when the matching existing item is locked", () => {
  const plan = planPrefabAdd([prefab[0]!], [{id:"sent",partDefinitionId:"pipe",supplierPartId:"pipe-a",quantity:10,sentOrderItemId:"order-line"}], 1);
  expect(plan.updates).toEqual([]);
  expect(plan.adds).toHaveLength(1);
});
