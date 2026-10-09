import { z } from "zod";

const id = z.uuid();
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !/[\x00-\x1f\x7f/\\]/.test(value),
    "Names cannot contain slashes or control characters.",
  );
const folderId = id.nullable().optional();
const documentId = id;
const documentIds = z
  .array(id)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate documents.");
const title = z.string().trim().min(1).max(200);
export const submittalInputSchema = z.object({
  title,
  category: z.string().trim().max(100),
  specSection: z.string().trim().max(100),
  manufacturer: z.string().trim().max(200),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T12:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    }, "Choose a valid date.")
    .nullable(),
});
export const documentActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("updateSubmittal"),
    documentId,
    expectedUpdatedAt: z.iso.datetime(),
    details: submittalInputSchema,
  }),
  z.object({
    action: z.literal("registerSubmittal"),
    documentId,
    expectedVersionId: id,
    details: submittalInputSchema,
  }),
  z.object({ action: z.literal("createFolder"), name, parentId: folderId }),
  z.object({
    action: z.literal("updateFolder"),
    folderId: id,
    name: name.optional(),
    parentId: folderId,
  }),
  z.object({
    action: z.literal("updateDocument"),
    documentId,
    name: name.optional(),
    folderId,
    description: z.string().max(10000).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    status: z.enum(["draft", "in_review", "approved", "superseded"]).optional(),
  }),
  z.object({ action: z.literal("delete"), documentId }),
  z.object({ action: z.literal("restore"), documentId }),
  z.object({ action: z.literal("lock"), documentId }),
  z.object({ action: z.literal("unlock"), documentId }),
  z.object({
    action: z.literal("copy"),
    documentId,
    folderId,
    name: name.optional(),
  }),
  z.object({ action: z.literal("restoreVersion"), documentId, versionId: id }),
  z.object({
    action: z.literal("comment"),
    documentId,
    body: z.string().trim().min(1).max(10000),
  }),
  z.object({
    action: z.literal("setFolderPermissions"),
    folderId: id,
    permissions: z
      .array(
        z.object({
          userId: z.string().min(1).max(255),
          role: z.enum(["viewer", "editor", "manager"]),
        }),
      )
      .max(200),
  }),
  z.object({
    action: z.literal("createReview"),
    documentIds,
    title,
    reviewerId: z.string().min(1).max(255),
  }),
  z.object({
    action: z.literal("resolveReview"),
    reviewId: id,
    decision: z.enum(["approved", "changes_requested"]),
    comment: z.string().max(10000).optional(),
  }),
  z.object({
    action: z.literal("createTransmittal"),
    documentIds,
    title,
    recipients: z.array(z.email().max(254)).min(1).max(100),
    message: z.string().max(10000).optional(),
  }),
  z.object({
    action: z.literal("linkOffice"),
    name,
    folderId,
    webUrl: z.string().max(2048),
  }),
]);
export const uploadMetadataSchema = z.object({
  submittal: submittalInputSchema.optional(),
  jobId: id,
  folderId,
  documentId: id.optional(),
  expectedVersionId: id.optional(),
  name,
});
export const jobIdSchema = id;

const encodedSubmittalSchema = z
  .string()
  .max(8192)
  .transform((value, context): unknown => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid submittal metadata.",
      });
      return z.NEVER;
    }
  })
  .pipe(submittalInputSchema);
export function parseSubmittalUpload(value: FormDataEntryValue | null) {
  return value === null ? undefined : encodedSubmittalSchema.parse(value);
}
