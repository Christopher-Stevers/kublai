import { z } from "zod";
export const assessmentSourceSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  name: z.string(),
  fileName: z.string().optional(),
  sha256: z.string(),
  mimeType: z.string(),
});
export type AssessmentSource = z.infer<typeof assessmentSourceSchema>;
export const assessmentSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["processing", "ready", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  stage: z.string(),
  error: z.string().optional(),
  warnings: z.array(z.string()),
  sourceFingerprint: z.string(),
  sources: z.array(assessmentSourceSchema),
  model: z.string().optional(),
  systemCount: z.number().optional(),
});
export type SystemsAssessment = z.infer<typeof assessmentSchema>;
export const extractedSourceSchema = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().positive().nullable(),
        text: z.string().max(100000),
      }),
    )
    .max(300),
  warnings: z.array(z.string()).max(350),
});
export type ExtractedSource = z.infer<typeof extractedSourceSchema>;
