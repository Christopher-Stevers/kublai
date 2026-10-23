import { z } from "zod";
import type { TitleBlockWord } from "./drawing-title-block";
export const labelBoxSchema = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  })
  .refine(
    (b) => b.right - b.left >= 0.002 && b.bottom - b.top >= 0.002,
    "Draw a larger box",
  );
export const superLabelSchema = z.object({
  title: labelBoxSchema,
  number: labelBoxSchema,
});
export type LabelBox = z.infer<typeof labelBoxSchema>;
export type SuperLabelBoxes = z.infer<typeof superLabelSchema>;
export function textInLabelBox(words: TitleBlockWord[], box: LabelBox) {
  return words
    .filter((w) => {
      const x = (w.left + w.right) / 2,
        y = (w.top + w.bottom) / 2;
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    })
    .sort((a, b) =>
      Math.abs(a.top - b.top) <
      Math.min(a.bottom - a.top, b.bottom - b.top) * 0.5
        ? a.left - b.left
        : a.top - b.top,
    )
    .map((w) => w.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}
