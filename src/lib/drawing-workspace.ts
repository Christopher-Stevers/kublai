import { z } from "zod";

export const drawingPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export type DrawingPoint = z.infer<typeof drawingPointSchema>;
export const drawingMarkupTypeSchema = z.enum([
  "freehand",
  "highlight",
  "text",
  "callout",
  "cloud",
  "polycloud",
  "rect",
  "ellipse",
  "polyline",
  "line",
  "arrow",
  "dimension",
  "area",
  "angle",
  "count",
  "link",
]);
export type DrawingTool =
  | "pan"
  | "select"
  | "issue"
  | "rfi"
  | z.infer<typeof drawingMarkupTypeSchema>;
const id = z.string().uuid();
const shortText = z.string().trim().max(255);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$|^none$/);
export const drawingLinkSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (
      /^\/api\/drawings\/attachments\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(
        value,
      )
    )
      return true;
    if (
      /^\/api\/(job-rooms\/files|job-documents\/files)\/[a-zA-Z0-9_./%-]+$/.test(
        value,
      ) &&
      !value.includes("..") &&
      !/%2f|%5c|%2e/i.test(value)
    )
      return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS URL or an existing job file.");
export const drawingMarkupSchema = z
  .object({
    sourceSheetId: id,
    type: drawingMarkupTypeSchema,
    points: z.array(drawingPointSchema).min(1).max(4000),
    stroke: color.default("#ef4444"),
    width: z.number().finite().min(0.1).max(40).default(2),
    fill: color.optional(),
    opacity: z.number().finite().min(0.05).max(1).optional(),
    text: z.string().max(4000).optional(),
    href: drawingLinkSchema.optional(),
    targetSheetId: id.optional(),
    unit: z.enum(["mm", "cm", "m", "in", "ft"]).optional(),
    scale: z.number().finite().positive().max(1e9).optional(),
  })
  .superRefine((markup, ctx) => {
    const minimum = ["text", "count"].includes(markup.type)
      ? 1
      : ["area", "polycloud", "angle"].includes(markup.type)
        ? 3
        : 2;
    if (markup.points.length < minimum)
      ctx.addIssue({
        code: "custom",
        path: ["points"],
        message: `This tool needs at least ${minimum} points.`,
      });
    if (markup.type === "angle" && markup.points.length !== 3)
      ctx.addIssue({
        code: "custom",
        path: ["points"],
        message: "An angle needs exactly three points.",
      });
  });
export type DrawingMarkup = z.infer<typeof drawingMarkupSchema>;
export type DrawingStyle = Pick<
  DrawingMarkup,
  "stroke" | "width" | "fill" | "opacity"
