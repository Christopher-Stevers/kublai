import { z } from "zod";
export const assessmentAiSchema = z
  .object({
    mode: z.enum(["hosted", "custom"]),
    baseUrl: z.string().trim().max(500).default(""),
    model: z.string().trim().max(150).default(""),
    apiKey: z.string().trim().max(1000).default(""),
    reasoning: z.enum(["default", "low", "medium", "high"]).default("default"),
  })
  .strict();
export type AssessmentAi = z.infer<typeof assessmentAiSchema>;
