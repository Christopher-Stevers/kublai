import { z } from "zod";
import type { TitleBlockWord } from "./drawing-title-block";

export const hyperlinkReaders = ["normal", "terra"] as const;
export type HyperlinkReader = (typeof hyperlinkReaders)[number];
export type VisionHyperlinkReader = Exclude<HyperlinkReader, "normal">;
export const hyperlinkReaderLabels: Record<HyperlinkReader, string> = {
  normal: "Version 1 · Normal",
  terra: "Version 2 · Terra",
};
export const hyperlinkDetectInput = z.object({
  sheetId: z.uuid(),
  sourceSheetId: z.uuid(),
  reader: z.literal("terra"),
  requestId: z.uuid(),
  refresh: z.boolean().default(false),
});
export type HyperlinkDetection = {
  reader: VisionHyperlinkReader;
  model: string;
  tags: Array<{
    tag: string;
    boxes: TitleBlockWord[];
    needsPositionReview: boolean;
  }>;
  warnings: string[];
};