>;
export const drawingIssueSchema = z.object({
  sourceSheetId: id,
  type: z.enum(["issue", "rfi"]),
  point: drawingPointSchema,
  title: z.string().trim().min(1).max(255),
  body: z.string().max(12000).default(""),
  status: z.enum(["open", "in_progress", "answered", "closed"]).default("open"),
  assigneeId: z.string().min(1).max(255).nullable().default(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  links: z
    .array(z.object({ label: shortText, url: drawingLinkSchema }))
    .max(20)
    .default([]),
});
export type DrawingIssue = z.infer<typeof drawingIssueSchema>;
export const drawingViewSchema = z.object({
  sourceSheetId: id,
  name: z.string().trim().min(1).max(255),
  center: drawingPointSchema,
  zoom: z.number().finite().min(0.1).max(100),
});
export type DrawingSavedView = z.infer<typeof drawingViewSchema>;
export const drawingVersionSchema = z.object({
  sourceSheetId: id,
  label: z.string().trim().min(1).max(255),
  description: z.string().max(4000).default(""),
});
export const drawingReviewSchema = z.object({
  sourceSheetId: id,
  reviewerId: z.string().min(1).max(255).nullable().default(null),
  requestId: id.optional(),
  status: z.enum(["pending", "approved", "changes_requested"]),
  body: z.string().max(12000).default(""),
});
export const drawingTransmittalSchema = z.object({
  title: z.string().trim().min(1).max(255),
  recipient: z.string().max(500),
  body: z.string().max(12000).default(""),
  sourceSheetIds: z.array(id).min(1).max(100),
});
export const drawingVisibilitySchema = z.enum([
  "private",
  "published",
  "archived",
]);
export type DrawingVisibility = z.infer<typeof drawingVisibilitySchema>;
const mutationBase = {
  expectedUserId: z.string().min(1).max(255).optional(),
  sheetId: id,
  id,
  expectedRevision: z.number().int().min(0),
  visibility: drawingVisibilitySchema,
};
export const drawingSaveSchema = z.discriminatedUnion("kind", [
  z.object({
    ...mutationBase,
    kind: z.literal("markup"),
    data: drawingMarkupSchema,
  }),
  z.object({
    ...mutationBase,
    kind: z.literal("issue"),
    data: drawingIssueSchema,
  }),
  z.object({
    ...mutationBase,
    kind: z.literal("view"),
    data: drawingViewSchema,
  }),
  z.object({
    ...mutationBase,
    kind: z.literal("version"),
    expectedMetadataRevision: z.number().int().min(0),
    data: drawingVersionSchema,
  }),
  z.object({
    ...mutationBase,
    kind: z.literal("review"),
    expectedMetadataRevision: z.number().int().min(0),
    data: drawingReviewSchema,
  }),
  z.object({
    ...mutationBase,
    kind: z.literal("transmittal"),
    data: drawingTransmittalSchema,
  }),
]);
export type DrawingSaveInput = z.input<typeof drawingSaveSchema>;
export type DrawingSave = z.infer<typeof drawingSaveSchema>;
export type DrawingEntityKind = DrawingSave["kind"];
export type DrawingComment = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
export type DrawingSnapshot = {
  sheetId: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  sourceFilename: string | null;
};
type EntityBase = {
  id: string;
  sheetId: string;
  revision: number;
  visibility: DrawingVisibility;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  comments: DrawingComment[];
  snapshots?: DrawingSnapshot[];
  archivedFrom?: "private" | "published";
};
export type DrawingEntity = EntityBase &
  (
    | { kind: "markup"; data: DrawingMarkup }
    | { kind: "issue"; data: DrawingIssue }
    | { kind: "view"; data: DrawingSavedView }
    | { kind: "version"; data: z.infer<typeof drawingVersionSchema> }
    | { kind: "review"; data: z.infer<typeof drawingReviewSchema> }
    | { kind: "transmittal"; data: z.infer<typeof drawingTransmittalSchema> }
  );
export const drawingMetadataSchema = z.object({
  number: shortText.default(""),
  title: shortText.default(""),
  discipline: shortText.default(""),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  status: z
    .enum(["draft", "for_review", "approved", "superseded"])
    .default("draft"),
  scale: z
    .object({
      unitsPerSheetWidth: z.number().finite().positive().max(1e9),
      unit: z.enum(["ft", "m"]),
      label: z.string().max(255).optional(),
    })
    .nullable()
    .default(null),
});
export type DrawingMetadata = z.infer<typeof drawingMetadataSchema> & {
  revision: number;
  currentSourceSheetId: string;
};
export type DrawingJobSheet = DrawingSnapshot & { id: string; setId: string };
export type DrawingActivity = {
  id: string;
  entityId: string | null;
  action: string;
  actorId: string;
  actorName: string;
  createdAt: string;
};
export type DrawingWorkspace = {
  sheetId: string;
  jobId: string;
  canManage: boolean;
  actor: { id: string; name: string };
  members: { id: string; name: string }[];
  jobSheets: DrawingJobSheet[];
  entities: DrawingEntity[];
  metadata: DrawingMetadata;
  favorite: boolean;
  watching: boolean;
  activity: DrawingActivity[];
};
export type DrawingSheetSummary = {
  sheetId: string;
  metadata: DrawingMetadata;
  favorite: boolean;
  issueCount: number;
  markupCount: number;
  watching: boolean;
};

export type DrawingNotification = {
  id: string;
  jobId: string;
  sheetId: string;
  setId: string;
  entityId: string;
  revision: number;
  reason: "watch" | "assignment" | "review";
  createdAt: string;
  readAt: string | null;
  url: string;
};
