import {
  equipmentAnnotationPlan,
  withoutTagHighlight,
} from "./equipment-annotations";
import { estimates } from "~/server/db/estimating-schema";
import {
  proposeDrawingRevisions,
  compatibleRevisionScale,
  revisionChangedRegions,
  nearRevisionChanges,
} from "~/lib/drawing-revision-review";
import { prepareRevisionEvidence, revisionEvidence } from "./revision-evidence";
import { documentDrawingAccess } from "~/server/documents/drawing-workspace";
import { drawingMarkupLinks } from "~/lib/drawing-links";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  DrawingActivity,
  DrawingEntity,
  DrawingJobSheet,
  DrawingMetadata,
  DrawingSave,
  DrawingSheetSummary,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
import type { drawingMetadataSchema } from "~/lib/drawing-workspace";
import type { db as database } from "~/server/db";
import {
  users,
  jobs,
  jobChatAttachments,
  jobChatMessages,
} from "~/server/chat/tables";
import {
  jobDrawingSets,
  jobDrawingSheets,
  jobDocumentWorkspaces,
} from "~/server/db/schema";
import {
  drawingWorkspaceEntities as entities,
  drawingWorkspaceMetadata as metadata,
  drawingWorkspaceFavorites as favorites,
  drawingWorkspaceActivity as activity,
  drawingWorkspaceWatches as watches,
} from "~/server/db/drawing-workspace-schema";
import type { RequestUser } from "~/server/utils/get-request-identity";
import { accessibleDocument } from "~/server/documents/domain";
import { enqueueDrawingNotifications } from "./notifications";
import { hasManagingSeat, userCan } from "~/server/auth/permissions";
import {
  addEntityComment,
  archiveEntity,
  assertDrawingManager,
  assertRevision,
  canReadEntity,
  defaultDrawingMetadata,
  drawingActor,
  isQueuedDrawingReplay,
  prepareEntity,
  requireSource,
  type DrawingActor,
} from "./domain";

