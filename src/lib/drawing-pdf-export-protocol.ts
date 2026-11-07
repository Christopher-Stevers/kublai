import type {
  DrawingPdfExportOptions,
  DrawingPdfPackageOptions,
} from "./drawing-pdf-build";
export type PreparedDrawingExport = Omit<
  DrawingPdfExportOptions,
  "signal" | "resolveSource" | "markupLinkUrl"
> & { linkUrls: Array<string | null> };
export type DrawingExportRequest =
  | { kind: "sheet"; options: PreparedDrawingExport }
  | {
      kind: "package";
      options: Omit<
        DrawingPdfPackageOptions,
        "signal" | "resolveSource" | "sheets"
      > & { sheets: PreparedDrawingExport[] };
    };
export type DrawingExportResponse =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };
