import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db } from "~/server/db";
import { jobDrawingSets, jobDrawingSheets } from "~/server/db/schema";
import {
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
} from "~/server/db/drawing-workspace-schema";
import { userCan } from "~/server/auth/permissions";
import type { DocumentAccess } from "../documents/access";
import {
  drawingPdfLocation,
  equipmentIndex,
} from "../drawings/equipment-index";
import { wordRows } from "../packing-slips/ocr-rows";
import type { AssessmentSource, ExtractedSource } from "./types";

/** Job drawing sets only: document-backed sheets retain their document folder ACL. */
export async function drawingSources(
  reader: Pick<typeof db, "select">,
  access: DocumentAccess,
) {
  if (!userCan(access.user, "drawings.view")) return { sets: [], sources: [] };
  const scope = and(
    eq(jobDrawingSheets.jobId, access.job.id),
    eq(jobDrawingSheets.organizationId, access.job.organizationId),
    isNull(jobDrawingSheets.documentVersionId),
  );
  const [sets, sheets, revisions] = await Promise.all([
    reader
      .select({ id: jobDrawingSets.id, name: jobDrawingSets.name })
      .from(jobDrawingSets)
      .where(
        and(
          eq(jobDrawingSets.jobId, access.job.id),
          eq(jobDrawingSets.organizationId, access.job.organizationId),
          isNull(jobDrawingSets.documentVersionId),
        ),
      ),
    reader
      .select({
        id: jobDrawingSheets.id,
        setId: jobDrawingSheets.setId,
        name: jobDrawingSheets.name,
        imageUrl: jobDrawingSheets.imageUrl,
        metadata: drawingWorkspaceMetadata.data,
      })
      .from(jobDrawingSheets)
      .leftJoin(
        drawingWorkspaceMetadata,
        eq(drawingWorkspaceMetadata.sheetId, jobDrawingSheets.id),
      )
      .where(scope)
      .limit(2001),
    reader
      .select({ entity: drawingWorkspaceEntities.entity })
      .from(drawingWorkspaceEntities)
      .where(
        and(
          eq(drawingWorkspaceEntities.jobId, access.job.id),
          eq(
            drawingWorkspaceEntities.organizationId,
            access.job.organizationId,
          ),
          sql`entity->>'kind'='version'`,
        ),
      ),
  ]);
  if (sheets.length > 2000)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "This job exceeds the 2,000-sheet source selection limit.",
    });
  const historical = new Set(
    revisions.flatMap(({ entity }) =>
      entity.kind === "version" ? [entity.data.sourceSheetId] : [],
    ),
  );
  for (const sheet of sheets) {
    const current = sheet.metadata?.currentSourceSheetId;
    if (current && current !== sheet.id) historical.add(current);
  }
  const sources: AssessmentSource[] = [];
  for (const sheet of sheets) {
    if (historical.has(sheet.id)) continue;
    const set = sets.find((s) => s.id === sheet.setId);
    if (!set) continue;
    const current =
      sheets.find((s) => s.id === sheet.metadata?.currentSourceSheetId) ??
      sheet;
    sources.push({
      documentId: sheet.id,
      versionId: current.id,
      name: `${set.name} · ${sheet.name}`.slice(0, 240),
      sha256: createHash("sha256").update(current.imageUrl).digest("hex"),
      mimeType: "application/pdf",
      drawing: {
        setId: set.id,
        sheetId: sheet.id,
        sourceSheetId: current.id,
        imageUrl: current.imageUrl,
        jobId: access.job.id,
      },
    });
  }
  return {
    sets: sets.map((s) => ({
      ...s,
      sheetCount: sources.filter((p) => p.drawing?.setId === s.id).length,
    })),
    sources,
  };
}

/** Reuse the immutable PDF text index; no remote URL fetching or repeated whole-file parsing. */
export async function extractDrawingSource(
  source: AssessmentSource,
): Promise<ExtractedSource> {
  const drawing = source.drawing;
  const location =
    drawing && drawingPdfLocation(drawing.imageUrl, drawing.jobId);
  if (!location)
    return {
      pages: [],
      warnings: [
        "No searchable source PDF is available for this sheet. Review it manually.",
      ],
    };
  const index = await equipmentIndex(location.file, "pdf");
  const words = index.pages.find((p) => p.page === location.page)?.words ?? [];
  if (!words.length)
    return {
      pages: [],
      warnings: [
        "No embedded drawing text was found. Image-only symbols and scanned sheets need manual review.",
      ],
    };
  const text = wordRows(
    words.map((w) => ({
      text: w.text,
      x: w.left,
      y: w.top,
      width: w.right - w.left,
      height: w.bottom - w.top,
      confidence: 100,
    })),
    location.page,
  )
    .map((r) => r.text)
    .join("\n");
  return {
    pages: [{ page: location.page, text: text.slice(0, 100000) }],
    warnings:
      text.length > 100000
        ? [
            "Drawing text was truncated at 100,000 characters; review the rest manually.",
          ]
        : [],
  };
}
