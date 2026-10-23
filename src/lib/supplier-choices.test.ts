import { expect, it } from "vitest";
import { buildSupplierChoices } from "./supplier-choices";
const suppliers = [
  { id: "next", name: "Next", kind: "external" },
  { id: "fastening", name: "Fastening House" },
  { id: "room", name: "Company tools", kind: "tool_room" },
];
const listing = {
  id: "listing",
  supplierId: "next",
  supplierSku: "NX1",
  lastKnownUnitCost: "10",
  isPreferred: true,
  supplier: suppliers[0]!,
};
const quoted = {
  supplierId: "next",
  supplierName: "Next",
  supplierPartId: "listing",
  partDefinitionId: "part",
  priceBookName: "Alma",
  supplierPriceBookId: "book",
  unitCost: "6",
};
it("lists plain suppliers separately from job quotes and preserves each price source", () => {
  const groups = buildSupplierChoices("part", suppliers, [listing], [quoted]);
  expect(groups.standard.map((option) => option.label)).toEqual([
    "Fastening House",
    "Next",
  ]);
  expect(groups.standard[1]).toMatchObject({
    version: { bookId: null },
    listing: { lastKnownUnitCost: "10" },
  });
  expect(groups.jobSpecific).toMatchObject([
    {
      label: "Next - Alma",
      version: { bookId: "book" },
      listing: { lastKnownUnitCost: "6" },
    },
  ]);
  expect(listing.lastKnownUnitCost).toBe("10");
});
it("shows only this part's job quotes and collapses repeated suppliers and books", () => {
  const groups = buildSupplierChoices("other", suppliers, [listing], [quoted]);
  expect(groups.jobSpecific).toEqual([]);
  const duplicate = buildSupplierChoices(
    "part",
    suppliers,
    [listing, { ...listing, id: "second" }],
    [quoted, quoted],
  );
  expect(duplicate.standard).toHaveLength(2);
  expect(duplicate.jobSpecific).toHaveLength(1);
});
it("excludes tool room suppliers from listings, quotes, and older offline snapshots", () => {
  const room = { id: "old-room", name: "Tool Room" };
  const groups = buildSupplierChoices(
    "part",
    [...suppliers, room],
    [{ ...listing, supplierId: room.id, supplier: room }],
    [{ ...quoted, supplierId: "room" }],
  );
  expect(groups.standard.map((option) => option.label)).toEqual([
    "Fastening House",
    "Next",
  ]);
  expect(groups.jobSpecific).toEqual([]);
});
it("keeps missing quoted prices unpriced and offers explicit quotes even if automatic pricing is disabled", () => {
  const groups = buildSupplierChoices(
    "part",
    suppliers,
    [listing],
    [{ ...quoted, unitCost: null, preferJobPricing: false }],
  );
  expect(groups.jobSpecific[0]?.listing.lastKnownUnitCost).toBeNull();
  expect(groups.standard[1]?.listing.lastKnownUnitCost).toBe("10");
});
