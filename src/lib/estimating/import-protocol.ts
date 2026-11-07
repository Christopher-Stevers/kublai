import type { PricingRow } from "./types";

// A single structured clone of 10,000 rows can itself stall the main thread.
export const PRICING_IMPORT_BATCH = 250;
export type PricingImportRequest =
  | { kind: "parse"; csv: string; newRowIds?: boolean }
  | { kind: "next" };
export type PricingImportResponse =
  | { kind: "chunk"; rows: PricingRow[]; errors: string[] }
  | { kind: "done" }
  | { kind: "failure"; message: string };
