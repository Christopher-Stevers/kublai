// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import {
  newEstimateDocument,
  newEstimateLine,
  type EstimateRecord,
} from "~/lib/estimating/types";
import {
  estimatePdf,
  estimateWorkbook,
  proposalCsv,
  proposalRows,
} from "./exports";

function fixture(): EstimateRecord {
  const document = newEstimateDocument();
  document.settings = {
    ...document.settings,
    overheadPercent: 10,
    contingencyPercent: 5,
    profitPercent: 15,
    taxPercent: 13,
  };
  document.lines = [
    newEstimateLine({
      description: '1/2" Copper pipe',
      quantity: 20,
      unit: "ft",
      materialUnitCost: 4.25,
      laborHoursPerUnit: 0.12,
      priceSource: "manual",
      reviewStatus: "approved",
      area: "Mechanical room",
    }),
  ];
  document.scope =
    "Supply and install domestic water piping.\nConnect to existing services.";
  document.customerName = "Construction Company";
  document.exclusions = "Existing system repairs and permit fees.";
  document.notes = "INTERNAL CONFIDENTIAL MARGIN NOTES";
  return {
    id: "00000000-0000-4000-8000-000000000001",
    jobId: "00000000-0000-4000-8000-000000000002",
    jobName: "Alma Phase #2",
    name: "Mechanical estimate",
    status: "draft",
    revision: 3,
    document,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
describe("estimate export contracts", () => {
  it("allocates proposal selling price in exact cents without a negative balancing row", () => {
    const estimate = fixture();
    estimate.document.lines = Array.from({ length: 99 }, (_, index) =>
      newEstimateLine({
        description: "Fitting " + index,
        quantity: 1,
        materialUnitCost: 0.01,
        priceSource: "manual",
        reviewStatus: "approved",
      }),
    );
    estimate.document.lines.push(
      newEstimateLine({
        description: "Included no-charge service",
        quantity: 1,
        materialUnitCost: 0,
        priceSource: "manual",
        reviewStatus: "approved",
      }),
    );
    const { calculation, rows } = proposalRows(estimate);
    expect(rows.every((row) => row.amount >= 0)).toBe(true);
    expect(
      rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0),
    ).toBe(calculation.total.cents.subtotal);
    expect(rows.at(-1)?.amount).toBe(0);
  });
  it("customer CSV omits internal rates and confidential notes", () => {
    const csv = proposalCsv(fixture());
    expect(csv).toContain("Connect to existing services.");
    expect(csv).not.toContain("INTERNAL CONFIDENTIAL");
    expect(csv).not.toContain("laborHours");
    expect(csv).not.toContain("materialUnitCost");
  });
  it("keeps workbook amounts numeric and user formula-like names inert", () => {
    const estimate = fixture();
    estimate.document.lines[0]!.description =
      '=HYPERLINK("https://example.test")';
    const book = XLSX.read(estimateWorkbook(estimate, "proposal"), {
      type: "buffer",
    });
    const description = book.Sheets.Estimate?.A2 as XLSX.CellObject | undefined;
    const amount = book.Sheets.Estimate?.F2 as XLSX.CellObject | undefined;
    expect(description?.t).toBe("s");
    expect(description?.f).toBeUndefined();
    expect(amount?.t).toBe("n");
    expect(book.SheetNames).not.toContain("Review checks");
    expect(JSON.stringify(book.Sheets)).not.toContain("INTERNAL CONFIDENTIAL");
    const internal = XLSX.read(estimateWorkbook(estimate, "internal"), {
      type: "buffer",
    });
    expect(internal.SheetNames).toContain("Review checks");
    expect(JSON.stringify(internal.Sheets)).toContain("INTERNAL CONFIDENTIAL");
  });
  it("paginates long proposals and supports accented construction names", async () => {
    const estimate = fixture();
    estimate.name = "Rénovation - plomberie";
    estimate.document.lines = Array.from({ length: 100 }, (_, index) =>
      newEstimateLine({
        description: `Material ${index}: supply, install, connect and commission complete system`,
        quantity: 1,
        materialUnitCost: 100,
        priceSource: "manual",
        reviewStatus: "approved",
      }),
    );
    const bytes = await estimatePdf(estimate, "proposal");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(pdf.getTitle()).toBe(estimate.name);
    for (const page of pdf.getPages())
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
  });
});
