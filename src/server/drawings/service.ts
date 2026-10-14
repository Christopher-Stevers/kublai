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
import { jobDrawingSets, jobDrawingSheets, jobDocumentWorkspaces } from "~/server/db/schema";
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
  const actor = drawingActor(user, sheet.organizationId);
  return { actor, sheet, user: user! };
}
async function jobSheets(
  reader: Reader,
  jobId: string,
  organizationId: string,
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
    .leftJoin(jobDrawingSets, and(eq(jobDrawingSets.id, jobDrawingSheets.setId), eq(jobDrawingSets.organizationId, organizationId), eq(jobDrawingSets.jobId, jobId)))
    .where(
      and(
        eq(jobDrawingSheets.jobId, jobId),
        eq(jobDrawingSheets.organizationId, organizationId),
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
    access = await accessSheet(tx, ctx.userId, sheetId);
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
      jobSheets(ctx.db, access.sheet.jobId, access.actor.organizationId),
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
  if (input.expectedUserId && input.expectedUserId !== ctx.userId)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The signed-in account changed. Reopen the drawing before syncing edits.",
    });
  return withSheet(ctx, input.sheetId, async (tx, access) => {
    const [items, sheets, people, current] = await Promise.all([
      sheetEntities(tx, input.sheetId),
      jobSheets(tx, access.sheet.jobId, access.actor.organizationId),
      members(tx, access.actor.organizationId),
      sheetMetadata(tx, input.sheetId),
    ]);
    const existing = items.find((item) => item.id === input.id) ?? null;
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
      await writeMetadata(tx, input.sheetId, {
        ...current,
        revision: current.revision + 1,
        currentSourceSheetId: input.data.sourceSheetId,
        status: "draft",
        scale: null,
      });
    }
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
    await enqueueDrawingNotifications(tx, {
      sheetId: input.sheetId,
      organizationId: access.actor.organizationId,
      senderId: access.actor.id,
      entity,
    });
    return entity;
  });
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
    await enqueueDrawingNotifications(tx, {
      sheetId: input.sheetId,
      organizationId: access.actor.organizationId,
      senderId: access.actor.id,
      entity,
    });
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
    const data: DrawingMetadata = {
      ...current,
      revision: current.revision + 1,
      currentSourceSheetId: input.sourceSheetId,
      status: "draft",
      scale: null,
    };
    await writeMetadata(tx, input.sheetId, data);
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
