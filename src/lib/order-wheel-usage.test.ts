import { expect, it } from "vitest";
import {
  orderWheelUsage,
  wheelUsageId,
  type OrderedFacet,
} from "./order-wheel-usage";
const part: OrderedFacet = {
  catalog: "Plumbing",
  material: "XFR",
  groupPath: ["PVC"],
  category: "Elbows",
  nominal: "2",
  unit: "in",
  sizeLabel: null,
  frequency: 3,
};
it("propagates ordered-part frequency into all wheel stages with flat material choices", () => {
  const usage = orderWheelUsage([
    part,
    { ...part, material: "Copper", groupPath: [], frequency: 2 },
  ]);
  expect(usage[wheelUsageId("Select Catalog", "Plumbing")]).toBe(5);
  expect(usage[wheelUsageId("Select Material", "PVC")]).toBeUndefined();
  expect(usage[wheelUsageId("Select Material", "XFR")]).toBe(3);
  expect(usage[wheelUsageId("Select Material", "Copper")]).toBe(2);
  expect(usage[wheelUsageId("Select Size", '2"')]).toBe(5);
  expect(usage[wheelUsageId("Select Category", "Elbows")]).toBe(5);
  expect(usage[wheelUsageId("Select Catalog", "All")]).toBeUndefined();
});
it("handles missing facets and empty order history", () => {
  expect(orderWheelUsage([])).toEqual({});
  const usage = orderWheelUsage([
    {
      ...part,
      material: null,
      groupPath: null,
      category: null,
      nominal: null,
      unit: null,
    },
  ]);
  expect(usage).toEqual({ [wheelUsageId("Select Catalog", "Plumbing")]: 3 });
});

it("ranks an exact combination without also boosting the broad nominal size", () => {
  const usage = orderWheelUsage([
    { ...part, sizeLabel: "2 x 1", frequency: 7 },
  ]);
  expect(usage[wheelUsageId("Select Size", '2" x 1"')]).toBe(7);
  expect(usage[wheelUsageId("Select Size", '2"')]).toBeUndefined();
  expect(usage[wheelUsageId("Select Size", "2 in")]).toBeUndefined();
});
