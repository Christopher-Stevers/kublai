import type { DrawingPatch } from "./drawing-viewport";

export type RasterRequest =
  | { type: "render"; id: number; url: string; page: number; patch: DrawingPatch }
  | { type: "open"; url: string; page: number }
  | { type: "cancel"; id: number }
  | { type: "forget"; url: string };

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
