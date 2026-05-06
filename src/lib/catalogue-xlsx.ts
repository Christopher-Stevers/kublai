import { generatePartDisplayName } from "~/lib/size-utils";

export interface CatalogueImportRow {
  partId: string | null;
  catalog: string;
  category: string;
  material: string;
  displayName: string;
  description: string;
  sizeNominal: string | null;
  sizeUnit: string;
  imageUrl: string;
  aliases: string;
  isActive: boolean;
}

function readCell(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return "";
}

function readCellString(row: Record<string, unknown>, ...keys: string[]) {
  return String(readCell(row, ...keys)).trim();
}

export function normalizeCatalogueImportRow(row: Record<string, unknown>): CatalogueImportRow | null {
  const rawSizeNominal = readCell(row, "sizeNominal", "Size Nominal");
  const sizeNominal =
    rawSizeNominal === "" || rawSizeNominal === undefined || rawSizeNominal === null
      ? null
      : String(rawSizeNominal).trim();
  const sizeUnit = readCellString(row, "sizeUnit", "Size Unit");
  const material = readCellString(row, "material", "Material");
  const description = readCellString(row, "description", "Description");
  const displayName =
    readCellString(row, "displayName", "Display Name") ||
    generatePartDisplayName({ sizeNominal, sizeUnit, material, description });
  const catalog = readCellString(row, "catalog", "Catalog");

  if (!catalog || !displayName) return null;

  const rawIsActive = readCell(row, "isActive", "Is Active");

  return {
    partId: readCellString(row, "partId", "Part ID") || null,
    catalog,
    category: readCellString(row, "category", "Category"),
    material,
    displayName,
    description,
    sizeNominal,
    sizeUnit,
    imageUrl: readCellString(row, "imageUrl", "Image URL"),
    aliases: readCellString(row, "aliases", "Aliases"),
    isActive:
      typeof rawIsActive === "boolean"
        ? rawIsActive
        : String(rawIsActive || "true").trim().toLowerCase() !== "false",
  };
}

export function normalizeCatalogueImportRows(rawRows: Record<string, unknown>[]) {
  return rawRows
    .map((row) => normalizeCatalogueImportRow(row))
    .filter((row): row is CatalogueImportRow => row !== null);
}

export async function readCatalogueImportWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.SheetNames[0];

  if (!firstSheet) {
    throw new Error("That workbook is empty.");
  }

  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) {
    throw new Error("Could not read the first worksheet.");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return normalizeCatalogueImportRows(rawRows);
}

export async function downloadCatalogueRowsAsXlsx(rows: unknown[], filename: string) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Parts");
  XLSX.writeFile(workbook, filename);
}
