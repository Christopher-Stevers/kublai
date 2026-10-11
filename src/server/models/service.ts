import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { db } from "~/server/db";
import {
  bimModels,
  bimViews,
  bimIssues,
  bimActivity,
} from "~/server/db/bim-schema";
import { users } from "~/server/chat/tables";
import { userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type {
  BimModel,
  BimIssue,
  BimIssueData,
  BimSavedView,
  BimViewState,
  BimWorkspace,
  ModelUploadMetadata,
} from "~/lib/bim/types";
import { requireModelUpload, type ModelAccess } from "./access";
import { canConfigureAutodesk } from "./connection";
import { nativeConversionAvailable } from "./native-conversion";
import {
  isNativeRevitPreview,
  nativeViewRestriction,
} from "~/lib/bim/native-conversion";
export const modelScope = (a: ModelAccess) =>
  and(
    eq(bimModels.organizationId, a.job.organizationId),
    eq(bimModels.jobId, a.job.id),
  );
type Writer = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function audit(
  tx: Writer,
  a: ModelAccess,
  entityId: string,
  action: string,
  data: unknown,
) {
  await tx.insert(bimActivity).values({
    organizationId: a.job.organizationId,
    jobId: a.job.id,
    actorId: a.user.id,
    entityId,
    action,
    data,
  });
}
async function lock(tx: Writer, a: ModelAccess) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`bim:${a.job.organizationId}:${a.job.id}`},0))`,
  );
}
export async function readModel(
  a: ModelAccess,
  id: string,
  reader: Pick<typeof db, "select"> = db,
) {
  const [m] = await reader
    .select()
    .from(bimModels)
    .where(and(modelScope(a), eq(bimModels.id, id)))
    .limit(1);
  if (!m)
    throw new TRPCError({ code: "NOT_FOUND", message: "Model not found." });
  return m;
}
export async function modelMembers(a: ModelAccess) {
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, a.job.organizationId),
        eq(users.organizationAccessStatus, "approved"),
      ),
    );
  return (rows as RequestUser[])
    .filter((u) => userCan(u, "tab.dashboard") && userCan(u, "drawings.view"))
    .map((u) => ({ id: u.id, name: u.name ?? u.email }));
}
export async function modelWorkspace(a: ModelAccess): Promise<BimWorkspace> {
  const [models, views, issues, members] = await Promise.all([
    db
      .select()
      .from(bimModels)
      .where(modelScope(a))
      .orderBy(desc(bimModels.createdAt)),
    db
      .select()
      .from(bimViews)
      .where(
        and(
          eq(bimViews.organizationId, a.job.organizationId),
          eq(bimViews.jobId, a.job.id),
        ),
      ),
    db
      .select()
      .from(bimIssues)
      .where(
        and(
          eq(bimIssues.organizationId, a.job.organizationId),
          eq(bimIssues.jobId, a.job.id),
        ),
      ),
    modelMembers(a),
  ]);
  return {
    job: { id: a.job.id, name: a.job.name },
    userId: a.user.id,
    canUpload: a.canUpload,
    canDelete: a.canDelete,
    conversionAvailable: await nativeConversionAvailable(),
    canConfigureAutodesk: canConfigureAutodesk(a),
    models: models.map((m) => m.data),
    views: views.map((v) => v.data),
    issues: issues
      .map((i) => i.data)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    members,
  };
}
export async function registerModel(
  a: ModelAccess,
  id: string,
  input: { metadata: ModelUploadMetadata; sha: string; format: "ifc" | "rvt" },
) {
  requireModelUpload(a);
  return db.transaction(async (tx) => {
    await lock(tx, a);
    const [replay] = await tx
      .select()
      .from(bimModels)
      .where(and(modelScope(a), eq(bimModels.id, id)));
    if (replay) return replay.data;
    const { metadata, sha, format } = input;
    let version = 1;
    const seriesId = metadata.seriesId ?? randomUUID();
    if (metadata.seriesId) {
      const [last] = await tx
        .select()
        .from(bimModels)
        .where(and(modelScope(a), eq(bimModels.seriesId, seriesId)))
        .orderBy(desc(bimModels.version))
        .limit(1);
      if (!last)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Model series not found.",
        });
      if (metadata.expectedModelId !== last.id)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A newer revision was uploaded. Refresh before uploading this revision.",
        });
      version = last.version + 1;
    }
    const model: BimModel = {
      id,
      seriesId,
      version,
      name: metadata.name,
      discipline: metadata.discipline,
      filename: metadata.filename,
      format,
      size: metadata.size,
      status: format === "ifc" ? "ready" : "awaiting_conversion",
      publication: "coordination",
      conversionMessage: null,
      uploadedBy: a.user.name ?? "Team member",
      createdAt: new Date().toISOString(),
    };
    await tx.insert(bimModels).values({
      id,
      organizationId: a.job.organizationId,
      jobId: a.job.id,
      seriesId,
      version,
      data: model,
      sourceSha: sha,
      viewSha: format === "ifc" ? sha : null,
    });
    await audit(tx, a, id, "model.uploaded", { model, sha });
    return model;
  });
}
export async function setModelPublication(
  a: ModelAccess,
  id: string,
  publication: BimModel["publication"],
) {
  requireModelUpload(a);
  if (publication === "archived" && !a.canDelete)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing delete permission is required to archive models.",
    });
  return db.transaction(async (tx) => {
    await lock(tx, a);
    const m = await readModel(a, id, tx);
    if (
      publication === "construction" &&
      (isNativeRevitPreview(m.data) || m.data.status !== "ready")
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Experimental or unconverted models cannot be issued for construction. Use a verified IFC export.",
      });
    const data = { ...m.data, publication };
    await tx
      .update(bimModels)
      .set({
        data: sql`${bimModels.data} || ${JSON.stringify({ publication })}::jsonb`,
      })
      .where(and(modelScope(a), eq(bimModels.id, id)));
    await audit(tx, a, id, "model.publication", {
      from: m.data.publication,
      to: publication,
    });
    return data;
  });
}
async function validateView(
  a: ModelAccess,
  view: BimViewState,
  reader: Pick<typeof db, "select">,
) {
  const rows = await reader
    .select({ id: bimModels.id, data: bimModels.data })
    .from(bimModels)
    .where(and(modelScope(a), inArray(bimModels.id, view.modelIds)));
  if (
    new Set(view.modelIds).size !== view.modelIds.length ||
    rows.length !== view.modelIds.length ||
    rows.some((r) => r.data.status !== "ready")
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Every viewpoint model must belong to this job and be ready to view.",
    });
  const restriction = nativeViewRestriction(
    rows.map((r) => r.data),
    view,
  );
  if (restriction)
    throw new TRPCError({ code: "BAD_REQUEST", message: restriction });
  const ids = new Set(view.modelIds);
  for (const key of [...view.hidden, ...view.isolated, ...view.levels])
    if (!ids.has(key.split(":")[0]!))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The viewpoint contains elements from another model.",
      });
}
export async function saveModelView(
  a: ModelAccess,
  name: string,
  view: BimViewState,
) {
  return db.transaction(async (tx) => {
    await validateView(a, view, tx);
    const data: BimSavedView = {
      id: randomUUID(),
      name,
      view,
      authorId: a.user.id,
      authorName: a.user.name ?? "Team member",
      createdAt: new Date().toISOString(),
    };
    await tx.insert(bimViews).values({
      id: data.id,
      organizationId: a.job.organizationId,
      jobId: a.job.id,
      data,
    });
    await audit(tx, a, data.id, "view.saved", data);
    return data;
  });
}
export async function removeModelView(a: ModelAccess, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bimViews)
      .where(
        and(
          eq(bimViews.id, id),
          eq(bimViews.organizationId, a.job.organizationId),
          eq(bimViews.jobId, a.job.id),
        ),
      )
      .for("update");
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.data.authorId !== a.user.id && !a.canUpload)
      throw new TRPCError({ code: "FORBIDDEN" });
    await tx
      .delete(bimViews)
      .where(
        and(
          eq(bimViews.id, id),
          eq(bimViews.organizationId, a.job.organizationId),
          eq(bimViews.jobId, a.job.id),
        ),
      );
    await audit(tx, a, id, "view.removed", { name: row.data.name });
    return { ok: true };
  });
}
export function assertIssueEdit(
  a: Pick<ModelAccess, "user" | "canUpload">,
  old: BimIssue,
  input: BimIssueData,
) {
  if (a.canUpload || old.authorId === a.user.id) return;
  if (old.assigneeId !== a.user.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only the author, assignee or model manager can edit this issue.",
    });
  const {
    status: _oldStatus,
    id: _id,
    revision: _revision,
    authorId: _authorId,
    authorName: _authorName,
    createdAt: _created,
    updatedAt: _updated,
    comments: _comments,
    ...rest
  } = old;
  const { status: _newStatus, ...next } = input;
  if (!isDeepStrictEqual(rest, next))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Assignees can change issue status. Ask the author or a model manager to change its details.",
    });
}
export async function saveModelIssue(
  a: ModelAccess,
  id: string,
  expectedRevision: number,
  input: BimIssueData,
) {
  const members = await modelMembers(a);
  if (input.assigneeId && !members.some((m) => m.id === input.assigneeId))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an approved member with model access.",
    });
  return db.transaction(async (tx) => {
    await lock(tx, a);
    await validateView(a, input.view, tx);
    if (input.element && !input.view.modelIds.includes(input.element.modelId))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The issue element must be in its viewpoint.",
      });
    const [row] = await tx
      .select()
      .from(bimIssues)
      .where(
        and(
          eq(bimIssues.id, id),
          eq(bimIssues.organizationId, a.job.organizationId),
          eq(bimIssues.jobId, a.job.id),
        ),
      );
    if ((row?.revision ?? 0) !== expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This issue changed. Refresh before saving.",
      });
    if (row) assertIssueEdit(a, row.data, input);
    const now = new Date().toISOString();
    const data: BimIssue = {
      ...input,
      id,
      revision: expectedRevision + 1,
      authorId: row?.data.authorId ?? a.user.id,
      authorName: row?.data.authorName ?? a.user.name ?? "Team member",
      createdAt: row?.data.createdAt ?? now,
      updatedAt: now,
      comments: row?.data.comments ?? [],
    };
    if (row)
      await tx
        .update(bimIssues)
        .set({ revision: data.revision, data })
        .where(
          and(
            eq(bimIssues.id, id),
            eq(bimIssues.organizationId, a.job.organizationId),
            eq(bimIssues.jobId, a.job.id),
            eq(bimIssues.revision, expectedRevision),
          ),
        );
    else
      await tx.insert(bimIssues).values({
        id,
        organizationId: a.job.organizationId,
        jobId: a.job.id,
        revision: 1,
        data,
      });
    await audit(tx, a, id, row ? "issue.updated" : "issue.created", data);
    return data;
  });
}
export async function commentModelIssue(
  a: ModelAccess,
  id: string,
  text: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx, a);
    const [row] = await tx
      .select()
      .from(bimIssues)
      .where(
        and(
          eq(bimIssues.id, id),
          eq(bimIssues.organizationId, a.job.organizationId),
          eq(bimIssues.jobId, a.job.id),
        ),
      );
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.data.comments.length >= 1000)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This issue has reached the comment limit.",
      });
    const comment = {
      id: randomUUID(),
      authorId: a.user.id,
      authorName: a.user.name ?? "Team member",
      text,
      createdAt: new Date().toISOString(),
    };
    const data = {
      ...row.data,
      revision: row.revision + 1,
      updatedAt: comment.createdAt,
      comments: [...row.data.comments, comment],
    };
    await tx
      .update(bimIssues)
      .set({ revision: data.revision, data })
      .where(
        and(
          eq(bimIssues.id, id),
          eq(bimIssues.organizationId, a.job.organizationId),
          eq(bimIssues.jobId, a.job.id),
        ),
      );
    await audit(tx, a, id, "issue.comment", comment);
    return data;
  });
}
