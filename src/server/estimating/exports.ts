import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { calculateEstimate } from "~/lib/estimating/calculator";
import { serializeCsv } from "~/lib/estimating/csv";
import type { EstimateRecord } from "~/lib/estimating/types";

export type EstimateExportView = "internal" | "proposal";
export function proposalRows(estimate: EstimateRecord) {
  const calculation = calculateEstimate(estimate.document);
  const included = calculation.lines.filter((line) => line.included);
  const direct = BigInt(calculation.total.cents.directCost);
  const allocations = included.map((line, index) => {
    const numerator =
      BigInt(calculation.total.cents.subtotal) *
      BigInt(Math.round(line.directCost * 100));
    return {
      index,
      cents: direct > 0n ? Number(numerator / direct) : 0,
      remainder: direct > 0n ? numerator % direct : 0n,
    };
  });
  const remainder =
    calculation.total.cents.subtotal -
    allocations.reduce((sum, row) => sum + row.cents, 0);
  const ranked = [...allocations].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let index = 0; index < remainder && index < ranked.length; index++)
    ranked[index]!.cents++;
  const rows = included.map((line, index) => ({
    description: line.description,
    quantity: line.demand,
    unit: line.unit,
    trade: line.trade,
    area: line.area,
    amount: allocations[index]!.cents / 100,
  }));
  return { calculation, rows };
}
export function proposalCsv(estimate: EstimateRecord) {
  const { calculation, rows } = proposalRows(estimate);
  return serializeCsv([
    [
      "Estimate",
      estimate.name,
      "Job",
      estimate.jobName,
      "Revision",
      estimate.revision,
      "Status",
      estimate.status,
      "Prepared by",
      estimate.companyName ?? "ForemanHQ",
    ],
    [
      "Description",
      "Quantity",
      "Unit",
      "Trade",
      "Area",
      `Amount (${estimate.document.settings.currency})`,
    ],
    ...rows.map((line) => [
      line.description,
      line.quantity,
      line.unit,
      line.trade,
      line.area,
      line.amount,
    ]),
    ["Subtotal", "", "", "", "", calculation.total.subtotal],
    ["Tax", "", "", "", "", calculation.total.tax],
    ["Total", "", "", "", "", calculation.total.total],
    ...calculation.alternates
      .filter((a) => !a.included)
      .map((a) => ["OPTIONAL: " + a.name, "", "", "", "", a.incrementalTotal]),
    ["Scope", estimate.document.scope],
    ["Inclusions", estimate.document.inclusions],
    ["Exclusions", estimate.document.exclusions],
    ["Assumptions", estimate.document.assumptions],
  ]);
}
export function estimateWorkbook(
  estimate: EstimateRecord,
  view: EstimateExportView,
) {
  const book = XLSX.utils.book_new();
  const { calculation, rows } = proposalRows(estimate);
  const summary = XLSX.utils.aoa_to_sheet([
    [estimate.name],
    ["Job", estimate.jobName],
    ["Prepared by", estimate.companyName ?? "ForemanHQ"],
    ["Status", estimate.status],
    ["Revision", estimate.revision],
    ["Currency", estimate.document.settings.currency],
    ...(view === "internal"
      ? [
          ["Material cost", calculation.total.materialTotal],
          ["Labor hours", calculation.total.laborHours],
          ["Labor cost", calculation.total.laborTotal],
          ["Equipment cost", calculation.total.equipmentTotal],
          ["Subcontract cost", calculation.total.subcontractTotal],
          ["Other cost", calculation.total.otherTotal],
          ["Direct cost", calculation.total.directCost],
          ["Overhead", calculation.total.overhead],
          ["Contingency", calculation.total.contingency],
          ["Profit", calculation.total.profit],
        ]
      : []),
    ["Subtotal", calculation.total.subtotal],
    ["Tax", calculation.total.tax],
    ["Total", calculation.total.total],
    ["Customer", estimate.document.customerName],
    ["Valid until", estimate.document.validUntil],
    ["Scope", estimate.document.scope],
    ["Inclusions", estimate.document.inclusions],
    ["Exclusions", estimate.document.exclusions],
    ["Assumptions", estimate.document.assumptions],
    ...(view === "internal"
      ? [["Internal notes", estimate.document.notes]]
      : []),
  ]);
  summary["!cols"] = [{ wch: 28 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  const detail = XLSX.utils.aoa_to_sheet(
    view === "proposal"
      ? [
          ["Description", "Quantity", "Unit", "Trade", "Area", "Amount"],
          ...rows.map((row) => [
            row.description,
            row.quantity,
            row.unit,
            row.trade,
            row.area,
            row.amount,
          ]),
        ]
      : [
          [
            "Description",
            "Required quantity",
            "Purchase quantity",
            "Unit",
            "Unit material cost",
            "Material cost",
            "Labor hours",
            "Labor cost",
            "Equipment cost",
            "Subcontract cost",
            "Other cost",
            "Direct cost",
            "Trade",
            "Cost code",
            "Area",
            "Phase",
            "Included",
            "Review",
            "Price source",
            "Evidence",
          ],
          ...calculation.lines.map((row) => [
            row.description,
            row.requiredQuantity,
            row.purchaseQuantity,
            row.unit,
            row.materialUnitCost,
            row.materialTotal,
            row.laborHours,
            row.laborTotal,
            row.equipmentTotal,
            row.subcontractTotal,
            row.otherTotal,
            row.directCost,
            row.trade,
            row.costCode,
            row.area,
            row.phase,
            row.included,
            row.reviewStatus,
            row.priceSource,
            row.source.evidence ?? row.source.label ?? "",
          ]),
        ],
  );
  detail["!cols"] = [
    { wch: 52 },
    ...Array.from({ length: view === "proposal" ? 5 : 19 }, () => ({
      wch: 18,
    })),
  ];
  if (detail["!ref"]) detail["!autofilter"] = { ref: detail["!ref"] };
  XLSX.utils.book_append_sheet(book, detail, "Estimate");
  const alternatives = XLSX.utils.aoa_to_sheet([
    ["Alternate", "Included", "Additional amount"],
    ...calculation.alternates.map((a) => [
      a.name,
      a.included,
      a.incrementalTotal,
    ]),
  ]);
  alternatives["!cols"] = [{ wch: 50 }, { wch: 14 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(book, alternatives, "Alternates");
  if (view === "internal") {
    const checks = XLSX.utils.aoa_to_sheet([
      ["Issue", "Severity", "Line"],
      ...calculation.issues.map((issue) => [
        issue.message,
        issue.severity,
        issue.lineId ?? "",
      ]),
    ]);
    checks["!cols"] = [{ wch: 100 }, { wch: 14 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(book, checks, "Review checks");
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const printable = (value: string) =>
  value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\t/g, " ")
    .replace(
      /[^\n\r\x20-\x7e\xa0-\xff\u20ac\u2018\u2019\u201c\u201d\u2022]/g,
      "?",
    );
function wrap(text: string, width: number, font: PDFFont, size: number) {
  const rows: string[] = [];
  for (const paragraph of printable(text).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      rows.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > width) {
        if (current) {
          rows.push(current);
          current = "";
        }
        let fragment = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(fragment + char, size) > width) {
            rows.push(fragment);
            fragment = "";
          }
          fragment += char;
        }
        current = fragment;
      } else if (
        current &&
        font.widthOfTextAtSize(current + " " + word, size) > width
      ) {
        rows.push(current);
        current = word;
      } else current = current ? current + " " + word : word;
    }
    rows.push(current);
  }
  return rows;
}
/** Standalone, paginated proposal/report: private unit costs never appear in proposal view. */
export async function estimatePdf(
  estimate: EstimateRecord,
  view: EstimateExportView,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(estimate.name);
  pdf.setAuthor(estimate.companyName ?? "ForemanHQ");
  pdf.setSubject(
    view === "proposal"
      ? "Construction proposal"
      : "Internal construction estimate",
  );
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(
      path.join(
        process.cwd(),
        "public/fonts/estimating/LiberationSans-Regular.ttf",
      ),
    ),
    readFile(
      path.join(
        process.cwd(),
        "public/fonts/estimating/LiberationSans-Bold.ttf",
      ),
    ),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true }),
    bold = await pdf.embedFont(boldBytes, { subset: true });
  const blue = rgb(0.13, 0.32, 0.5),
    ink = rgb(0.08, 0.1, 0.14),
    muted = rgb(0.37, 0.41, 0.46),
    border = rgb(0.86, 0.89, 0.92);
  const { calculation, rows } = proposalRows(estimate);
  const money = (v: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: estimate.document.settings.currency,
    }).format(v);
  const pageWidth = 612,
    pageHeight = 792,
    margin = 40,
    width = 532;
  let page!: PDFPage;
  let y = 0;
  const text = (
    s: string,
    x: number,
    at: number,
    size = 10,
    font = regular,
    color = ink,
  ) => page.drawText(printable(s), { x, y: at, size, font, color });
  const right = (s: string, x: number, at: number, size = 10, font = regular) =>
    text(s, x - font.widthOfTextAtSize(printable(s), size), at, size, font);
  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    text(
      wrap(estimate.companyName ?? "ForemanHQ", width - 140, bold, 17)[0] ??
        "ForemanHQ",
      margin,
      748,
      17,
      bold,
      blue,
    );
    right(
      view === "proposal" ? "PROPOSAL" : "INTERNAL ESTIMATE",
      572,
      751,
      9,
      bold,
    );
    text(
      `${wrap(estimate.jobName, width - 110, regular, 9)[0] ?? "Job"}  |  Revision ${estimate.revision}`,
      margin,
      728,
      9,
      regular,
      muted,
    );
    page.drawLine({
      start: { x: margin, y: 714 },
      end: { x: 572, y: 714 },
      thickness: 1,
      color: border,
    });
    y = 695;
  };
  const ensure = (h: number) => {
    if (y - h < 58) newPage();
  };
  const paragraph = (value: string, size = 10) => {
    for (const row of wrap(value, width, regular, size)) {
      ensure(size + 5);
      text(row, margin, y, size);
      y -= size + 5;
    }
    y -= 4;
  };
  const section = (title: string, value: string) => {
    if (!value.trim()) return;
    ensure(42);
    text(title, margin, y, 11, bold, blue);
    y -= 20;
    paragraph(value);
    y -= 4;
  };
  newPage();
  for (const title of wrap(estimate.name, width, bold, 21)) {
    ensure(28);
    text(title, margin, y, 21, bold);
    y -= 26;
  }
  y -= 6;
  paragraph(
    `Status: ${estimate.status.replace("_", " ")}    Currency: ${estimate.document.settings.currency}`,
  );
  if (estimate.status === "draft" || estimate.status === "in_review") {
    ensure(38);
    page.drawRectangle({
      x: margin,
      y: y - 23,
      width,
      height: 29,
      color: rgb(1, 0.95, 0.83),
    });
    text(
      "DRAFT - pricing and takeoff review required before bid approval",
      margin + 9,
      y - 12,
      9,
      bold,
    );
    y -= 42;
  }
  if (estimate.document.customerName)
    paragraph("Prepared for: " + estimate.document.customerName);
  if (estimate.document.customerEmail)
    paragraph("Contact: " + estimate.document.customerEmail);
  if (estimate.document.validUntil)
    paragraph("Valid until: " + estimate.document.validUntil);
  section("Scope of work", estimate.document.scope);
  ensure(55);
  const tableHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - 9,
      width,
      height: 25,
      color: rgb(0.94, 0.96, 0.98),
    });
    text("Description", margin + 7, y, 9, bold);
    right("Quantity", 423, y, 9, bold);
    text("Unit", 435, y, 9, bold);
    right(view === "proposal" ? "Amount" : "Direct cost", 565, y, 9, bold);
    y -= 26;
  };
  tableHeader();
  const tableRows =
    view === "proposal"
      ? rows
      : calculation.lines
          .filter((line) => line.included)
          .map((line) => ({
            description: line.description,
            quantity: line.demand,
            unit: line.unit,
            amount: line.directCost,
            area: line.area,
            trade: line.trade,
          }));
  for (const row of tableRows) {
    const label = row.area
      ? `${row.description} (${row.area})`
      : row.description;
    const lines = wrap(label, 325, regular, 9.5);
    const height = Math.max(25, lines.length * 13 + 9);
    if (y - height < 66) {
      newPage();
      tableHeader();
    }
    lines.forEach((line, index) => text(line, margin + 7, y - index * 13, 9.5));
    right(
      row.quantity.toLocaleString("en-CA", { maximumFractionDigits: 3 }),
      423,
      y,
      9.5,
    );
    text(row.unit.slice(0, 9), 435, y, 9);
    right(money(row.amount), 565, y, 9.5);
    y -= height;
    page.drawLine({
      start: { x: margin, y: y + 8 },
      end: { x: 572, y: y + 8 },
      thickness: 0.4,
      color: border,
    });
  }
  y -= 12;
  const total = (label: string, value: number, emphasis = false) => {
    ensure(24);
    text(label, margin + 250, y, emphasis ? 12 : 10, emphasis ? bold : regular);
    right(money(value), 565, y, emphasis ? 14 : 10, emphasis ? bold : regular);
    y -= emphasis ? 28 : 22;
  };
  if (view === "internal") {
    total("Materials", calculation.total.materialTotal);
    total(
      `Labor (${calculation.total.laborHours.toFixed(2)} h)`,
      calculation.total.laborTotal,
    );
    total("Equipment", calculation.total.equipmentTotal);
    total("Subcontracts", calculation.total.subcontractTotal);
    total("Other costs", calculation.total.otherTotal);
    total("Overhead", calculation.total.overhead);
    total("Contingency", calculation.total.contingency);
    total("Profit", calculation.total.profit);
  }
  total("Subtotal", calculation.total.subtotal);
  total(
    `Tax (${estimate.document.settings.taxPercent}%)`,
    calculation.total.tax,
  );
  total("Total", calculation.total.total, true);
  y -= 12;
  for (const a of calculation.alternates.filter((a) => !a.included)) {
    ensure(35);
    paragraph(
      `Optional alternate: ${a.name} - additional ${money(a.incrementalTotal)}`,
    );
  }
  section("Inclusions", estimate.document.inclusions);
  section("Exclusions", estimate.document.exclusions);
  section("Assumptions", estimate.document.assumptions);
  if (view === "internal") {
    section("Internal notes", estimate.document.notes);
    section("Review checks", calculation.warnings.join("\n"));
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: margin, y: 43 },
      end: { x: 572, y: 43 },
      thickness: 0.5,
      color: border,
    });
    p.drawText(
      `ForemanHQ  |  Estimate ${estimate.id.slice(0, 8)}  |  Revision ${estimate.revision}  |  ${estimate.status.toUpperCase()}`,
      { x: margin, y: 28, size: 8, font: regular, color: muted },
    );
    const counter = `${index + 1} / ${pages.length}`;
    p.drawText(counter, {
      x: 572 - regular.widthOfTextAtSize(counter, 8),
      y: 28,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return pdf.save();
}
