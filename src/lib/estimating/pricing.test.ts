// @vitest-environment node
import { describe, expect, it } from "vitest";
import { matchEstimatePricing } from "./pricing";
import { scanEstimatePricing } from "../../../scripts/benchmarks/scan-pricing";
import {
  importPricingCsv,
  parseCsv,
  pricingCsvTemplate,
  exportEstimateCsv,
  exportPricingCsv,
} from "./csv";
import {
  newEstimateDocument,
  newEstimateLine,
  pricingRowSchema,
} from "./types";
const row = (values = {}) =>
  pricingRowSchema.parse({
    id: "price",
    description: "Copper pipe",
    unit: "ft",
    materialUnitCost: 2,
    updatedAt: "2026-10-10",
    ...values,
  });
const line = () =>
  newEstimateLine({
    id: "line",
    description: "Copper pipe",
    quantity: 10,
    unit: "ft",
  });
describe("pricing identity", () => {
  it("counts a row matching both description and SKU once and preserves duplicate-row order", () => {
    const first = row({ id: "first", sku: " COPPER   PIPE " });
    expect(matchEstimatePricing([line()], [first]).matched).toBe(1);
    const repeated = row({
      id: "first",
      sku: "Copper pipe",
      materialUnitCost: 9,
    });
    const last = row({ id: "last" });
    expect(matchEstimatePricing([line()], [first, repeated, last])).toEqual(
      scanEstimatePricing([line()], [first, repeated, last]),
    );
    expect(
      matchEstimatePricing([line()], [first, repeated, last]).ambiguous[0]
        ?.rowIds,
    ).toEqual(["first", "first", "last"]);
  });
  it("rebuilds the index after in-place edits and never changes the inputs", () => {
    const rows = [row()];
    const lines = [line()];
    const before = structuredClone({ rows, lines });
    matchEstimatePricing(lines, rows);
    expect({ rows, lines }).toEqual(before);
    rows[0]!.materialUnitCost = 7;
    rows[0]!.sku = "CU-EDIT";
    expect(matchEstimatePricing(lines, rows).lines[0]?.materialUnitCost).toBe(
      7,
    );
    expect(
      matchEstimatePricing([{ ...lines[0]!, description: "CU-EDIT" }], rows)
        .matched,
    ).toBe(1);
  });
  it("matches the original scanner over mixed descriptions, units, currencies, suppliers and provenance", () => {
    const descriptions = [
      "Copper pipe",
      " COPPER\tPIPE ",
      "Valve",
      "VALVE",
      "Café fixture",
      "__proto__",
      "constructor",
      "CU-1",
      "Missing",
    ];
    const units = ["ft", "lf", "m", "EA", "each", "sq ft", "ft²"];
    const currencies = [undefined, "CAD", "USD", "EUR"] as const;
    const suppliers = ["", "North", " NORTH\t", "South"];
    const provenance = [undefined, "simulated", "supplier", "manual"] as const;
    let seed = 20261011;
    const pick = <T>(values: readonly T[]) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return values[seed % values.length]!;
    };
    for (let trial = 0; trial < 32; trial++) {
      const rows = Array.from({ length: 80 }, (_, i) =>
        row({
          id: `row-${i}`,
          description: pick(descriptions),
          sku: pick(descriptions),
          unit: pick(units),
          currency: pick(currencies),
          supplierName: pick(suppliers),
          priceSource: pick(provenance),
          materialUnitCost: i % 5 ? i / 100 : null,
        }),
      );
      const lines = Array.from({ length: 40 }, (_, i) => ({
        ...line(),
        id: `line-${i}`,
        description: pick(descriptions),
        unit: pick(units),
        supplierName: pick(suppliers),
        priceCurrency: pick(currencies),
        reviewStatus: i % 7 ? ("unreviewed" as const) : ("excluded" as const),
      }));
      const options = { currency: pick(currencies) };
      expect(matchEstimatePricing(lines, rows, options)).toEqual(
        scanEstimatePricing(lines, rows, options),
      );
    }
  });
  it("accepts exact normalized words and equivalent unit aliases", () => {
    const result = matchEstimatePricing(
      [line()],
      [row({ description: " COPPER   PIPE ", unit: "lf" })],
    );
    expect(result.matched).toBe(1);
    expect(result.lines[0]).toMatchObject({
      materialUnitCost: 2,
      priceSource: "imported",
      priceUpdatedAt: "2026-10-10",
    });
  });
  it("never fuzzy matches similar material descriptions or silently converts incompatible units", () => {
    expect(
      matchEstimatePricing([line()], [row({ description: "Copper pipe 1/2" })])
        .matched,
    ).toBe(0);
    const result = matchEstimatePricing([line()], [row({ unit: "m" })]);
    expect(result.matched).toBe(0);
    expect(result.lines[0]?.materialUnitCost).toBeNull();
    expect(result.warnings.length).toBe(1);
  });
  it("matches a deliberately entered exact SKU and preserves ambiguous supplier choices", () => {
    const skuLine = { ...line(), description: "CU-1" };
    expect(
      matchEstimatePricing([skuLine], [row({ sku: "CU-1" })]).matched,
    ).toBe(1);
    const result = matchEstimatePricing(
      [line()],
      [
        row({ id: "a", supplierName: "A" }),
        row({ id: "b", supplierName: "B" }),
      ],
    );
    expect(result.ambiguous).toEqual([{ lineId: "line", rowIds: ["a", "b"] }]);
    expect(result.lines[0]?.materialUnitCost).toBeNull();
    expect(
      matchEstimatePricing(
        [{ ...line(), supplierName: "B" }],
        [row({ supplierName: "A" }), row({ supplierName: "B" })],
      ).matched,
    ).toBe(1);
  });
  it("does not mutate excluded rows", () => {
    const excluded = { ...line(), reviewStatus: "excluded" as const };
    expect(matchEstimatePricing([excluded], [row()]).lines[0]).toBe(excluded);
  });
  it("retains explicit row currency and rejects currency mismatches without FX guesses", () => {
    expect(
      matchEstimatePricing([line()], [row({ currency: "CAD" })], {
        currency: "USD",
      }).matched,
    ).toBe(0);
    expect(
      matchEstimatePricing([line()], [row({ currency: "CAD" })], {
        currency: "USD",
      }).warnings[0],
    ).toContain("currency");
    expect(
      matchEstimatePricing([line()], [row()], { currency: "USD" }).lines[0]
        ?.priceCurrency,
    ).toBe("USD");
    expect(
      matchEstimatePricing([line()], [row({ currency: "USD" })], {
        currency: "USD",
      }).lines[0]?.priceRowId,
    ).toBe("price");
  });
});
describe("pricing CSV", () => {
  it("parses BOM, escaped commas/quotes and quoted newlines", () => {
    const csv =
      '\uFEFFdescription,unit,materialUnitCost,supplierName\r\n"Pipe, copper",ft,2.50,"Acme ""Pro""\nSupply"\r\n';
    const result = importPricingCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      description: "Pipe, copper",
      supplierName: 'Acme "Pro"\nSupply',
      materialUnitCost: 2.5,
    });
  });
  it("reports bad rows while retaining valid pricing rows", () => {
    const result = importPricingCsv(
      "description,unit,materialUnitCost\nGood,ea,2\nBad,ea,-2\nBroken,ea,$2\nMissing field,ea\n",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(3);
  });
  it("rejects duplicate/missing headers and malformed quoting", () => {
    expect(
      importPricingCsv(
        "description,description,unit,materialUnitCost\nA,B,ea,2",
      ).errors[0],
    ).toContain("duplicate");
    expect(importPricingCsv("description,cost\nA,2").errors).toHaveLength(2);
    expect(
      importPricingCsv('description,unit,materialUnitCost\n"Open,ea,2').rows,
    ).toHaveLength(0);
    expect(() => parseCsv('"closed"stray,ea')).toThrow("Unexpected");
  });
  it("roundtrips its usable template and retains blank material prices as missing", () => {
    expect(importPricingCsv(pricingCsvTemplate()).errors).toEqual([]);
    expect(
      importPricingCsv("description,unit,materialUnitCost\nAllowance,ea,\n")
        .rows[0]?.materialUnitCost,
    ).toBeNull();
  });
  it("exports actual totals and escaped spreadsheet formulas", () => {
    const document = newEstimateDocument();
    document.lines = [
      newEstimateLine({
        description: '=HYPERLINK("https://example.com")',
        quantity: 1,
        materialUnitCost: 10,
        priceSource: "manual",
      }),
    ];
    const csv = exportEstimateCsv(document);
    expect(csv).toContain("TOTAL SELLING PRICE");
    expect(csv).toContain("'=HYPERLINK");
    expect(parseCsv(csv)[1]?.[0]).toBe('\'=HYPERLINK("https://example.com")');
  });
  it("validates explicit currency while allowing rows without a currency declaration", () => {
    expect(
      importPricingCsv(
        "description,unit,currency,materialUnitCost\nPipe,ft,usd,2\n",
      ).rows[0]?.currency,
    ).toBe("USD");
    expect(
      importPricingCsv(
        "description,unit,currency,materialUnitCost\nPipe,ft,XYZ,2\n",
      ).errors,
    ).toHaveLength(1);
    expect(
      importPricingCsv("description,unit,materialUnitCost\nPipe,ft,2\n").rows[0]
        ?.currency,
    ).toBeUndefined();
  });
  it("never washes simulated prices through a pricebook CSV roundtrip", () => {
    const simulation = row({ priceSource: "simulated", currency: "CAD" });
    const imported = importPricingCsv(exportPricingCsv([simulation]));
    expect(imported.errors).toEqual([]);
    expect(imported.rows[0]?.priceSource).toBe("simulated");
    const matched = matchEstimatePricing([line()], imported.rows, {
      currency: "CAD",
    });
    expect(matched.lines[0]?.priceSource).toBe("simulated");
    const document = newEstimateDocument();
    document.lines = matched.lines;
    expect(exportEstimateCsv(document)).toContain("simulated");
  });
});
