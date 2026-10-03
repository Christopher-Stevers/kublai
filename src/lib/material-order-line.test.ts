import { describe, expect, it } from "vitest";
import { matchesMaterialOrderLine } from "./material-order-line";

describe("delivery matching by room", () => {
  const part = {
    roomId: "kitchen",
    supplierId: "supplier",
    supplierPart: { id: "sku" },
    partDefinition: { id: "part" },
  };
  it("does not verify an identical SKU or part for a different room", () => {
    expect(
      matchesMaterialOrderLine(
        part,
        { roomId: "hall", supplierPartId: "sku", partDefinitionId: "part" },
        "supplier",
      ),
    ).toBe(false);
    expect(
      matchesMaterialOrderLine(
        part,
        { roomId: null, supplierPartId: "sku" },
        "supplier",
      ),
    ).toBe(false);
    expect(
      matchesMaterialOrderLine(
        part,
        { roomId: "kitchen", supplierPartId: "sku" },
        "supplier",
      ),
    ).toBe(true);
  });
  it("preserves legacy blank-room matching and supplier checks", () => {
    expect(
      matchesMaterialOrderLine(
        { ...part, roomId: undefined },
        { supplierPartId: "sku" },
        "supplier",
      ),
    ).toBe(true);
    expect(
      matchesMaterialOrderLine(
        part,
        { roomId: "kitchen", partDefinitionId: "part" },
        "supplier",
      ),
    ).toBe(true);
    expect(
      matchesMaterialOrderLine(
        part,
        { roomId: "kitchen", partDefinitionId: "part" },
        "other",
      ),
    ).toBe(false);
  });
});
