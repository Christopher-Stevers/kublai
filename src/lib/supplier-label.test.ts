import { describe, expect, it } from "vitest";
import {
  applicablePriceBook,
  orderPriceBookLabel,
  supplierLabel,
} from "./supplier-label";
const entries = [
  {
    supplierId: "next",
    supplierPartId: "listing",
    partDefinitionId: "wye",
    priceBookName: "Alma",
    preferJobPricing: true,
  },
];
describe("supplier price book labels", () => {
  it("uses the job book only for included parts and the correct supplier", () => {
    expect(applicablePriceBook(entries, "next", "wye", "listing")).toBe("Alma");
    expect(applicablePriceBook(entries, "next", "elbow")).toBe("Standard");
    expect(applicablePriceBook(entries, "other", "wye")).toBe("Standard");
    expect(
      applicablePriceBook(
        [{ ...entries[0]!, preferJobPricing: false }],
        "next",
        "wye",
      ),
    ).toBe("Standard");
  });
  it("keeps names intact and missing suppliers unlabelled", () => {
    expect(supplierLabel("Next", "Alma")).toBe("Next (Alma)");
    expect(supplierLabel("Fastening House")).toBe("Fastening House (Standard)");
    expect(supplierLabel(null)).toBe("No supplier");
  });
  it("shows mixed and missing historical books without guessing", () => {
    expect(
      orderPriceBookLabel([
        { priceBookNameSnapshot: "Alma" },
        { priceBookNameSnapshot: "Standard" },
        { priceBookNameSnapshot: "Alma" },
      ]),
    ).toBe("Alma / Standard");
    expect(orderPriceBookLabel([{}])).toBe("Not recorded");
  });
});
