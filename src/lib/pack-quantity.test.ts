import { describe, it, expect } from "vitest";
import {
  formatPackQuantity,
  pickerQuantity,
  pickerIndex,
  packsFromPieces,
  pieceCount,
} from "./pack-quantity";
import { purchaseQuantity, purchaseLineTotal } from "./purchase-quantity";
import { planPrefabAdd } from "./prefab-add";

describe("pack contents separate from order multiples", () => {
  it("shows whole packs first and actual pieces required second", () => {
    expect(formatPackQuantity(2, 50)).toBe("2 (x100)");
    expect(formatPackQuantity(0.2, 50)).toBe("1 (x10)");
    expect(formatPackQuantity(1.4, 50)).toBe("2 (x70)");
  });
  it("moves past zero into pieces and back without changing pack prices", () => {
    expect(pickerQuantity(2, 50)).toBe(2);
    expect(pickerQuantity(-10, 50)).toBe(0.2);
    expect(pickerIndex(0.2, 50)).toBe(-10);
    expect(pickerQuantity(-10, null)).toBe(0);
    expect(purchaseQuantity(0.2, null, 50)).toBe(1);
    expect(purchaseQuantity(1.4, null, 50)).toBe(2);
    expect(purchaseLineTotal(1.4, 25, null, 50)).toBe(50);
    expect(purchaseQuantity(1.4, 5, 50)).toBe(5);
    expect(purchaseQuantity(0.2, null, null)).toBe(0.2);
  });
  it("sums pieces across prefabs before rounding to whole packs", () => {
    const prefab = [
      {
        partDefinitionId: "clips",
        supplierPartId: null,
        quantity: 0.2,
        piecesPerPack: 50,
      },
    ];
    const first = planPrefabAdd(prefab, [], 3).adds[0]!;
    expect(first.quantity).toBe(0.6);
    const second = planPrefabAdd(prefab, [{ ...first, id: "line" }], 4)
      .updates[0]!;
    expect(second.quantity).toBe(1.4);
    expect(formatPackQuantity(second.quantity, 50)).toBe("2 (x70)");
  });
  it("avoids cumulative rounding errors for 3000-piece packs", () => {
    const q = packsFromPieces(1, 3000);
    expect(pieceCount(q, 3000)).toBe(1);
    const prefab = [
      {
        partDefinitionId: "screws",
        supplierPartId: null,
        quantity: q,
        piecesPerPack: 3000,
      },
    ];
    expect(planPrefabAdd(prefab, [], 3000).adds[0]!.quantity).toBe(1);
    let quantity = 0;
    for (let i = 0; i < 3000; i++)
      quantity = planPrefabAdd(
        prefab,
        [
          {
            id: "line",
            partDefinitionId: "screws",
            supplierPartId: null,
            quantity,
          },
        ],
        1,
      ).updates[0]!.quantity;
    expect(quantity).toBe(1);
  });
});