type Database = typeof database;
type Reader = Pick<Database, "select">;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DrawingContext = { db: Database; userId: string };
const MAX_ENTITIES = 2000;
const MAX_SHEETS = 2000;
const MAX_ENTITY_BYTES = 1_000_000;
const MAX_SHEET_BYTES = 16_000_000;
async function freshUser(reader: Reader, userId: string) {
  const [row] = await reader
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row ?? null) as RequestUser | null;
}
export async function accessSheet(
  reader: Reader,
  userId: string,
  sheetId: string,
) {
  const [user, rows] = await Promise.all([
    freshUser(reader, userId),
    reader
      .select()
      .from(jobDrawingSheets)
      .where(eq(jobDrawingSheets.id, sheetId))
      .limit(1),
  ]);
  const sheet = rows[0];
  if (!sheet)
    throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found." });
  if (sheet.documentVersionId) {
    const document = await documentDrawingAccess(
      reader,
      userId,
      sheet.jobId,
      sheet.documentVersionId,
    );
    return {
      actor: document.actor,
      sheet,
      user: document.access.user,
      canAnnotate: document.canAnnotate,
    };
  }
  const actor = drawingActor(user, sheet.organizationId);
  return { actor, sheet, user: user!, canAnnotate: true };
}
async function jobSheets(
  reader: Reader,
  jobId: string,
  organizationId: string,
  documentVersionId?: string | null,
): Promise<DrawingJobSheet[]> {
  const rows = await reader
    .select({
      id: jobDrawingSheets.id,
      setId: jobDrawingSheets.setId,
      setName: jobDrawingSets.name,
      name: jobDrawingSheets.name,
      imageUrl: jobDrawingSheets.imageUrl,
      width: jobDrawingSheets.width,
      height: jobDrawingSheets.height,
      sourceFilename: jobDrawingSheets.sourceFilename,
    })
    .from(jobDrawingSheets)
    .leftJoin(
      jobDrawingSets,
      and(
        eq(jobDrawingSets.id, jobDrawingSheets.setId),
        eq(jobDrawingSets.organizationId, organizationId),
        eq(jobDrawingSets.jobId, jobId),
      ),
    )
    .where(
      and(
        eq(jobDrawingSheets.jobId, jobId),
        eq(jobDrawingSheets.organizationId, organizationId),
        documentVersionId
          ? eq(jobDrawingSheets.documentVersionId, documentVersionId)
          : isNull(jobDrawingSheets.documentVersionId),
      ),
    )
    .orderBy(asc(jobDrawingSheets.sortOrder), asc(jobDrawingSheets.createdAt))
    .limit(MAX_SHEETS + 1);
  if (rows.length > MAX_SHEETS)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This job exceeds the workspace sheet limit.",
    });
  return rows.map((row) => ({ ...row, sheetId: row.id }));
}
async function members(reader: Reader, organizationId: string) {
  const rows = await reader
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.organizationAccessStatus, "approved"),
      ),
    )
    .limit(2001);
  if (rows.length > 2000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Too many organization members.",
    });
  return (rows as RequestUser[])
    .filter(
      (user) =>
        userCan(user, "tab.dashboard") && userCan(user, "drawings.view"),
    )
    .map((user) => ({ id: user.id, name: user.name ?? "Team member" }));
}
async function sheetMetadata(
  reader: Reader,
  sheetId: string,
): Promise<DrawingMetadata> {
  const [row] = await reader
    .select()
    .from(metadata)
    .where(eq(metadata.sheetId, sheetId))
    .limit(1);
  return row?.data ?? defaultDrawingMetadata(sheetId);
}
async function sheetEntities(reader: Reader, sheetId: string) {
  const rows = await reader
    .select()
    .from(entities)
    .where(eq(entities.sheetId, sheetId))
    .limit(MAX_ENTITIES + 1);
  if (rows.length > MAX_ENTITIES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This drawing exceeds its item limit.",
    });
  return rows.map((row) => row.entity);
}
async function writeMetadata(
  tx: Transaction,
  sheetId: string,
  data: DrawingMetadata,
) {
  await tx
    .insert(metadata)
    .values({ sheetId, data, revision: data.revision })
    .onConflictDoUpdate({
      target: metadata.sheetId,
      set: { data, revision: data.revision },
    });
}
async function record(
  tx: Transaction,
  sheetId: string,
  actor: DrawingActor,
  action: string,
  entityId: string | null,
) {
  const entry: DrawingActivity = {
    id: randomUUID(),
    entityId,
    action,
    actorId: actor.id,
    actorName: actor.name,
    createdAt: new Date().toISOString(),
  };
  await tx.insert(activity).values({ id: entry.id, sheetId, entry });
  // Keep a bounded recent audit feed; entity comments and immutable snapshots persist.
  await tx.execute(
    sql`delete from ${activity} where ${activity.sheetId} = ${sheetId} and ${activity.id} in (select id from ${activity} where "sheetId" = ${sheetId} order by "createdAt" desc, id desc offset 10000)`,
  );
}
async function withSheet<T>(
  ctx: DrawingContext,
  sheetId: string,
  mutate: (
    tx: Transaction,
    access: Awaited<ReturnType<typeof accessSheet>>,
  ) => Promise<T>,
) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${sheetId}, 4150))`,
    );
    let access = await accessSheet(tx, ctx.userId, sheetId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${access.sheet.jobId}, 4151))`,
    );
    if (access.sheet.documentVersionId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${access.sheet.jobId}, 4149))`,
      );
    }
    access = await accessSheet(tx, ctx.userId, sheetId);
    if (!access.canAnnotate)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This document version is read only or locked.",
      });
    // Prevent deletion while cross-sheet references or children are being inserted.
    await tx
      .select({ id: jobDrawingSheets.id })
      .from(jobDrawingSheets)
      .where(eq(jobDrawingSheets.id, sheetId))
      .for("key share");
    return mutate(tx, access);
  });
}
function entityById(items: DrawingEntity[], id: string, actor: DrawingActor) {
  const item = items.find((item) => item.id === id);
  if (!item || !canReadEntity(item, actor))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing item not found.",
    });
  return item;
}
async function persistEntity(
  tx: Transaction,
  sheet: { id: string; jobId: string; organizationId: string },
  entity: DrawingEntity,
  expectedRevision: number,
  all: DrawingEntity[],
) {
  const bytes = Buffer.byteLength(JSON.stringify(entity));
  const total =
    bytes +
    all
      .filter((item) => item.id !== entity.id)
      .reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);
  if (
    bytes > MAX_ENTITY_BYTES ||
    total > MAX_SHEET_BYTES ||
    (!all.some((item) => item.id === entity.id) && all.length >= MAX_ENTITIES)
  )
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This drawing has reached its annotation storage limit.",
    });
  if (!expectedRevision) {
    const rows = await tx
      .insert(entities)
      .values({
        id: entity.id,
        sheetId: sheet.id,
        jobId: sheet.jobId,
        organizationId: sheet.organizationId,
        revision: entity.revision,
        entity,
      })
      .onConflictDoNothing()
      .returning({ id: entities.id });
    if (!rows.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This item was already saved. Reload before retrying.",
      });
  } else {
    const rows = await tx
      .update(entities)
      .set({ entity, revision: entity.revision })
      .where(
        and(
          eq(entities.id, entity.id),
          eq(entities.sheetId, sheet.id),
          eq(entities.revision, expectedRevision),
        ),
      )
      .returning({ id: entities.id });
    if (!rows.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The item changed. Reload before saving.",
      });
  }
}
async function validateLinks(
  reader: Reader,
  input: DrawingSave,
  access: Awaited<ReturnType<typeof accessSheet>>,
  sheets: DrawingJobSheet[],
) {
  const urls =
    input.kind === "markup"
      ? drawingMarkupLinks(input.data)
          .map((link) => link.url)
          .filter((url): url is string => !!url)
      : input.kind === "issue"
        ? input.data.links.map((link) => link.url)
        : [];
  for (const url of urls) {
    if (/^(https?:|mailto:|tel:)/i.test(url) || url.startsWith("/dashboard"))
      continue;
    if (url.startsWith("/api/job-chat/attachments/")) {
      const [photo] = await reader
        .select({ id: jobChatAttachments.id })
        .from(jobChatAttachments)
        .innerJoin(
          jobs,
          and(
            eq(jobs.id, jobChatAttachments.jobId),
            eq(jobs.organizationId, access.actor.organizationId),
          ),
        )
        .innerJoin(
          jobChatMessages,
          and(
            eq(jobChatMessages.id, jobChatAttachments.messageId),
            eq(jobChatMessages.jobId, jobChatAttachments.jobId),
            isNull(jobChatMessages.deletedAt),
          ),
        )
        .where(eq(jobChatAttachments.id, url.split("/").at(-1)!))
        .limit(1);
      if (!photo)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat attachment not found.",
        });
      continue;
    }
    if (url.startsWith("/api/drawings/attachments/")) {
      if (!url.startsWith(`/api/drawings/attachments/${access.sheet.jobId}/`))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attachment must belong to this job.",
        });
      const fileId = url.split("/").at(-1)!;
      const { drawingAttachmentInfo } = await import("./attachments");
      const info = await drawingAttachmentInfo(access.sheet.jobId, fileId);
      requireSource(sheets, info.sheetId);
      if (info.authorId !== access.actor.id) {
        const [visible] = await reader
          .select({ id: entities.id })
          .from(entities)
          .where(
            and(
              eq(entities.jobId, access.sheet.jobId),
              eq(entities.organizationId, access.actor.organizationId),
              sql`entity->>'kind' in ('issue','markup') and (entity->>'visibility'='published' or entity->>'authorId'=${access.actor.id}) and (entity->'data'->'links' @> ${JSON.stringify([{ url }])}::jsonb or (entity->'data'->'links' is null and entity->'data'->>'href'=${url}))`,
            ),
          )
          .limit(1);
        if (!visible)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Drawing attachment not found.",
          });
      }
      continue;
    }
    if (url.startsWith("/api/job-rooms/files/")) {
      // A relative file must belong to this job and an existing sheet upload.
      const root = `/api/job-rooms/files/${access.sheet.jobId}/`;
      if (
        !url.startsWith(root) ||
        !sheets.some((sheet) =>
          url.startsWith(
            sheet.imageUrl.slice(0, sheet.imageUrl.lastIndexOf("/") + 1),
          ),
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Link a file from this drawing job.",
        });
      continue;
    }
    const match = /^\/api\/job-documents\/files\/([a-f0-9-]{36})$/i.exec(url);
    if (!match)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid job file link.",
      });
    const [workspace] = await reader
      .select()
      .from(jobDocumentWorkspaces)
      .where(
        and(
          eq(jobDocumentWorkspaces.jobId, access.sheet.jobId),
          eq(jobDocumentWorkspaces.organizationId, access.sheet.organizationId),
        ),
      )
      .limit(1);
    const version = workspace?.state.versions.find(
      (version) => version.id === match[1],
    );
    if (!workspace || !version)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Document link must belong to this job.",
      });
    accessibleDocument(
      workspace.state,
      {
        userId: access.actor.id,
        jobId: access.sheet.jobId,
        canManage:
          hasManagingSeat(access.user) &&
          userCan(access.user, "documents.manage"),
        canWrite: userCan(access.user, "documents.manage"),
        memberIds: [],
      },
      version.documentId,
    );
  }
}
export async function getDrawingWorkspace(
  ctx: DrawingContext,
  sheetId: string,
): Promise<DrawingWorkspace> {
  const access = await accessSheet(ctx.db, ctx.userId, sheetId);
  const [items, data, people, sheets, starred, events, watched] =
    await Promise.all([
      sheetEntities(ctx.db, sheetId),
      sheetMetadata(ctx.db, sheetId),
      members(ctx.db, access.actor.organizationId),
      jobSheets(
        ctx.db,
        access.sheet.jobId,
        access.actor.organizationId,
        access.sheet.documentVersionId,
      ),
      ctx.db
        .select()
        .from(favorites)
        .where(
          and(eq(favorites.sheetId, sheetId), eq(favorites.userId, ctx.userId)),
        )
        .limit(1),
      ctx.db
        .select()
        .from(activity)
        .where(eq(activity.sheetId, sheetId))
        .orderBy(desc(activity.createdAt))
        .limit(500),
      ctx.db
        .select()
        .from(watches)
        .where(
          and(eq(watches.sheetId, sheetId), eq(watches.userId, ctx.userId)),
        )
        .limit(1),
    ]);
  const visible = items.filter((item) => canReadEntity(item, access.actor));
  const ids = new Set(visible.map((item) => item.id));
  return {
    sheetId,
    jobId: access.sheet.jobId,
    actor: { id: access.actor.id, name: access.actor.name },
    canManage: access.actor.canManage,
    canAnnotate: access.canAnnotate,
    documentSource: Boolean(access.sheet.documentVersionId),
    entities: visible,
    metadata: data,
    members: people,
    jobSheets: sheets,
    favorite: !!starred.length,
    watching: !!watched.length,
    activity: events
      .map((row) => row.entry)
      .filter((entry) => !entry.entityId || ids.has(entry.entityId))
      .slice(0, 200),
  };
}
export async function listDrawingWorkspace(
  ctx: DrawingContext,
  jobId: string,
): Promise<DrawingSheetSummary[]> {
  const [user, rows] = await Promise.all([
    freshUser(ctx.db, ctx.userId),
    ctx.db
      .select({ id: jobs.id, organizationId: jobs.organizationId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1),
  ]);
  const job = rows[0] as { id: string; organizationId: string } | undefined;
  if (!job) throw new TRPCError({ code: "NOT_FOUND" });
  const actor = drawingActor(user, job.organizationId);
  const sheets = await jobSheets(ctx.db, jobId, actor.organizationId);
  const ids = sheets.map((sheet) => sheet.id);
  if (!ids.length) return [];
  const [data, stars, counts, watched] = await Promise.all([
    ctx.db.select().from(metadata).where(inArray(metadata.sheetId, ids)),
    ctx.db
      .select()
      .from(favorites)
      .where(
        and(inArray(favorites.sheetId, ids), eq(favorites.userId, actor.id)),
      ),
    ctx.db
      .select({
        sheetId: entities.sheetId,
        markupCount: sql<number>`count(*) filter (where entity->>'kind' = 'markup')::int`,
        issueCount: sql<number>`count(*) filter (where entity->>'kind' = 'issue' and entity->'data'->>'status' <> 'closed')::int`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.jobId, jobId),
          eq(entities.organizationId, actor.organizationId),
          sql`entity->>'visibility' <> 'archived' and (entity->>'visibility' = 'published' or entity->>'authorId' = ${actor.id})`,
        ),
      )
      .groupBy(entities.sheetId),
    ctx.db
      .select()
      .from(watches)
      .where(and(inArray(watches.sheetId, ids), eq(watches.userId, actor.id))),
  ]);
  const metadataById = new Map(data.map((row) => [row.sheetId, row.data]));
  const favoriteIds = new Set(stars.map((row) => row.sheetId));
  const watchedIds = new Set(watched.map((row) => row.sheetId));
  const countsById = new Map(counts.map((row) => [row.sheetId, row]));
  return sheets.map((sheet) => ({
    sheetId: sheet.id,
    metadata: metadataById.get(sheet.id) ?? defaultDrawingMetadata(sheet.id),
    favorite: favoriteIds.has(sheet.id),
    watching: watchedIds.has(sheet.id),
    issueCount: countsById.get(sheet.id)?.issueCount ?? 0,
    markupCount: countsById.get(sheet.id)?.markupCount ?? 0,
  }));
}
export async function saveDrawingEntity(
  ctx: DrawingContext,
  input: DrawingSave,
) {
  if (input.kind === "markup" && input.data.equipmentTag && input.data.links) {
    input = {
      ...input,
      data: { ...input.data, links: input.data.links.map(withoutTagHighlight) },
    };
  }
  if (input.expectedUserId && input.expectedUserId !== ctx.userId)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The signed-in account changed. Reopen the drawing before syncing edits.",
    });
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    const [items, sheets, people, current] = await Promise.all([
      sheetEntities(tx, input.sheetId),
      jobSheets(
        tx,
        access.sheet.jobId,
        access.actor.organizationId,
        access.sheet.documentVersionId,
      ),
      members(tx, access.actor.organizationId),
      sheetMetadata(tx, input.sheetId),
    ]);
    const existing = items.find((item) => item.id === input.id) ?? null;
    // Generated relationships are server-owned; clients cannot attach annotations to another origin.
    if (
      input.kind === "markup" &&
      (input.data.equipmentOriginId ||
        (existing?.kind === "markup" && existing.data.equipmentOriginId))
    ) {
      const originId =
        existing?.kind === "markup"
          ? existing.data.equipmentOriginId
          : undefined;
      input.data = { ...input.data };
      if (originId) input.data.equipmentOriginId = originId;
      else delete input.data.equipmentOriginId;
    }
    // An offline request can commit while its response is lost. A replay may
    // acknowledge only this account's exact immediately-following queued edit.
    // Changed data, visibility, later revisions and other authors still conflict.
    if (existing && isQueuedDrawingReplay(input, existing, access.actor))
      return existing;
    if (input.kind === "version" || input.kind === "review")
      assertRevision(current.revision, input.expectedMetadataRevision);
    const entity = prepareEntity(
      input,
      existing,
      access.actor,
      sheets,
      people.map((person) => person.id),
      new Date().toISOString(),
    );
    await validateLinks(tx, input, access, sheets);
    const sourceSheetId =
      "sourceSheetId" in input.data ? input.data.sourceSheetId : null;
    if (
      sourceSheetId &&
      input.kind !== "version" &&
      sourceSheetId !== input.sheetId &&
      !items.some(
        (item) =>
          item.kind === "version" && item.data.sourceSheetId === sourceSheetId,
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This source is not a revision of the selected drawing.",
      });
    if (input.kind === "review" && input.data.status !== "pending") {
      const request = items.find((item) => item.id === input.data.requestId);
      if (
        !access.actor.canManage &&
        (!request ||
          request.kind !== "review" ||
          request.data.status !== "pending" ||
          request.data.sourceSheetId !== input.data.sourceSheetId ||
          request.data.reviewerId !== access.actor.id ||
          input.data.reviewerId !== access.actor.id)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only the assigned reviewer or a drawing manager can decide this review.",
        });
      if (
        input.data.requestId &&
        (!request ||
          request.kind !== "review" ||
          request.data.status !== "pending" ||
          request.data.sourceSheetId !== input.data.sourceSheetId)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Review request does not match this drawing revision.",
        });
      if (
        input.data.requestId &&
        items.some(
          (item) =>
            item.kind === "review" &&
            item.data.status !== "pending" &&
            item.data.requestId === input.data.requestId,
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This review request has already been decided.",
        });
    }
    if (
      input.kind === "review" &&
      input.data.sourceSheetId !== current.currentSourceSheetId
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only the current drawing revision can be reviewed.",
      });
    if (input.kind === "version") {
      if (
        input.data.sourceSheetId === input.sheetId ||
        items.some(
          (item) =>
            item.kind === "version" &&
            item.data.sourceSheetId === input.data.sourceSheetId,
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This drawing is already in the revision history.",
        });
      const prior = sheets.find((s) => s.id === current.currentSourceSheetId),
        next = sheets.find((s) => s.id === input.data.sourceSheetId);
      const before = prior
          ? await revisionEvidence(prior.imageUrl, access.sheet.jobId)
          : null,
        after = next
          ? await revisionEvidence(next.imageUrl, access.sheet.jobId)
          : null;
      const calibration = compatibleRevisionScale(
        current.scale,
        before?.scale ?? null,
        after?.scale ?? null,
        before?.linework ?? null,
        after?.linework ?? null,
      );
      await revisionImpactFlags(
        tx,
        access.actor,
        access.sheet,
        current.currentSourceSheetId,
        input.data.sourceSheetId,
        items,
        sheets,
      );
      await writeMetadata(tx, input.sheetId, {
        ...current,
        revision: current.revision + 1,
        currentSourceSheetId: input.data.sourceSheetId,
        status: "draft",
        scale: calibration.preserve ? current.scale : null,
      });
    }
    if (input.kind === "version")
      await tx
        .update(jobDrawingSets)
        .set({ updatedAt: new Date() })
        .where(eq(jobDrawingSets.id, access.sheet.setId));
    if (input.kind === "review")
      await writeMetadata(tx, input.sheetId, {
        ...current,
        revision: current.revision + 1,
        status:
          input.data.status === "approved"
            ? "approved"
            : input.data.status === "pending"
              ? "for_review"
              : "draft",
      });
    await persistEntity(
      tx,
      access.sheet,
      entity,
      input.expectedRevision,
      items,
    );
    await record(
      tx,
      input.sheetId,
      access.actor,
      existing ? "updated" : "created",
      entity.id,
    );
    if (!access.sheet.documentVersionId)
      await enqueueDrawingNotifications(tx, {
        sheetId: input.sheetId,
        organizationId: access.actor.organizationId,
        senderId: access.actor.id,
        entity,
      });
    if (
      (entity.kind === "markup" && entity.data.equipmentTag) ||
      (existing?.kind === "markup" && existing.data.equipmentTag)
    )
      await syncEquipmentAnnotations(
        tx,
        access,
        entity,
        sheets,
        people.map((p) => p.id),
      );
    return entity;
  });
}
async function syncEquipmentAnnotations(
  tx: Transaction,
  access: Awaited<ReturnType<typeof accessSheet>>,
  entity: DrawingEntity,
  sheets: DrawingJobSheet[],
  memberIds: string[],
) {
  if (entity.kind !== "markup" || entity.data.equipmentOriginId) return;
  const plan = await equipmentAnnotationPlan(
    entity,
    access.sheet.jobId,
    sheets,
    async (sheetId) => {
      const target = await accessSheet(tx, access.actor.id, sheetId);
      if (!target.canAnnotate)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A linked drawing is read only.",
        });
      return (await sheetMetadata(tx, sheetId)).currentSourceSheetId;
    },
  );
  const prior = await tx
    .select({ entity: entities.entity })
    .from(entities)
    .where(
      and(
        eq(entities.jobId, access.sheet.jobId),
        sql`entity->'data'->>'equipmentOriginId' = ${entity.id}`,
      ),
    );
  for (const item of plan) {
    const active = prior
      .map((p) => p.entity)
      .find(
        (e) =>
          e.visibility !== "archived" &&
          e.kind === "markup" &&
          e.sheetId === item.sheetId &&
          e.data.sourceSheetId === item.sourceSheetId &&
          JSON.stringify(e.data.points) === JSON.stringify(item.points),
      );
    if (active) item.id = active.id;
    else if (prior.some((p) => p.entity.id === item.id)) item.id = randomUUID();
  }
  const wanted = new Set(plan.map((p) => p.id));
  const now = new Date().toISOString();
  for (const { entity: old } of prior) {
    if (wanted.has(old.id) || old.visibility === "archived") continue;
    const target = await accessSheet(tx, access.actor.id, old.sheetId);
    const items = await sheetEntities(tx, old.sheetId);
    const archived = archiveEntity(old, access.actor, old.revision, now);
    await persistEntity(tx, target.sheet, archived, old.revision, items);
    await record(tx, old.sheetId, access.actor, "archived", old.id);
  }
  for (const item of plan) {
    const target = await accessSheet(tx, access.actor.id, item.sheetId);
    const items = await sheetEntities(tx, item.sheetId);
    const old = items.find((e) => e.id === item.id) ?? null;
    const data = {
      ...entity.data,
      sourceSheetId: item.sourceSheetId,
      points: item.points,
      links: item.links,
      href: undefined,
      targetSheetId: undefined,
      equipmentOriginId: entity.id,
      linkAppearance: "box" as const,
    };
    if (
      old?.visibility === entity.visibility &&
      JSON.stringify(old.data) === JSON.stringify(data)
    )
      continue;
    const input: DrawingSave = {
      kind: "markup",
      id: item.id,
      sheetId: item.sheetId,
      expectedRevision: old?.revision ?? 0,
      visibility: entity.visibility,
      data,
    };
    await validateLinks(tx, input, target, sheets);
    const next = prepareEntity(
      input,
      old,
      access.actor,
      sheets,
      memberIds,
      now,
    );
    await persistEntity(tx, target.sheet, next, input.expectedRevision, items);
    await record(
      tx,
      item.sheetId,
      access.actor,
      old ? "updated" : "created",
      item.id,
    );
  }
}
export async function archiveDrawingEntity(
  ctx: DrawingContext,
  input: { sheetId: string; id: string; expectedRevision: number },
) {
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    const items = await sheetEntities(tx, input.sheetId);
    const entity = archiveEntity(
      entityById(items, input.id, access.actor),
      access.actor,
      input.expectedRevision,
      new Date().toISOString(),
    );
    await persistEntity(
      tx,
      access.sheet,
      entity,
      input.expectedRevision,
      items,
    );
    await record(tx, input.sheetId, access.actor, "archived", entity.id);
    if (!access.sheet.documentVersionId)
      await enqueueDrawingNotifications(tx, {
        sheetId: input.sheetId,
        organizationId: access.actor.organizationId,
        senderId: access.actor.id,
        entity,
      });
    if (entity.kind === "markup" && entity.data.equipmentTag)
      await syncEquipmentAnnotations(tx, access, entity, [], []);
    return entity;
  });
}
export async function commentDrawingEntity(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    id: string;
    expectedRevision: number;
    body: string;
  },
) {
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    const items = await sheetEntities(tx, input.sheetId);
    const entity = addEntityComment(
      entityById(items, input.id, access.actor),
      access.actor,
      input.expectedRevision,
      input.body,
      randomUUID(),
      new Date().toISOString(),
    );
    await persistEntity(
      tx,
      access.sheet,
      entity,
      input.expectedRevision,
      items,
    );
    await record(tx, input.sheetId, access.actor, "commented", entity.id);
    if (!access.sheet.documentVersionId)
      await enqueueDrawingNotifications(tx, {
        sheetId: input.sheetId,
        organizationId: access.actor.organizationId,
        senderId: access.actor.id,
        entity,
      });
    return entity;
  });
}
export async function saveDrawingMetadata(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    expectedRevision: number;
    data: z.infer<typeof drawingMetadataSchema>;
  },
) {
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    assertDrawingManager(access.actor);
    const current = await sheetMetadata(tx, input.sheetId);
    assertRevision(current.revision, input.expectedRevision);
    const data = {
      ...input.data,
      revision: current.revision + 1,
      currentSourceSheetId: current.currentSourceSheetId,
    };
    await writeMetadata(tx, input.sheetId, data);
    await record(tx, input.sheetId, access.actor, "metadata_updated", null);
    return data;
  });
}
export async function setDrawingCurrentVersion(
  ctx: DrawingContext,
  input: { sheetId: string; sourceSheetId: string; expectedRevision: number },
) {
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    assertDrawingManager(access.actor);
    const current = await sheetMetadata(tx, input.sheetId);
    assertRevision(current.revision, input.expectedRevision);
    const items = await sheetEntities(tx, input.sheetId);
    const sheets = await jobSheets(
      tx,
      access.sheet.jobId,
      access.actor.organizationId,
      access.sheet.documentVersionId,
    );
    requireSource(sheets, input.sourceSheetId);
    if (
      input.sourceSheetId !== input.sheetId &&
      !items.some(
        (item) =>
          item.kind === "version" &&
          item.data.sourceSheetId === input.sourceSheetId,
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose an existing revision of this drawing.",
      });
    if (current.currentSourceSheetId === input.sourceSheetId) return current;
    const prior = sheets.find((s) => s.id === current.currentSourceSheetId),
      next = sheets.find((s) => s.id === input.sourceSheetId);
    const before = prior
        ? await revisionEvidence(prior.imageUrl, access.sheet.jobId)
        : null,
      after = next
        ? await revisionEvidence(next.imageUrl, access.sheet.jobId)
        : null;
    const calibration = compatibleRevisionScale(
      current.scale,
      before?.scale ?? null,
      after?.scale ?? null,
      before?.linework ?? null,
      after?.linework ?? null,
    );
    await revisionImpactFlags(
      tx,
      access.actor,
      access.sheet,
      current.currentSourceSheetId,
      input.sourceSheetId,
      items,
      sheets,
    );
    const data: DrawingMetadata = {
      ...current,
      revision: current.revision + 1,
      currentSourceSheetId: input.sourceSheetId,
      status: "draft",
      scale: calibration.preserve ? current.scale : null,
    };
    await writeMetadata(tx, input.sheetId, data);
    await tx
      .update(jobDrawingSets)
      .set({ updatedAt: new Date() })
      .where(eq(jobDrawingSets.id, access.sheet.setId));
    await record(
      tx,
      input.sheetId,
      access.actor,
      "current_revision_changed",
      null,
    );
    return data;
  });
}
export async function favoriteDrawing(
  ctx: DrawingContext,
  input: { sheetId: string; favorite: boolean },
) {
  return withSheet(ctx, input.sheetId, async (tx) => {
    if (input.favorite)
      await tx
        .insert(favorites)
        .values({ sheetId: input.sheetId, userId: ctx.userId })
        .onConflictDoNothing();
    else
      await tx
        .delete(favorites)
        .where(
          and(
            eq(favorites.sheetId, input.sheetId),
            eq(favorites.userId, ctx.userId),
          ),
        );
    return { favorite: input.favorite };
  });
}
/** Called by legacy drawing deletion APIs so source/version relationships survive. */
export async function assertSheetsNotReferenced(
  reader: Reader,
  sheetIds: string[],
) {
  if (!sheetIds.length) return;
  const refs = await reader
    .select({ id: entities.id })
    .from(entities)
    .where(
      sql`not (${inArray(entities.sheetId, sheetIds)}) and (entity->'data'->>'sourceSheetId' in (${sql.join(
        sheetIds.map((id) => sql`${id}`),
        sql`, `,
      )}) or entity->'data'->>'targetSheetId' in (${sql.join(
        sheetIds.map((id) => sql`${id}`),
        sql`, `,
      )}) or exists (select 1 from jsonb_array_elements(coalesce(entity->'data'->'links', '[]'::jsonb)) l where l->>'targetSheetId' in (${sql.join(
        sheetIds.map((id) => sql`${id}`),
        sql`, `,
      )})) or exists (select 1 from jsonb_array_elements(coalesce(entity->'snapshots', '[]'::jsonb)) s where s->>'sheetId' in (${sql.join(
        sheetIds.map((id) => sql`${id}`),
        sql`, `,
      )})))`,
    )
    .limit(1);
  if (refs.length)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This drawing is referenced by another drawing's revision history or links. Keep the source sheet to preserve those records.",
    });
}

export async function watchDrawing(
  ctx: DrawingContext,
  input: { sheetId: string; watching: boolean },
) {
  return withSheet(ctx, input.sheetId, async (tx) => {
    if (input.watching)
      await tx
        .insert(watches)
        .values({ sheetId: input.sheetId, userId: ctx.userId })
        .onConflictDoNothing();
    else
      await tx
        .delete(watches)
        .where(
          and(
            eq(watches.sheetId, input.sheetId),
            eq(watches.userId, ctx.userId),
          ),
        );
    return { watching: input.watching };
  });
}

/** Review a split revision PDF without changing any current drawing. */
export async function reviewDrawingRevisionUpload(
  ctx: DrawingContext,
  uploadedSetId: string,
) {
  const [set] = await ctx.db
    .select()
    .from(jobDrawingSets)
    .where(eq(jobDrawingSets.id, uploadedSetId))
    .limit(1);
  if (!set || set.documentVersionId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing folder not found.",
    });
  const actor = drawingActor(
    await freshUser(ctx.db, ctx.userId),
    set.organizationId,
  );
  assertDrawingManager(actor);
  const sheets = await jobSheets(ctx.db, set.jobId, actor.organizationId);
  const ids = sheets.map((s) => s.id);
  const data = ids.length
    ? await ctx.db.select().from(metadata).where(inArray(metadata.sheetId, ids))
    : [];
  const metas = new Map(data.map((row) => [row.sheetId, row.data]));
  const versions = await ctx.db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.jobId, set.jobId),
        eq(entities.organizationId, actor.organizationId),
        sql`entity->>'kind' = 'version'`,
      ),
    );
  const used = new Map(
    versions.flatMap((row) =>
      row.entity.kind === "version"
        ? [[row.entity.data.sourceSheetId, row.sheetId] as const]
        : [],
    ),
  );
  const incoming = sheets
    .filter((s) => s.setId === uploadedSetId)
    .map((s) => ({
      ...s,
      metadata: metas.get(s.id) ?? defaultDrawingMetadata(s.id),
    }));
  const targets = sheets
    .filter((s) => s.setId !== uploadedSetId && !used.has(s.id))
    .map((s) => ({
      ...s,
      metadata: metas.get(s.id) ?? defaultDrawingMetadata(s.id),
    }));
  const proposals = proposeDrawingRevisions(incoming, targets);
  const evidenceSheets = proposals.flatMap((row) => {
    const target = targets.find((t) => t.id === row.targetId),
      source = incoming.find((s) => s.id === row.sourceId);
    const current = sheets.find(
      (s) => s.id === target?.metadata.currentSourceSheetId,
    );
    return target && source && current ? [source, current] : [];
  });
  await prepareRevisionEvidence(evidenceSheets, set.jobId);
  const rows = [];
  for (const row of proposals) {
    const source = incoming.find((s) => s.id === row.sourceId)!;
    const target = targets.find((t) => t.id === row.targetId);
    const current = sheets.find(
      (s) => s.id === target?.metadata.currentSourceSheetId,
    );
    const before = current
      ? await revisionEvidence(current.imageUrl, set.jobId)
      : null;
    const after = await revisionEvidence(source.imageUrl, set.jobId);
    const calibration = compatibleRevisionScale(
      target?.metadata.scale ?? null,
      before?.scale ?? null,
      after.scale,
      before?.linework ?? null,
      after.linework,
    );
    rows.push({
      ...row,
      sourceName: source.name,
      sourceRevision: source.metadata.revision,
      alreadyAttached: used.has(source.id),
      calibration,
    });
  }
  return {
    jobId: set.jobId,
    uploadedSetId,
    rows,
    targets: targets.map((t) => ({
      id: t.id,
      name: t.name,
      setName: t.setName,
      revision: t.metadata.revision,
      hasScale: !!t.metadata.scale,
    })),
  };
}

export async function applyDrawingRevisionUpload(
  ctx: DrawingContext,
  input: {
    uploadedSetId: string;
    label: string;
    rows: Array<{
      sourceId: string;
      sourceRevision: number;
      targetId: string | null;
      expectedRevision?: number;
    }>;
  },
) {
  // Validate permission and folder ownership before acquiring mutation locks.
  const [set] = await ctx.db
    .select()
    .from(jobDrawingSets)
    .where(eq(jobDrawingSets.id, input.uploadedSetId))
    .limit(1);
  if (!set || set.documentVersionId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing folder not found.",
    });
  assertDrawingManager(
    drawingActor(await freshUser(ctx.db, ctx.userId), set.organizationId),
  );
  const available = await jobSheets(ctx.db, set.jobId, set.organizationId);
  const evidenceSources = [];
  for (const row of input.rows) {
    if (!row.targetId) continue;
    const target = available.find(
      (s) => s.id === row.targetId && s.setId !== set.id,
    );
    const source = available.find(
      (s) => s.id === row.sourceId && s.setId === set.id,
    );
    if (!target || !source)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose drawings in this job.",
      });
    const current = await sheetMetadata(ctx.db, target.id);
    const prior = available.find((s) => s.id === current.currentSourceSheetId);
    if (prior) evidenceSources.push(prior, source);
  }
  await prepareRevisionEvidence(evidenceSources, set.jobId);
  const lockIds = [
    ...new Set(
      input.rows.flatMap((r) => [
        r.sourceId,
        ...(r.targetId ? [r.targetId] : []),
      ]),
    ),
  ].sort();
  return ctx.db.transaction(async (tx) => {
    for (const id of lockIds)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${id},4150))`,
      );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${set.jobId},4151))`,
    );
    const [folder] = await tx
      .select()
      .from(jobDrawingSets)
      .where(
        and(
          eq(jobDrawingSets.id, set.id),
          eq(jobDrawingSets.organizationId, set.organizationId),
        ),
      )
      .for("key share");
    if (!folder)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The uploaded folder changed. Review again.",
      });
    const actor = drawingActor(
      await freshUser(tx, ctx.userId),
      set.organizationId,
    );
    assertDrawingManager(actor);
    const sheets = await jobSheets(tx, set.jobId, actor.organizationId);
    const sources = new Set<string>(),
      targets = new Set<string>();
    const result: {
      revised: string[];
      newSheets: string[];
      calibrationRetained: string[];
      needsCalibration: string[];
      impactCount: number;
    } = {
      revised: [],
      newSheets: [],
      calibrationRetained: [],
      needsCalibration: [],
      impactCount: 0,
    };
    const versions = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.jobId, set.jobId),
          eq(entities.organizationId, actor.organizationId),
          sql`entity->>'kind' = 'version'`,
        ),
      );
    const used = new Set(
      versions.flatMap((row) =>
        row.entity.kind === "version" ? [row.entity.data.sourceSheetId] : [],
      ),
    );
    for (const row of input.rows) {
      const source = sheets.find(
        (s) => s.id === row.sourceId && s.setId === set.id,
      );
      if (!source || sources.has(row.sourceId) || used.has(row.sourceId))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "An uploaded sheet changed or is already attached. Review again.",
        });
      sources.add(row.sourceId);
      const sourceMeta = await sheetMetadata(tx, row.sourceId);
      assertRevision(sourceMeta.revision, row.sourceRevision);
      if (!row.targetId) {
        result.newSheets.push(source.name);
        continue;
      }
      const target = sheets.find(
        (s) => s.id === row.targetId && s.setId !== set.id && !used.has(s.id),
      );
      if (!target || targets.has(target.id))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose each existing drawing only once.",
        });
      targets.add(target.id);
      await tx
        .select({ id: jobDrawingSheets.id })
        .from(jobDrawingSheets)
        .where(inArray(jobDrawingSheets.id, [source.id, target.id]))
        .for("key share");
      const current = await sheetMetadata(tx, target.id);
      assertRevision(current.revision, row.expectedRevision ?? -1);
      const items = await sheetEntities(tx, target.id);
      const beforeSheet = sheets.find(
        (s) => s.id === current.currentSourceSheetId,
      );
      const before = beforeSheet
          ? await revisionEvidence(beforeSheet.imageUrl, set.jobId)
          : null,
        after = await revisionEvidence(source.imageUrl, set.jobId);
      const calibration = compatibleRevisionScale(
        current.scale,
        before?.scale ?? null,
        after.scale,
        before?.linework ?? null,
        after.linework,
      );
      const entity = prepareEntity(
        {
          kind: "version",
          sheetId: target.id,
          id: randomUUID(),
          expectedRevision: 0,
          expectedMetadataRevision: current.revision,
          visibility: "published",
          data: {
            sourceSheetId: source.id,
            label: input.label,
            description: `Bulk revised PDF import. ${calibration.reason}`,
          },
        },
        null,
        actor,
        sheets,
        [],
        new Date().toISOString(),
      );
      await persistEntity(
        tx,
        { id: target.id, jobId: set.jobId, organizationId: set.organizationId },
        entity,
        0,
        items,
      );
      await writeMetadata(tx, target.id, {
        ...current,
        currentSourceSheetId: source.id,
        revision: current.revision + 1,
        status: "draft",
        scale: calibration.preserve ? current.scale : null,
      });
      result.impactCount += await revisionImpactFlags(
        tx,
        actor,
        { id: target.id, jobId: set.jobId, organizationId: set.organizationId },
        current.currentSourceSheetId,
        source.id,
        items,
        sheets,
      );
      await tx
        .update(jobDrawingSets)
        .set({ updatedAt: new Date() })
        .where(eq(jobDrawingSets.id, target.setId));
      await record(
        tx,
        target.id,
        actor,
        "revision_uploaded_and_made_current",
        entity.id,
      );
      await enqueueDrawingNotifications(tx, {
        sheetId: target.id,
        organizationId: actor.organizationId,
        senderId: actor.id,
        entity,
      });
      result.revised.push(target.name);
      (calibration.preserve
        ? result.calibrationRetained
        : result.needsCalibration
      ).push(target.name);
    }
    return result;
  });
}

async function revisionImpactFlags(
  tx: Transaction,
  actor: DrawingActor,
  sheet: { id: string; jobId: string; organizationId: string },
  previous: string,
  next: string,
  items: DrawingEntity[],
  sheets: DrawingJobSheet[],
) {
  const beforeSheet = sheets.find((s) => s.id === previous),
    afterSheet = sheets.find((s) => s.id === next);
  const before = beforeSheet
      ? await revisionEvidence(beforeSheet.imageUrl, sheet.jobId)
      : null,
    after = afterSheet
      ? await revisionEvidence(afterSheet.imageUrl, sheet.jobId)
      : null;
  const changes = revisionChangedRegions(
    before?.scale ?? null,
    after?.scale ?? null,
    before?.linework ?? null,
    after?.linework ?? null,
  );
  const markups = items.filter(
    (e): e is Extract<DrawingEntity, { kind: "markup" }> =>
      e.kind === "markup" &&
      e.visibility !== "archived" &&
      e.data.sourceSheetId === previous &&
      canReadEntity(e, actor),
  );
  const impacts: Array<{
    id: string;
    kind: "markup" | "takeoff" | "summary";
    name: string;
    points: Array<{ x: number; y: number }>;
    private: boolean;
  }> = markups
    .filter(
      (e) =>
        !changes.aligned || nearRevisionChanges(e.data.points, changes.regions),
    )
    .map((e) => ({
      id: e.id,
      kind: "markup",
      name: e.data.text ?? e.data.type,
      points: e.data.points,
      private: e.visibility === "private",
    }));
  const user = await freshUser(tx, actor.id);
  if (
    user &&
    userCan(user, "tab.estimating") &&
    userCan(user, "financial.view")
  ) {
    const rows = await tx
      .select()
      .from(estimates)
      .where(
        and(
          eq(estimates.organizationId, sheet.organizationId),
          eq(estimates.jobId, sheet.jobId),
        ),
      );
    for (const estimate of rows)
      for (const line of estimate.document.lines) {
        if (line.source.sheetId !== sheet.id) continue;
        const markup = markups.find((m) => m.id === line.source.markupId),
          points = markup?.data.points ?? [];
        if (
          !changes.aligned ||
          !points.length ||
          nearRevisionChanges(points, changes.regions)
        )
          impacts.push({
            id: `${estimate.id}:${line.id}`,
            kind: "takeoff",
            name: `${estimate.name}: ${line.description}`,
            points,
            private: true,
          });
      }
  }
  if (impacts.length > 200) {
    impacts.splice(199);
    impacts.push({
      id: "remaining-impacts",
      kind: "summary",
      name: "Additional items need review; this drawing has more than 200 potentially affected items.",
      points: [],
      private: true,
    });
  }
  const persisted = [...items];
  for (const impact of impacts) {
    const point = impact.points.length
      ? {
          x: impact.points.reduce((v, p) => v + p.x, 0) / impact.points.length,
          y: impact.points.reduce((v, p) => v + p.y, 0) / impact.points.length,
        }
      : { x: 0.5, y: 0.5 };
    const entity = prepareEntity(
      {
        kind: "issue",
        sheetId: sheet.id,
        id: randomUUID(),
        expectedRevision: 0,
        visibility: impact.private ? "private" : "published",
        data: {
          sourceSheetId: next,
          type: "issue",
          point,
          title: `Needs review: ${impact.name}`.slice(0, 255),
          body:
            changes.aligned && impact.points.length
              ? "Possible impact: revised drawing content changed near this item. Compare the old and new revisions, then mark reviewed. Quantities and annotations have not been changed."
              : "Possible impact: alignment or this item's location could not be verified. Review the before/after drawings; this is not a confirmed overlap or error. Quantities and annotations have not been changed.",
          status: "open",
          assigneeId: actor.id,
          dueDate: null,
          links: [],
          revisionImpact: {
            previousSourceSheetId: previous,
            affectedId: impact.id,
            affectedKind: impact.kind,
            alignmentVerified: changes.aligned && !!impact.points.length,
          },
        },
      },
      null,
      actor,
      sheets,
      [actor.id],
      new Date().toISOString(),
    );
    await persistEntity(tx, sheet, entity, 0, persisted);
    persisted.push(entity);
    await record(
      tx,
      sheet.id,
      actor,
      "possible_revision_impact_flagged",
      entity.id,
    );
  }
  return impacts.length;
}
