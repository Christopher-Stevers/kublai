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
it("propagates ordered-part frequency into all wheel stages and material groups", () => {
  const usage = orderWheelUsage([
    part,
    { ...part, material: "Copper", groupPath: [], frequency: 2 },
  ]);
  expect(usage[wheelUsageId("Select Catalog", "Plumbing")]).toBe(5);
  expect(usage[wheelUsageId("Select Material", "PVC")]).toBe(3);
  expect(usage[wheelUsageId("Select PVC type", "XFR")]).toBe(3);
  expect(usage[wheelUsageId("Select Material", "Copper")]).toBe(2);
  expect(usage[wheelUsageId("Select Size", "2 in")]).toBe(5);
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
