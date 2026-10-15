import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import { accessSheet, type DrawingContext } from "./service";
import { jobs } from "~/server/chat/tables";
import type { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import {
  jobDrawingSheets,
  jobDocumentWorkspaces,
  materialLists as legacyMaterialLists,
  jobChatAttachments,
  jobChatMessages,
} from "~/server/db/schema";
import { hasManagingSeat, userCan } from "~/server/auth/permissions";
import { emptyDocumentState, visibleState } from "~/server/documents/domain";
import type { DocumentState } from "~/server/documents/types";
import type {
  DrawingLinkTargets,
  DrawingLinkTarget,
  DrawingLinkTargetKind,
} from "~/lib/drawing-links";

// The legacy material-list table participates in the circular user/job schema.
const materialLists = legacyMaterialLists as unknown as PgTable &
  Record<
    "id" | "name" | "kind" | "jobId" | "organizationId" | "updatedAt",
    AnyPgColumn
  >;

export async function drawingLinkTargets(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    kind: DrawingLinkTargetKind;
    jobId?: string;
    query: string;
  },
): Promise<DrawingLinkTargets> {
  const access = await accessSheet(ctx.db, ctx.userId, input.sheetId);
  const jobId = input.jobId ?? access.sheet.jobId;
  const [choices, selected] = await Promise.all([
    ctx.db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(eq(jobs.organizationId, access.actor.organizationId))
      .orderBy(asc(jobs.name))
      .limit(200),
    ctx.db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.organizationId, access.actor.organizationId),
        ),
      )
      .limit(1),
  ]);
  const job = (selected as { id: string; name: string }[])[0];
  if (!job)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  const jobChoices = choices as { id: string; name: string }[];
  if (!jobChoices.some((item) => item.id === job.id)) jobChoices.push(job);
  const prefix = `/dashboard/jobs/${jobId}`;
  const query = input.query.trim().toLowerCase();
  const pattern = `%${query}%`;
  const targets: DrawingLinkTarget[] = [];
  if (input.kind === "sheet") {
    const rows = await ctx.db
      .select({
        id: jobDrawingSheets.id,
        setId: jobDrawingSheets.setId,
        name: jobDrawingSheets.name,
      })
      .from(jobDrawingSheets)
      .where(
        and(
          eq(jobDrawingSheets.jobId, jobId),
          eq(jobDrawingSheets.organizationId, access.actor.organizationId),
          isNull(jobDrawingSheets.documentVersionId),
          query ? ilike(jobDrawingSheets.name, pattern) : undefined,
        ),
      )
      .orderBy(asc(jobDrawingSheets.sortOrder))
      .limit(100);
    for (const row of rows as { id: string; setId: string; name: string }[])
      targets.push({
        key: row.id,
        label: row.name,
        ...(jobId === access.sheet.jobId && !access.sheet.documentVersionId
          ? { targetSheetId: row.id }
          : {
              url: `${prefix}/drawings?drawingSet=${row.setId}&drawingSheet=${row.id}`,
            }),
      });
  }
  if (input.kind === "document" || input.kind === "photo") {
    const rows = await ctx.db
      .select({ state: jobDocumentWorkspaces.state })
      .from(jobDocumentWorkspaces)
      .where(
        and(
          eq(jobDocumentWorkspaces.jobId, jobId),
          eq(jobDocumentWorkspaces.organizationId, access.actor.organizationId),
        ),
      )
      .limit(1);
    const state =
      (rows as { state: DocumentState }[])[0]?.state ?? emptyDocumentState();
    const visible = visibleState(state, {
      userId: access.actor.id,
      jobId,
      canManage:
        hasManagingSeat(access.user) &&
        userCan(access.user, "documents.manage"),
      canWrite: userCan(access.user, "documents.manage"),
      memberIds: [],
    });
    for (const document of visible.documents.filter(
      (item) => !item.deletedAt,
    )) {
      const version = visible.versions.find(
        (item) => item.id === document.currentVersionId,
      );
      if (input.kind === "photo" && !version?.mimeType.startsWith("image/"))
        continue;
      targets.push({
        key: document.id,
        label: document.name,
        description: version?.mimeType ?? "Document",
        url: `${prefix}/documents?document=${document.id}`,
      });
    }
    if (input.kind === "photo") {
      const photos = await ctx.db
        .select({ id: jobChatAttachments.id, name: jobChatAttachments.name })
        .from(jobChatAttachments)
        .innerJoin(
          jobChatMessages,
          and(
            eq(jobChatMessages.id, jobChatAttachments.messageId),
            eq(jobChatMessages.jobId, jobId),
            isNull(jobChatMessages.deletedAt),
          ),
        )
        .where(
          and(
            eq(jobChatAttachments.jobId, jobId),
            ilike(jobChatAttachments.mimeType, "image/%"),
            query ? ilike(jobChatAttachments.name, pattern) : undefined,
          ),
        )
        .orderBy(desc(jobChatAttachments.createdAt))
        .limit(100);
      for (const photo of photos as { id: string; name: string }[])
        targets.push({
          key: photo.id,
          label: photo.name,
          description: "Chat photo",
          url: `/api/job-chat/attachments/${photo.id}`,
        });
    }
  }
  if (input.kind === "materialList") {
    const lists = await ctx.db
      .select({
        id: materialLists.id,
        name: materialLists.name,
        kind: materialLists.kind,
      })
      .from(materialLists)
      .where(
        and(
          eq(materialLists.jobId, jobId),
          eq(materialLists.organizationId, access.actor.organizationId),
          query ? ilike(materialLists.name, pattern) : undefined,
        ),
      )
      .orderBy(desc(materialLists.updatedAt))
      .limit(100);
    for (const list of lists as { id: string; name: string; kind: string }[])
      targets.push({
        key: list.id,
        label: list.name,
        description: list.kind === "tools" ? "Tool request" : "Material list",
        url: `/dashboard/material-lists/${list.id}`,
      });
  }
  if (input.kind === "chat")
    targets.push({
      key: `chat:${jobId}`,
      label: `${job.name} · chat`,
      description: "Job conversation",
      url: `${prefix}/chat`,
    });
  if (input.kind === "job") {
    const areas = [
      ["Job overview", ""],
      ["Rooms", "/rooms"],
      ["Drawings", "/drawings"],
      ["Documents", "/documents"],
      ["Chat", "/chat"],
      ["Material lists", "/material-lists"],
    ];
    for (const [label, suffix] of areas)
      targets.push({
        key: suffix?.length ? suffix : "job",
        label: label!,
        url: prefix + suffix,
      });
  }
  return {
    jobs: jobChoices,
    targets: targets
      .filter(
        (item) =>
          !query ||
          `${item.label} ${item.description ?? ""}`
            .toLowerCase()
            .includes(query),
      )
      .slice(0, 100),
  };
}
