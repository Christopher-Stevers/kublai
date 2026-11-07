import { describe, expect, it } from "vitest";
import {
  formatPurchaseQuantity,
  purchaseLineTotal,
  purchaseQuantity,
} from "./purchase-quantity";
import { planPrefabAdd } from "./prefab-add";

describe("supplier purchase quantities", () => {
  it.each([
    [37, 25, 50],
    [51, 25, 75],
    [25, 25, 25],
    [1, 50, 50],
    [0, 25, 0],
    [0.3, 0.1, 0.3],
    [1.1, 0.25, 1.25],
  ])(
    "%s required in multiples of %s purchases %s",
    (required, multiple, expected) => {
      expect(purchaseQuantity(required, multiple)).toBe(expected);
    },
  );
  it("keeps legacy quantities unchanged when no order rule exists", () => {
    for (const multiple of [null, undefined, "", "bad", 0, -1])
      expect(purchaseQuantity(37, multiple)).toBe(37);
    expect(purchaseQuantity("bad", 25)).toBe(0);
  });
  it("prices the purchase quantity and displays the original demand", () => {
    expect(purchaseLineTotal(37, "0.20", 25)).toBe(10);
    expect(purchaseLineTotal(3, "1.10")).toBe(3.3);
    expect(purchaseLineTotal(1, "1.0050")).toBe(1.01);
    expect(formatPurchaseQuantity(37, 50)).toBe("37 (50)");
    expect(formatPurchaseQuantity(50, 50)).toBe("50");
  });
  it("combines repeated prefab demand before purchasing any packs", () => {
    const prefab = [
      { partDefinitionId: "clip", supplierPartId: "supplier", quantity: 10 },
    ];
    const first = planPrefabAdd(prefab, [], 3).adds[0]!;
    const second = planPrefabAdd(prefab, [{ ...first, id: "line" }], 3)
      .updates[0]!;
    expect(second.quantity).toBe(60);
    expect(purchaseQuantity(second.quantity, 25)).toBe(75);
    expect(prefab[0]!.quantity).toBe(10);
  });
});
