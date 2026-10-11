import { z } from "zod";

export const MAX_MODEL_BYTES = 250 * 1024 * 1024;
export const MODEL_CHUNK_BYTES = 8 * 1024 * 1024;
export const disciplines = [
  "architecture",
  "structure",
  "mechanical",
  "electrical",
  "plumbing",
  "fire",
  "civil",
  "coordination",
] as const;
export const point3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type Point3 = z.infer<typeof point3Schema>;
export const modelRefSchema = z.object({
  modelId: z.string().uuid(),
  expressId: z.number().int().positive(),
  guid: z.string().max(100).optional(),
});
export type ModelRef = z.infer<typeof modelRefSchema>;
export const measurementSchema = z.object({
  id: z.string().uuid(),
  points: z.array(point3Schema).min(2).max(100),
  type: z.enum(["distance", "area"]),
  label: z.string().max(120).default(""),
});
export type BimMeasurement = z.infer<typeof measurementSchema>;
export const viewStateSchema = z.object({
  modelIds: z.array(z.string().uuid()).min(1).max(20),
  position: point3Schema,
  target: point3Schema,
  origin: point3Schema,
  up: point3Schema.default([0, 1, 0]),
  projection: z.enum(["perspective", "orthographic"]).default("perspective"),
  orthoScale: z.number().positive().max(1e8).default(30),
  hidden: z.array(z.string().max(100)).max(100000).default([]),
  isolated: z.array(z.string().max(100)).max(100000).default([]),
  categories: z.array(z.string().max(120)).max(500).default([]),
  levels: z.array(z.string().max(200)).max(500).default([]),
  section: z
    .object({
      axis: z.enum(["x", "y", "z"]),
      value: z.number().finite(),
      flipped: z.boolean(),
    })
    .nullable()
    .default(null),
  sectionBox: z
    .object({ min: point3Schema, max: point3Schema })
    .nullable()
    .default(null),
  measurements: z.array(measurementSchema).max(100).default([]),
  xray: z.boolean().default(false),
});
export type BimViewState = z.infer<typeof viewStateSchema>;
export const issueSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(""),
  kind: z
    .enum(["coordination", "rfi", "punch", "safety"])
    .default("coordination"),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).default("open"),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  assigneeId: z.string().max(255).nullable().default(null),
  dueDate: z.string().date().nullable().default(null),
  point: point3Schema,
  element: modelRefSchema.nullable().default(null),
  view: viewStateSchema,
});
export type BimIssueData = z.infer<typeof issueSchema>;
export type BimIssue = BimIssueData & {
  id: string;
  revision: number;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  comments: {
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: string;
  }[];
};
export type BimSavedView = {
  id: string;
  name: string;
  view: BimViewState;
  authorId: string;
  authorName: string;
  createdAt: string;
};
export type BimModel = {
  id: string;
  seriesId: string;
  version: number;
  name: string;
  discipline: (typeof disciplines)[number];
  filename: string;
  format: "ifc" | "rvt";
  size: number;
  status: "ready" | "awaiting_conversion" | "processing" | "failed";
  publication: "coordination" | "construction" | "archived";
  conversionMessage: string | null;
  uploadedBy: string;
  createdAt: string;
};
export type BimElement = {
  key: string;
  modelId: string;
  expressId: number;
  guid: string;
  name: string;
  type: string;
  level: string;
  levelName: string;
};
export type BimProperties = { group: string; name: string; value: string }[];
export type BimWorkspace = {
  job: { id: string; name: string };
  userId: string;
  canUpload: boolean;
  canDelete: boolean;
  canConfigureAutodesk: boolean;
  conversionAvailable: boolean;
  models: BimModel[];
  views: BimSavedView[];
  issues: BimIssue[];
  members: { id: string; name: string }[];
};
export const uploadMetadataSchema = z.object({
  jobId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_MODEL_BYTES),
  discipline: z.enum(disciplines).default("coordination"),
  seriesId: z.string().uuid().optional(),
  expectedModelId: z.string().uuid().optional(),
});
export type ModelUploadMetadata = z.infer<typeof uploadMetadataSchema>;
export const elementKey = (modelId: string, expressId: number) =>
  `${modelId}:${expressId}`;
