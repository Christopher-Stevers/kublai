import { expect, it } from "vitest";
import { slipBackorderCheck as check } from "./slip-backorder-check";
it("distinguishes matching, missing and contradictory BO including zero shipped", () => {
  expect(check({ ordered: 10, shipped: 0, backordered: 10 })?.ok).toBe(true);
  expect(check({ ordered: 10, shipped: 6, backordered: 4 })?.ok).toBe(true);
  expect(check({ ordered: 10, shipped: 6, backordered: 0 })?.label).toContain("BO mismatch");
  expect(check({ ordered: 10, shipped: 6, backordered: null })?.label).toContain("not found");
  expect(check({ ordered: 10, shipped: 6, backordered: 5 })?.ok).toBe(false);
});
it("compares printed quantities without mixing boxes and pieces or returns", () => {
  expect(check({ ordered: 300, shipped: 200, backordered: 100, unit: "pcs" })?.ok).toBe(true);
  expect(check({ ordered: 3, shipped: 2, backordered: 1, unit: "box" })?.label).toContain("1 box");
  expect(check({ ordered: 10, shipped: 10 })).toBeNull();
  expect(check({ ordered: 10, shipped: null })).toBeNull();
  expect(check({ ordered: 10, shipped: -2 })).toBeNull();
});
