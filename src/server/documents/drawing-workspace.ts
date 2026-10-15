import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import type { db as database } from "~/server/db";
import {
  jobDocumentWorkspaces,
  jobDrawingSets,
  jobDrawingSheets,
} from "~/server/db/schema";
import { assertDocumentAccess, documentActor } from "./access";
import { accessibleDocument, emptyDocumentState } from "./domain";
import { readDocumentBlob } from "./storage";
import type { DrawingActor } from "~/server/drawings/domain";

type Reader = Pick<typeof database, "select">;

/** Recheck the actual folder ACL, recycling and lock state on every workspace request. */
export async function documentDrawingAccess(
  reader: Reader,
  userId: string,
  jobId: string,
  versionId: string,
) {
  const access = await assertDocumentAccess(userId, jobId, reader);
  const [row] = await reader
    .select({ state: jobDocumentWorkspaces.state })
    .from(jobDocumentWorkspaces)
    .where(
      and(
        eq(jobDocumentWorkspaces.jobId, jobId),
        eq(jobDocumentWorkspaces.organizationId, access.job.organizationId),
      ),
    )
    .limit(1);
  const state = row?.state ?? emptyDocumentState();
  const version = state.versions.find((item) => item.id === versionId);
  if (version?.mimeType !== "application/pdf")
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "PDF version not found.",
    });
  const actor = documentActor(access, []);
  const document = accessibleDocument(state, actor, version.documentId);
  let canAnnotate = document.currentVersionId === versionId;
  try {
    accessibleDocument(state, actor, document.id, { write: true });
  } catch {
    canAnnotate = false;
  }
  const drawingActor: DrawingActor = {
    id: access.user.id,
    name: access.user.name ?? "Team member",
    organizationId: access.job.organizationId,
    canManage: canAnnotate && access.canManage,
  };
  return { access, version, document, canAnnotate, actor: drawingActor };
}

/** The drawing rows are private page identities; the original file stays in document storage. */
export async function openDocumentDrawingWorkspace(
  ctx: { db: typeof database; userId: string },
  input: { jobId: string; versionId: string },
) {
  // Check before reading file bytes, and recheck under the document mutation lock before publishing.
  const initial = await documentDrawingAccess(
    ctx.db,
    ctx.userId,
    input.jobId,
    input.versionId,
  );
  const existing = await ctx.db
    .select()
    .from(jobDrawingSheets)
    .where(
      and(
        eq(jobDrawingSheets.documentVersionId, input.versionId),
        eq(jobDrawingSheets.jobId, input.jobId),
        eq(jobDrawingSheets.organizationId, initial.actor.organizationId),
      ),
    )
    .orderBy(asc(jobDrawingSheets.sortOrder));
  if (existing.length) return existing;
  const bytes = await readDocumentBlob(
    initial.actor.organizationId,
    initial.version.sha256,
  );
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  if (!pages.length || pages.length > 2000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Open a PDF with between 1 and 2000 pages.",
    });
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId}, 4149))`,
    );
    const current = await documentDrawingAccess(
      tx,
      ctx.userId,
      input.jobId,
      input.versionId,
    );
    const rows = await tx
      .select()
      .from(jobDrawingSheets)
      .where(eq(jobDrawingSheets.documentVersionId, input.versionId))
      .orderBy(asc(jobDrawingSheets.sortOrder));
    if (rows.length) return rows;
    const setId = randomUUID();
    await tx
      .insert(jobDrawingSets)
      .values({
        id: setId,
        jobId: input.jobId,
        organizationId: current.actor.organizationId,
        documentVersionId: input.versionId,
        name: current.document.name,
        createdByUserId: ctx.userId,
      });
    const sheets = pages.map((page, index) => {
      const rotated = Math.abs(page.getRotation().angle % 180) === 90;
      const size = page.getCropBox();
      return {
        id: randomUUID(),
        setId,
        jobId: input.jobId,
        organizationId: current.actor.organizationId,
        documentVersionId: input.versionId,
        name: `Page ${index + 1}`,
        sourceFilename: current.version.name,
        imageUrl: `/api/job-documents/pages/${input.versionId}/${index + 1}?jobId=${input.jobId}`,
        width: Math.max(1, Math.round(rotated ? size.height : size.width)),
        height: Math.max(1, Math.round(rotated ? size.width : size.height)),
        sortOrder: index + 1,
        uploadedByUserId: ctx.userId,
      };
    });
    return tx.insert(jobDrawingSheets).values(sheets).returning();
  });
}
