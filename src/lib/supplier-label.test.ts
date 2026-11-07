import { describe, expect, it } from "vitest";
import {
  applicablePriceBook,
  orderPriceBookLabel,
  supplierLabel,
  supplierVersionLabel,
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
    expect(supplierLabel("Next", "Alma")).toBe("Next - Alma");
    expect(supplierLabel("Fastening House")).toBe("Fastening House");
    expect(supplierLabel("Next", "Standard")).toBe("Next");
    expect(supplierLabel("Next", " standard ")).toBe("Next");
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

it("updates old book snapshots while preserving parentheses in supplier names", () => {
  expect(supplierVersionLabel({label:"Next (Alma)",bookId:"book"})).toBe("Next - Alma");
  expect(supplierVersionLabel({label:"ACME (East) (Alma)",bookId:"book"})).toBe("ACME (East) - Alma");
  expect(supplierVersionLabel({label:"ACME (East)",bookId:null})).toBe("ACME (East)");
  expect(supplierVersionLabel({label:"Next - Alma",bookId:"book"})).toBe("Next - Alma");
});
