import { z } from "zod";
import { isAppLink } from "./app-links";
import { MAX_DRAWING_LINKS } from "./drawing-links";
import { readSnapshotState, safeSnapshotHref } from "./snapshot-source";

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
  .max(16_000)
  .refine(
    (value) =>
      value.length <= 2048 ||
      (safeSnapshotHref(value) &&
        Boolean(
          readSnapshotState(new URL(value, "https://foremanhq.invalid").hash),
        )),
    "This address is too long.",
  )
  .refine(isAppLink, "Use a web, email, phone or ForemanHQ link.");
export const drawingMarkupLinkSchema = z
  .object({
    label: shortText.min(1, "Give each destination a name."),
    url: drawingLinkSchema.optional(),
    targetSheetId: id.optional(),
  })
  .refine(
    (link) => Boolean(link.url) !== Boolean(link.targetSheetId),
    "Choose one destination for each link.",
  );
export type DrawingMarkupLink = z.infer<typeof drawingMarkupLinkSchema>;
export const drawingMarkupSchema = z
  .object({
    sourceSheetId: id,
    type: drawingMarkupTypeSchema,
    points: z.array(drawingPointSchema).min(1).max(4000),
    /** Saved measuring runs can branch; null starts a disconnected run. */
    parents: z
      .array(z.number().int().min(0).max(3999).nullable())
      .min(2)
      .max(4000)
      .optional(),
    /** Attached line directions preserve the first segment's angle after saving. */
    angleReferences: z
      .array(
        z
          .object({
            x: z.number().finite().min(-1).max(1),
            y: z.number().finite().min(-1).max(1),
          })
          .nullable(),
      )
      .min(2)
      .max(4000)
      .optional(),
    stroke: color.default("#ef4444"),
    width: z.number().finite().min(0.1).max(40).default(2),
    /** Text size in the shared 1000-unit drawing coordinate system. */
    fontSize: z.number().finite().min(6).max(300).optional(),
    fill: color.optional(),
    opacity: z.number().finite().min(0.05).max(1).optional(),
    text: z.string().max(4000).optional(),
    href: drawingLinkSchema.optional(),
    targetSheetId: id.optional(),
    links: z
      .array(drawingMarkupLinkSchema)
      .min(1, "Add at least one destination to the hyperlink.")
      .max(MAX_DRAWING_LINKS)
      .optional(),
    linkAppearance: z.enum(["box", "highlight"]).optional(),
    unit: z.enum(["mm", "cm", "m", "in", "ft"]).optional(),
    scale: z.number().finite().positive().max(1e9).optional(),
  })
  .superRefine((markup, ctx) => {
    if (
      markup.angleReferences &&
      (markup.type !== "dimension" ||
        !markup.parents ||
        markup.angleReferences.length !== markup.points.length ||
        markup.angleReferences.some(
          (reference) =>
            reference && Math.hypot(reference.x, reference.y) < 1e-9,
        ))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["angleReferences"],
        message: "Invalid measurement angle references.",
      });
    }
    if (markup.parents) {
      const parents = markup.parents;
      if (
        markup.type !== "dimension" ||
        parents.length !== markup.points.length ||
        !parents.some((parent) => parent !== null) ||
        parents.some(
          (parent, index) =>
            parent !== null && (parent >= parents.length || parent === index),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["parents"],
          message: "Invalid measurement connections.",
        });
      } else {
        const visited = new Uint8Array(parents.length);
        for (let index = 0; index < parents.length; index++) {
          let next: number | null = index;
          const path: number[] = [];
          while (next !== null && visited[next] === 0) {
            visited[next] = 1;
            path.push(next);
            next = parents[next]!;
          }
          if (next !== null && visited[next] === 1) {
            ctx.addIssue({
              code: "custom",
              path: ["parents"],
              message: "Measurement connections cannot form a cycle.",
            });
            break;
          }
          for (const node of path) visited[node] = 2;
        }
      }
    }
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
    visibility: drawingVisibilitySchema.default("published"),
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
/** Own markups and private issues can be durably saved before reconnecting. */
export function isQueuedDrawingEdit(
  input: DrawingSave,
): input is Extract<DrawingSave, { kind: "markup" | "issue" }> {
  return (
    (input.kind === "markup" &&
      (input.visibility === "private" || input.visibility === "published")) ||
    (input.kind === "issue" && input.visibility === "private")
  );
}
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
