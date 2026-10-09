import { drawingMarkupLinks } from "~/lib/drawing-links";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import type {
  DrawingEntity,
  DrawingJobSheet,
  DrawingMetadata,
  DrawingSave,
  DrawingVisibility,
} from "~/lib/drawing-workspace";
import { drawingMetadataSchema } from "~/lib/drawing-workspace";
import { userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";

export type DrawingActor = {
  id: string;
  name: string;
  organizationId: string;
  canManage: boolean;
};
export function drawingActor(
  user: RequestUser | null,
  organizationId: string,
): DrawingActor {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (user.organizationId !== organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found." });
  if (
    user.organizationAccessStatus !== "approved" ||
    !userCan(user, "tab.dashboard")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approved dashboard access is required.",
    });
  return {
    id: user.id,
    name: user.name ?? "Team member",
    organizationId,
    canManage: userCan(user, "drawings.manage"),
  };
}
export function assertDrawingManager(actor: DrawingActor) {
  if (!actor.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing management permission is required.",
    });
}
export function canReadEntity(entity: DrawingEntity, actor: DrawingActor) {
  return (
    entity.authorId === actor.id ||
    entity.visibility === "published" ||
    (entity.visibility === "archived" && entity.archivedFrom === "published")
  );
}
export function assertRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Someone changed this item. Reload it before saving your edits.",
    });
}
export function defaultDrawingMetadata(sheetId: string): DrawingMetadata {
  return {
    ...drawingMetadataSchema.parse({}),
    revision: 0,
    currentSourceSheetId: sheetId,
  };
}
export function requireSource(
  sheets: DrawingJobSheet[],
  sourceSheetId: string,
) {
  const source = sheets.find((sheet) => sheet.id === sourceSheetId);
  if (!source)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a drawing in this job.",
    });
  return source;
}
export function assertEntityWritable(
  entity: DrawingEntity,
  actor: DrawingActor,
) {
  // Private work remains private even from organization managers.
  if (!canReadEntity(entity, actor))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing item not found.",
    });
  const assignedIssue =
    entity.kind === "issue" && entity.data.assigneeId === actor.id;
  if (entity.authorId !== actor.id && !assignedIssue && !actor.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the author or a drawing manager can edit this item.",
    });
  if (
    (entity.visibility === "published" ||
      entity.archivedFrom === "published") &&
    entity.kind !== "issue" &&
    !actor.canManage
  )
    assertDrawingManager(actor);
}
function assertVisibility(visibility: DrawingVisibility, actor: DrawingActor) {
  if (visibility === "published") assertDrawingManager(actor);
}
export function prepareEntity(
  input: DrawingSave,
  existing: DrawingEntity | null,
  actor: DrawingActor,
  sheets: DrawingJobSheet[],
  memberIds: string[],
  now: string,
): DrawingEntity {
  if (input.kind !== "issue" && input.kind !== "review")
    assertVisibility(input.visibility, actor);
  if (existing) {
    assertEntityWritable(existing, actor);
    assertRevision(existing.revision, input.expectedRevision);
    if (existing.sheetId !== input.sheetId || existing.kind !== input.kind)
      throw new TRPCError({
        code: "CONFLICT",
        message: "An item's sheet and type cannot change.",
      });
    if (["version", "review", "transmittal"].includes(existing.kind))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This is an immutable record. Create a new entry instead.",
      });
    if (
      "sourceSheetId" in existing.data &&
      "sourceSheetId" in input.data &&
      existing.data.sourceSheetId !== input.data.sourceSheetId
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An annotation cannot move to another drawing revision.",
      });
    if (
      existing.kind === "issue" &&
      input.kind === "issue" &&
      existing.authorId !== actor.id &&
      !actor.canManage
    ) {
      const oldFields = {
        ...existing.data,
        status: input.data.status,
        body: input.data.body,
      };
      const fields = input.data;
      if (
        !isDeepStrictEqual(oldFields, fields) ||
        input.visibility !== existing.visibility
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Assignees can update the response and status. Ask the author to change the issue details.",
        });
    }
    if (existing.visibility === "archived")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Archived items cannot be edited.",
      });
  } else {
    assertRevision(0, input.expectedRevision);
    if (input.visibility === "archived")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Create a private or published item first.",
      });
  }
  if (["version", "review", "transmittal"].includes(input.kind)) {
    if (input.kind !== "review" || input.data.status === "pending")
      assertDrawingManager(actor);
    if (input.visibility !== "published")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Version, review and transmittal records are shared with the job.",
      });
  }
  if ("sourceSheetId" in input.data)
    requireSource(sheets, input.data.sourceSheetId);
  if (input.kind === "markup")
    for (const link of drawingMarkupLinks(input.data))
      if (link.targetSheetId) requireSource(sheets, link.targetSheetId);
  if (
    input.kind === "review" &&
    input.data.reviewerId &&
    !memberIds.includes(input.data.reviewerId)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an approved reviewer in this organization.",
    });
  if (
    input.kind === "issue" &&
    input.data.assigneeId &&
    !memberIds.includes(input.data.assigneeId)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an approved member of this organization.",
    });
  const sourceIds =
    input.kind === "transmittal"
      ? [...new Set(input.data.sourceSheetIds)]
      : input.kind === "version" || input.kind === "review"
        ? [input.data.sourceSheetId]
        : [];
  const snapshots = sourceIds.map((sourceId) => {
    const s = requireSource(sheets, sourceId);
    return {
      sheetId: s.id,
      name: s.name,
      imageUrl: s.imageUrl,
      width: s.width,
      height: s.height,
      sourceFilename: s.sourceFilename,
    };
  });
  const base = {
    id: input.id,
    sheetId: input.sheetId,
    revision: (existing?.revision ?? 0) + 1,
    visibility: input.visibility,
    authorId: existing?.authorId ?? actor.id,
    authorName: existing?.authorName ?? actor.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    comments: existing?.comments ?? [],
    ...(snapshots.length ? { snapshots } : {}),
    ...(input.visibility === "archived"
      ? {
          archivedFrom:
            existing?.visibility === "published"
              ? ("published" as const)
              : ("private" as const),
        }
      : {}),
  };
  switch (input.kind) {
    case "markup":
      return { ...base, kind: input.kind, data: input.data };
    case "issue":
      return { ...base, kind: input.kind, data: input.data };
    case "view":
      return { ...base, kind: input.kind, data: input.data };
    case "version":
      return { ...base, kind: input.kind, data: input.data };
    case "review":
      return { ...base, kind: input.kind, data: input.data };
    case "transmittal":
      return { ...base, kind: input.kind, data: input.data };
  }
}
export function archiveEntity(
  existing: DrawingEntity,
  actor: DrawingActor,
  expectedRevision: number,
  now: string,
): DrawingEntity {
  assertEntityWritable(existing, actor);
  if (existing.authorId !== actor.id && !actor.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the author or a drawing manager can archive this item.",
    });
  assertRevision(existing.revision, expectedRevision);
  if (
    existing.kind === "version" ||
    existing.kind === "review" ||
    existing.kind === "transmittal"
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Version, review and transmittal history is immutable.",
    });
  if (existing.visibility === "archived")
    throw new TRPCError({ code: "CONFLICT", message: "Already archived." });
  return {
    ...existing,
    visibility: "archived",
    archivedFrom: existing.visibility,
    revision: existing.revision + 1,
    updatedAt: now,
  };
}
export function addEntityComment(
  existing: DrawingEntity,
  actor: DrawingActor,
  expectedRevision: number,
  body: string,
  id: string,
  now: string,
): DrawingEntity {
  if (!canReadEntity(existing, actor))
    throw new TRPCError({ code: "NOT_FOUND" });
  assertRevision(existing.revision, expectedRevision);
  if (existing.visibility === "archived")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Archived items cannot receive comments.",
    });
  if (existing.comments.length >= 200)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This item has reached its comment limit.",
    });
  return {
    ...existing,
    revision: existing.revision + 1,
    updatedAt: now,
    comments: [
      ...existing.comments,
      { id, authorId: actor.id, authorName: actor.name, body, createdAt: now },
    ],
  };
}
