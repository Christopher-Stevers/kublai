import { describe, expect, it } from "vitest";
import type { ReceiptOrderItem } from "./packing-slip-review";
import { partFit, statedSizes, type PartFacts } from "./slip-part-fit";

const item = (more: Partial<ReceiptOrderItem>): ReceiptOrderItem => ({
  id: "item",
  description: "",
  sku: null,
  aliases: [],
  ordered: 1,
  received: 0,
  verificationStatus: "",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
  ...more,
});
const facts = (more: Partial<PartFacts> = {}): PartFacts => ({
  partId: "part",
  name: "",
  bulkUnit: null,
  supplierSku: null,
  supplierName: null,
  units: [],
  ...more,
});
const nut = item({
  description: "HEX NUT GR2 ZINC 3/8-16 - BULK (Bulk Box = 2500pcs)",
  unit: "box",
});
const nutLine = {
  quantity: 2500,
  unit: "box",
  description: "HEX NUT GR2 ZC,3/8-16",
  sku: "HN38G2ZB",
  evidence: "HN38G2ZB HEX NUT GR2 ZC,3/8-16 2500 2500 0",
};
const nutFacts = facts({ name: nut.description, units: ["box"] });
const rod = item({
  description: "3/8 THREADED ROD ZINC X 10FT",
  ordered: 50,
});
const rodLine = {
  quantity: 500,
  unit: "ea",
  description: "THREADED ROD ZP 10FT",
  sku: "",
};
const edit = { canEdit: true };

describe("statedSizes", () => {
  it("reads pack and length sizes, not thread sizes", () => {
    expect(statedSizes([nut.description])).toEqual([
      { size: 2500, unit: "ea" },
    ]);
    expect(statedSizes([rod.description])).toEqual([{ size: 10, unit: "ft" }]);
    expect(statedSizes(["SCREW 1000/BX", "TAPE 250 FT/ROLL"])).toEqual([
      { size: 1000, unit: "ea" },
      { size: 250, unit: "ft" },
    ]);
    expect(statedSizes(["1-1/2 COUPLING", "3/8-16 NUT"])).toEqual([]);
  });
});

describe("partFit", () => {
  it("reads a box counted in pieces and offers the pack size, code and name", () => {
    expect(partFit(nut, nutLine, nutFacts, edit)).toEqual({
      reason:
        "The slip shows 2500 where the order needs 1 box. That is 1 box of 2500 ea each.",
      quantity: 1,
      read: 2500,
      rows: [
        { label: "Pack size", before: "Not set", after: "2500 ea per box" },
        { label: "Supplier code", before: "Not set", after: "HN38G2ZB" },
        {
          label: "Supplier's name",
          before: "Not set",
          after: "HEX NUT GR2 ZC,3/8-16",
        },
      ],
      update: {
        piecesPerPack: 2500,
        individualUnit: "ea",
        bulkUnit: "box",
        supplierSku: "HN38G2ZB",
        supplierName: "HEX NUT GR2 ZC,3/8-16",
      },
    });
  });

  it("reads rods counted in feet", () => {
    const fit = partFit(rod, rodLine, facts({ name: rod.description }), edit);
    expect(fit).toMatchObject({
      quantity: 50,
      read: 500,
      update: { piecesPerPack: 10, individualUnit: "ft", bulkUnit: "ea" },
    });
    expect(fit!.rows[0]).toEqual({
      label: "Pack size",
      before: "Not set",
      after: "10 ft per ea",
    });
    // The slip's name differs, but the listing already has one.
    expect(
      partFit(rod, rodLine, facts({ supplierName: "TR38" }), edit)!.update
        .alias,
    ).toBe("THREADED ROD ZP 10FT");
  });

  it("only reads the count for someone who cannot edit parts", () => {
    expect(partFit(nut, nutLine, nutFacts)).toMatchObject({
      quantity: 1,
      rows: [],
      update: {},
    });
  });

  it("leaves the pack size alone where other orders count the part differently", () => {
    const fit = partFit(
      nut,
      nutLine,
      { ...nutFacts, units: ["box", "ea"] },
      edit,
    );
    expect(fit).toMatchObject({ quantity: 1 });
    expect(fit!.held).toMatch(/count this part in ea/);
    expect(fit!.update.piecesPerPack).toBeUndefined();
  });

  it("converts a part that already has its pack size without changing it", () => {
    const packed = { ...nut, piecesPerPack: 2500, individualUnit: "pcs" };
    expect(partFit(packed, nutLine, nutFacts, edit)).toMatchObject({
      quantity: 1,
      rows: [],
    });
    // Corrected by hand to 1 box already: nothing to ask.
    expect(
      partFit(packed, { ...nutLine, quantity: 1, read: 2500 }, nutFacts, edit),
    ).toBeNull();
  });

  it("still offers the pack size after the count was corrected by hand", () => {
    const fit = partFit(
      nut,
      { ...nutLine, quantity: 1, read: 2500 },
      nutFacts,
      edit,
    );
    expect(fit).toMatchObject({ quantity: 1, read: null });
    expect(fit!.update.piecesPerPack).toBe(2500);
  });

  it("asks nothing for a matching or simply larger delivery", () => {
    expect(
      partFit(nut, { ...nutLine, quantity: 1 }, nutFacts, edit),
    ).toBeNull();
    expect(
      partFit(
        item({ ordered: 10 }),
        { ...rodLine, quantity: 20 },
        facts(),
        edit,
      ),
    ).toBeNull();
    expect(
      partFit(item({ ordered: 5 }), { ...rodLine, quantity: 6 }, facts(), edit),
    ).toBeNull();
  });

  it("finds an unwritten box size from a whole multiple", () => {
    expect(
      partFit(
        item({ ordered: 2, unit: "box", description: "WOOD SCREW #8" }),
        {
          ...rodLine,
          quantity: 200,
          unit: "box",
          description: "WOOD SCREW #8",
        },
        facts({ units: ["box"] }),
        edit,
      ),
    ).toMatchObject({ quantity: 2, update: { piecesPerPack: 100 } });
  });

  it("keeps the slip's code and name for a line matched by hand", () => {
    const valve = item({ description: '3/4" Brass Ball Valve', ordered: 6 });
    const line = {
      quantity: 6,
      unit: "ea",
      description: "BV 3/4 FIP",
      sku: "BV-34",
    };
    expect(partFit(valve, line, facts(), edit)).toBeNull();
    expect(
      partFit(valve, line, facts(), { ...edit, byHand: true }),
    ).toMatchObject({
      quantity: 6,
      read: null,
      update: { supplierSku: "BV-34", supplierName: "BV 3/4 FIP" },
    });
    // Already known: nothing to ask.
    expect(
      partFit(
        valve,
        line,
        facts({ supplierSku: "BV-34", supplierName: "BV 3/4 FIP" }),
        { ...edit, byHand: true },
      ),
    ).toBeNull();
  });
});
