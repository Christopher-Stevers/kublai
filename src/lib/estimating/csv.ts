import { calculateEstimate } from "./calculator";
import {
  pricingRowSchema,
  type EstimateDocument,
  type PricingRow,
} from "./types";

const HEADERS = [
  "description",
  "sku",
  "unit",
  "currency",
  "priceSource",
  "materialUnitCost",
  "laborHoursPerUnit",
  "equipmentUnitCost",
  "subcontractUnitCost",
  "otherUnitCost",
  "orderMultiple",
  "supplierName",
  "trade",
  "costCode",
  "updatedAt",
] as const;
const MAX_BYTES = 5_000_000;
const MAX_ROWS = 10_000;
function cell(value: string | number | boolean | null | undefined) {
  let text = value === null || value === undefined ? "" : String(value);
  // Excel interprets these prefixes as formulas even when the field is quoted.
  if (
    /^[\s]*[=+@]/.test(text) ||
    (/^[\s]*-/.test(text) && !/^-?\d+(\.\d+)?$/.test(text))
  )
    text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function serializeCsv(
  rows: (string | number | boolean | null | undefined)[][],
) {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 records, including quoted newlines, escaped quotes and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  if (text.length > MAX_BYTES) throw new Error("CSV exceeds the 5 MB limit.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    afterQuote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += character;
      continue;
    }
    if (
      afterQuote &&
      character !== "," &&
      character !== "\r" &&
      character !== "\n"
    )
      throw new Error("Unexpected text after a quoted CSV field.");
    if (character === '"') {
      if (field) throw new Error("Quote inside an unquoted CSV field.");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
      if (character === "\r" && text[index + 1] === "\n") index++;
      if (rows.length > MAX_ROWS + 1)
        throw new Error("CSV exceeds the 10,000 row limit.");
    } else field += character;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (field || row.length || afterQuote) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
const headerKey = (value: string) =>
  value.trim().toLowerCase().replace(/[ _-]/g, "");
const NUMERIC = new Set([
  "materialUnitCost",
  "laborHoursPerUnit",
  "equipmentUnitCost",
  "subcontractUnitCost",
  "otherUnitCost",
  "orderMultiple",
]);
export function importPricingCsv(text: string): {
  rows: PricingRow[];
  errors: string[];
} {
  const errors: string[] = [];
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : "Invalid CSV."],
    };
  }
  const header = records.shift();
  if (!header) return { rows: [], errors: ["CSV is empty."] };
  const keys = header.map(headerKey);
  if (new Set(keys).size !== keys.length)
    return { rows: [], errors: ["CSV has duplicate column headers."] };
  for (const required of ["description", "unit", "materialunitcost"])
    if (!keys.includes(required))
      errors.push(`Missing required column: ${required}.`);
  if (errors.length) return { rows: [], errors };
  const rows: PricingRow[] = [];
  for (const [index, record] of records.entries()) {
    if (record.every((value) => !value.trim())) continue;
    const rowNumber = index + 2;
    if (record.length !== header.length) {
      errors.push(
        `Row ${rowNumber}: expected ${header.length} fields, found ${record.length}.`,
      );
      continue;
    }
    const raw: Record<string, unknown> = { id: `csv-${rowNumber}` };
    let bad = false;
    for (const key of HEADERS) {
      const position = keys.indexOf(headerKey(key));
      if (position < 0) continue;
      const value = record[position]!.trim();
      if (NUMERIC.has(key)) {
        if (!value) {
          if (key === "materialUnitCost" || key === "orderMultiple")
            raw[key] = null;
          continue;
        }
        // Currency symbols, thousands separators and decimal commas require explicit normalization.
        if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) {
          errors.push(
            `Row ${rowNumber}: ${key} must be a non-negative decimal number.`,
          );
          bad = true;
        } else raw[key] = Number(value);
      } else if (value || key === "description" || key === "unit")
        raw[key] =
          key === "currency"
            ? value.toUpperCase()
            : key === "priceSource"
              ? value.toLowerCase()
              : value;
    }
    if (bad) continue;
    const parsed = pricingRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(
        `Row ${rowNumber}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
      );
      continue;
    }
    if (
      parsed.data.updatedAt &&
      !Number.isFinite(Date.parse(parsed.data.updatedAt))
    ) {
      errors.push(`Row ${rowNumber}: updatedAt is not a valid date.`);
      continue;
    }
    rows.push(parsed.data);
  }
  return { rows, errors };
}
export function pricingCsvTemplate(currency = "CAD") {
  return serializeCsv([
    Array.from(HEADERS),
    [
      "Copper pipe 1/2 inch",
      "COPPER-050",
      "ft",
      currency,
      "imported",
      4.25,
      0.08,
      0,
      0,
      0,
      10,
      "Your supplier",
      "Plumbing",
      "22 11 16",
      new Date().toISOString().slice(0, 10),
    ],
  ]);
}
/** Reusable pricebook export preserves currency and simulated/missing pricing provenance. */
export function exportPricingCsv(rows: PricingRow[]) {
  return serializeCsv([
    Array.from(HEADERS),
    ...rows.map((row) => HEADERS.map((header) => row[header])),
  ]);
}
export function exportEstimateCsv(document: EstimateDocument) {
  const calculation = calculateEstimate(document);
  const headers = [
    "description",
    "quantity",
    "multiplier",
    "unit",
    "demand",
    "wastePercent",
    "requiredQuantity",
    "purchaseQuantity",
    "materialUnitCost",
    "materialTotal",
    "laborHours",
    "laborTotal",
    "equipmentTotal",
    "subcontractTotal",
    "otherTotal",
    "directCost",
    "trade",
    "costCode",
    "area",
    "alternate",
    "included",
    "reviewStatus",
    "priceSource",
    "priceCurrency",
    "supplierName",
    "sourceKind",
    "sourceEvidence",
    "warnings",
  ];
  const rows = calculation.lines.map((line) => [
    line.description,
    line.quantity,
    line.multiplier,
    line.unit,
    line.demand,
    line.wastePercent,
    line.requiredQuantity,
    line.purchaseQuantity,
    line.materialUnitCost,
    line.materialTotal,
    line.laborHours,
    line.laborTotal,
    line.equipmentTotal,
    line.subcontractTotal,
    line.otherTotal,
    line.directCost,
    line.trade,
    line.costCode,
    line.area,
    document.alternates.find((a) => a.id === line.alternateId)?.name ?? "",
    line.included,
    line.reviewStatus,
    line.priceSource,
    line.priceCurrency ?? document.settings.currency,
    line.supplierName,
    line.source.kind,
    line.source.evidence,
    line.warnings.join("; "),
  ]);
  rows.push([
    "TOTAL (included lines)",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    calculation.total.materialTotal,
    calculation.total.laborHours,
    calculation.total.laborTotal,
    calculation.total.equipmentTotal,
    calculation.total.subcontractTotal,
    calculation.total.otherTotal,
    calculation.total.directCost,
  ]);
  rows.push(
    ["Overhead", calculation.total.overhead],
    ["Contingency", calculation.total.contingency],
    ["Profit", calculation.total.profit],
    ["Tax", calculation.total.tax],
    ["TOTAL SELLING PRICE", calculation.total.total],
  );
  return serializeCsv([headers, ...rows]);
}
