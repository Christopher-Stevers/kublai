import { z } from "zod";
const box = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});
const answer = z.object({
  value: z.string().max(500),
  confidence: z.number().min(0).max(1),
});
export const slipTestReviewSchema = z.object({
  versionId: z.uuid(),
  documentId: z.uuid(),
  model: z.string().max(80),
  preparedPages: z.array(z.number().int().min(1).max(20)).max(20).optional(),
  rows: z
    .array(
      z.object({
        page: z.number().int().positive(),
        index: z.number().int().positive(),
        box,
        header: box.optional(),
        locationConfidence: z.number().min(0).max(1),
        kind: answer,
        part: answer,
        shipped: answer,
        backordered: answer,
      }),
    )
    .max(200),
});
export type SlipTestReview = z.infer<typeof slipTestReviewSchema>;
