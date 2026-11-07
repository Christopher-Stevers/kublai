import type { CatalogueImportRow } from "./catalogue-xlsx-core";
export const CATALOGUE_WORKBOOK_BATCH = 250;
export type CatalogueWorkbookRequest =
  | { kind: "read"; file: File }
  | { kind: "next" }
  | { kind: "write-start" }
  | { kind: "write-rows"; rows: unknown[] }
  | { kind: "write-finish" };
export type CatalogueWorkbookResponse =
  | {
      kind: "rows";
      rows: CatalogueImportRow[];
      completed: number;
      total: number;
    }
  | { kind: "ready" }
  | { kind: "buffer"; buffer: ArrayBuffer }
  | { kind: "done" }
  | { kind: "failure"; message: string };
export type CatalogueWorkbookOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};
