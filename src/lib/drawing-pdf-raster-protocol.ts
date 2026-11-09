import type { DrawingPatch } from "./drawing-viewport";

export type RasterRequest =
  | { type: "render"; id: number; url: string; page: number; patch: DrawingPatch }
  | { type: "open"; url: string; page: number }
  | { type: "cancel"; id: number }
  | { type: "forget"; url: string }
  /** The page's answer to a worker's byte request. */
  | { type: "bytes"; request: number; length?: number; data?: Uint8Array };

/** The worker asks the page for PDF bytes, so both read one download.
 * Without `begin` it asks for the file's size and first block. */
export type RasterByteRequest = {
  bytes: number;
  url: string;
  begin?: number;
  end?: number;
};

export type RasterResponse =
  | { id: number; ok: true; bitmap: ImageBitmap; renderMs: number }
  | {
      id: number;
      ok: false;
      error: string;
      cancelled?: boolean;
      /** The page needs a feature only the main thread has (SVG filters). */
      unsupported?: boolean;
    };
