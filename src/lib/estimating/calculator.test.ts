// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculator";
import {
  estimateDocumentSchema,
  newEstimateLine,
  type EstimateLine,
} from "./types";
const line = (values: Partial<EstimateLine> = {}) =>
  newEstimateLine({
    id: "one",
    description: "Pipe",
    quantity: 10,
    materialUnitCost: 2,
    priceSource: "manual",
    reviewStatus: "approved",
    ...values,
  });
const doc = (lines: EstimateLine[], settings = {}) =>
  estimateDocumentSchema.parse({
    lines,
    settings: {
      overheadPercent: 0,
      contingencyPercent: 0,
      profitPercent: 0,
      laborRate: 100,
      ...settings,
    },
  });
const fixed = { now: new Date("2026-10-11T12:00:00Z") };
describe("estimate quantity and cost arithmetic", () => {
  it("uses demand for labor and other costs, with waste and packs only affecting material", () => {
    const result = calculateEstimate(
      doc(
        [
          line({
            multiplier: 2,
            wastePercent: 10,
            orderMultiple: 6,
            laborHoursPerUnit: 0.5,
            equipmentUnitCost: 3,
            subcontractUnitCost: 4,
            otherUnitCost: 5,
          }),
        ],
        { productivityFactor: 1.2, laborBurdenPercent: 25 },
      ),
    );
    expect(result.lines[0]).toMatchObject({
      demand: 20,
      requiredQuantity: 22,
      purchaseQuantity: 24,
      materialTotal: 48,
      laborHours: 12,
      laborTotal: 1500,
      equipmentTotal: 60,
      subcontractTotal: 80,
      otherTotal: 100,
      directCost: 1788,
    });
    expect(result.total.directCost).toBe(1788);
  });
  it("rounds one combined purchase for matching part/supplier/unit rather than every prefab row", () => {
    const result = calculateEstimate(
      doc([
        line({
          id: "a",
          quantity: 1,
          partDefinitionId: "part",
          supplierName: "Acme",
          orderMultiple: 10,
        }),
        line({
          id: "b",
          quantity: 1,
          partDefinitionId: "part",
          supplierName: "acme",
          orderMultiple: 10,
        }),
      ]),
    );
    expect(result.total.materialTotal).toBe(20);
    expect(result.lines.map((row) => row.purchaseQuantity)).toEqual([5, 5]);
    expect(result.lines.map((row) => row.materialTotal)).toEqual([10, 10]);
  });
  it("does not combine distinct suppliers, rates or unspecified parts", () => {
    const lines = [
      line({
        id: "a",
        quantity: 1,
        partDefinitionId: "part",
        supplierName: "Acme",
        orderMultiple: 10,
      }),
      line({
        id: "b",
        quantity: 1,
        partDefinitionId: "part",
        supplierName: "Other",
        orderMultiple: 10,
      }),
      line({
        id: "c",
        quantity: 1,
        partDefinitionId: "part",
        supplierName: "Acme",
        materialUnitCost: 3,
        orderMultiple: 10,
      }),
      line({ id: "d", quantity: 1, orderMultiple: 10 }),
      line({ id: "e", quantity: 1, orderMultiple: 10 }),
    ];
    expect(calculateEstimate(doc(lines)).total.materialTotal).toBe(110);
    expect(
      calculateEstimate(doc(lines)).issues.some(
        (issue) => issue.code === "price-conflict",
      ),
    ).toBe(true);
  });
  it("aggregates identical exact pricebook items even without catalogue IDs", () => {
    const result = calculateEstimate(
      doc([
        line({
          id: "a",
          quantity: 1,
          supplierName: "Acme",
          orderMultiple: 10,
          priceSource: "imported",
        }),
        line({
          id: "b",
          quantity: 1,
          supplierName: "Acme",
          orderMultiple: 10,
          priceSource: "imported",
        }),
      ]),
    );
    expect(result.total.materialTotal).toBe(20);
  });
  it("preserves fractional cents with deterministic largest remainder allocation", () => {
    const a = line({
      id: "a",
      quantity: 1,
      supplierPartId: "p",
      materialUnitCost: 0.005,
    });
    const b = line({
      id: "b",
      quantity: 1,
      supplierPartId: "p",
      materialUnitCost: 0.005,
    });
    const result = calculateEstimate(doc([b, a]));
    expect(result.total.cents.materialTotal).toBe(1);
    expect(result.lines.find((row) => row.id === "a")?.materialTotal).toBe(
      0.01,
    );
    expect(result.lines.find((row) => row.id === "b")?.materialTotal).toBe(0);
  });
  it("does not buy an extra fractional pack because of binary floating point", () => {
    const result = calculateEstimate(
      doc([
        line({
          quantity: 0.1,
          multiplier: 3,
          orderMultiple: 0.1,
          materialUnitCost: 1,
        }),
      ]),
    );
    expect(result.lines[0]?.purchaseQuantity).toBe(0.3);
    expect(result.total.materialTotal).toBe(0.3);
  });
  it("retains finite purchase allocation across a large fractional estimate", () => {
    const lines = Array.from({ length: 1500 }, (_, index) =>
      line({
        id: String(index),
        quantity: 0.1,
        materialUnitCost: 0.1,
        orderMultiple: 10,
        partDefinitionId: "p",
      }),
    );
    const result = calculateEstimate(doc(lines));
    expect(result.total.materialTotal).toBe(15);
    expect(
      result.lines.every(
        (row) =>
          Number.isFinite(row.purchaseQuantity) && row.purchaseQuantity === 0.1,
      ),
    ).toBe(true);
  });
  it("rounds half cents consistently and respects a zero labor override", () => {
    const result = calculateEstimate(
      doc([
        line({
          quantity: 1,
          materialUnitCost: 1.005,
          laborHoursPerUnit: 2,
          laborRate: 0,
        }),
      ]),
    );
    expect(result.total.materialTotal).toBe(1.01);
    expect(result.total.laborTotal).toBe(0);
  });
  it("applies overhead then contingency, and true margin rather than markup", () => {
    const settings = {
      overheadPercent: 10,
      contingencyPercent: 5,
      profitPercent: 20,
      taxPercent: 13,
    };
    const margin = calculateEstimate(
      doc([line({ quantity: 50 })], settings),
    ).total;
    expect(margin).toMatchObject({
      directCost: 100,
      overhead: 10,
      contingency: 5.5,
      profit: 28.88,
      subtotal: 144.38,
      tax: 18.77,
      total: 163.15,
    });
    const markup = calculateEstimate(
      doc([line({ quantity: 50 })], { ...settings, profitMode: "markup" }),
    ).total;
    expect(markup.profit).toBe(23.1);
    expect(markup.subtotal).toBe(138.6);
  });
  it("supports material-only tax", () => {
    const result = calculateEstimate(
      doc([line({ laborHoursPerUnit: 1 })], {
        taxPercent: 10,
        taxBasis: "materials",
      }),
    );
    expect(result.total.tax).toBe(2);
  });
  it("keeps base/optional alternates separate and combines purchases only when selected", () => {
    const document = doc([
      line({
        id: "base",
        quantity: 8,
        partDefinitionId: "p",
        orderMultiple: 10,
      }),
      line({
        id: "alt",
        quantity: 1,
        partDefinitionId: "p",
        orderMultiple: 10,
        alternateId: "alternate",
      }),
    ]);
    document.alternates = [{ id: "alternate", name: "Extra", included: false }];
    const optional = calculateEstimate(document);
    expect(optional.total.materialTotal).toBe(20);
    expect(optional.lines[1]?.included).toBe(false);
    expect(optional.alternates[0]?.materialTotal).toBe(20);
    expect(optional.alternates[0]?.incrementalTotal).toBe(0);
    document.alternates[0]!.included = true;
    const selected = calculateEstimate(document);
    expect(selected.total.materialTotal).toBe(20);
    expect(selected.base.materialTotal).toBe(20);
    expect(
      selected.lines.reduce((sum, row) => sum + row.materialTotal, 0),
    ).toBe(20);
    expect(selected.groups.trade[0]?.directCost).toBe(20);
  });
  it("never bills excluded lines or duplicate drawing sources", () => {
    const source = {
      kind: "drawing-measurement" as const,
      sheetId: "sheet",
      markupId: "markup",
      confidence: 1,
    };
    const result = calculateEstimate(
      doc([
        line({ id: "a", source }),
        line({ id: "b", source }),
        line({ id: "c", reviewStatus: "excluded", quantity: 1000 }),
      ]),
    );
    expect(result.total.directCost).toBe(20);
    expect(result.lines[1]?.directCost).toBe(0);
    expect(result.lines[2]?.directCost).toBe(0);
    expect(
      result.issues.some((issue) => issue.code === "duplicate-source"),
    ).toBe(true);
  });
  it("excludes all duplicate IDs consistently from both totals and displayed lines", () => {
    const result = calculateEstimate(doc([line(), line()]));
    expect(result.total.directCost).toBe(0);
    expect(
      result.lines.every((row) => !row.included && row.directCost === 0),
    ).toBe(true);
  });
  it("refuses unsupported monetary ranges", () => {
    expect(() =>
      calculateEstimate(
        doc([line({ quantity: 100_000_000, materialUnitCost: 100_000_000 })]),
      ),
    ).toThrow("monetary range");
  });
});
describe("estimate readiness", () => {
  it("reports missing/simulated/stale pricing and unreviewed source evidence", () => {
    const result = calculateEstimate(
      doc([
        line({ id: "a", priceSource: "missing", materialUnitCost: null }),
        line({
          id: "b",
          priceSource: "simulated",
          reviewStatus: "unreviewed",
          source: { kind: "ai", confidence: 0.3 },
        }),
        line({
          id: "c",
          priceSource: "supplier",
          priceUpdatedAt: "2025-01-01",
        }),
      ]),
      fixed,
    );
    expect(result.readiness).toMatchObject({
      ready: false,
      missingPrices: 1,
      simulatedPrices: 1,
      unreviewed: 1,
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing-price",
        "simulated-price",
        "unreviewed-source",
        "stale-price",
        "low-confidence",
      ]),
    );
  });
  it("does not let optional missing prices block the base estimate", () => {
    const document = doc([
      line({ id: "a" }),
      line({
        id: "b",
        priceSource: "missing",
        materialUnitCost: null,
        alternateId: "opt",
      }),
    ]);
    document.alternates = [{ id: "opt", name: "Optional", included: false }];
    expect(calculateEstimate(document).readiness.ready).toBe(true);
    expect(calculateEstimate(doc([])).readiness.ready).toBe(false);
  });
  it("does not treat excluded or zero-demand lines as missing required pricing", () => {
    const result = calculateEstimate(
      doc([
        line({
          id: "a",
          materialUnitCost: null,
          priceSource: "missing",
          reviewStatus: "excluded",
        }),
        line({
          id: "b",
          quantity: 0,
          materialUnitCost: null,
          priceSource: "missing",
        }),
      ]),
    );
    expect(result.readiness.missingPrices).toBe(0);
  });
  it("retains unknown alternate and invalid unit errors without billing those lines", () => {
    const document = doc([line({ id: "a", alternateId: "deleted" })]);
    document.lines.push({ ...line({ id: "b" }), unit: "" });
    expect(calculateEstimate(document).total.total).toBe(0);
    expect(
      calculateEstimate(document).issues.map((issue) => issue.code),
    ).toEqual(["unknown-alternate", "invalid-unit"]);
  });
  it("rejects supplier pricing after estimate currency changes rather than relabeling money", () => {
    const result = calculateEstimate(
      doc([line({ priceCurrency: "CAD" })], { currency: "USD" }),
    );
    expect(result.total.total).toBe(0);
    expect(result.readiness.ready).toBe(false);
    expect(result.issues[0]?.code).toBe("currency-mismatch");
  });
  it("lets explicit quantity review resolve source-confidence warnings without rewriting original confidence", () => {
    const result = calculateEstimate(
      doc([
        line({
          source: { kind: "room", confidence: 0.5 },
          reviewStatus: "approved",
        }),
      ]),
    );
    expect(result.readiness.ready).toBe(true);
    expect(result.confidence).toBe(0.5);
    expect(result.issues).toEqual([]);
  });
  it("requires inconsistent shared purchase snapshots to be reconciled before approval", () => {
    const result = calculateEstimate(
      doc([
        line({
          id: "a",
          quantity: 1,
          partDefinitionId: "p",
          orderMultiple: 10,
        }),
        line({
          id: "b",
          quantity: 1,
          partDefinitionId: "p",
          orderMultiple: 10,
          materialUnitCost: 3,
        }),
      ]),
    );
    expect(result.readiness.ready).toBe(false);
    expect(
      result.issues.filter((issue) => issue.code === "price-conflict"),
    ).toHaveLength(2);
  });
});
