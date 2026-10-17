import { and, eq, inArray, sql } from "drizzle-orm";
import {
  drawingWorkspaceEntities,
  drawingWorkspaceMetadata,
} from "~/server/db/drawing-workspace-schema";
import { TRPCError } from "@trpc/server";
import { accessSheet, jobSheets, type DrawingContext } from "./service";
import { assertDocumentAccess } from "~/server/documents/access";
import { documentOverview } from "~/server/documents/service";
import { documentBlobPath } from "~/server/documents/storage";
import { equipmentIndex, drawingPdfLocation } from "./equipment-index";
import {
  containsEquipmentTag,
  equipmentDrawingDestination,
  equipmentTagLocations,
  tagPattern,
} from "~/lib/equipment-tags";
import type { DrawingMarkupLink } from "~/lib/drawing-workspace";

export type EquipmentSource = {
  kind: "drawing" | "document";
  id: string;
  name: string;
};

/** Read access and shared job data once per batch, never whole annotation workspaces. */
async function searchContext(ctx: DrawingContext, sheetId: string) {
  const access = await accessSheet(ctx.db, ctx.userId, sheetId);
  const [sheets, versions, docs] = await Promise.all([
    jobSheets(
      ctx.db,
      access.sheet.jobId,
      access.actor.organizationId,
      access.sheet.documentVersionId,
    ),
    ctx.db
      .select({ entity: drawingWorkspaceEntities.entity })
      .from(drawingWorkspaceEntities)
      .where(
        and(
          eq(drawingWorkspaceEntities.jobId, access.sheet.jobId),
          eq(
            drawingWorkspaceEntities.organizationId,
            access.actor.organizationId,
          ),
          sql`entity->>'kind'='version'`,
        ),
      ),
    assertDocumentAccess(ctx.userId, access.sheet.jobId, ctx.db).then((a) =>
      documentOverview(a, ctx.db),
    ),
  ]);
  const historical = new Set(
    versions.flatMap((row) =>
      row.entity.kind === "version" ? [row.entity.data.sourceSheetId] : [],
    ),
  );
  const sources: EquipmentSource[] = sheets
    .filter(
      (s) =>
        s.setId === access.sheet.setId &&
        s.id !== sheetId &&
        !historical.has(s.id),
    )
    .map((s) => ({ kind: "drawing", id: s.id, name: s.name }));
  for (const doc of docs.documents.filter((d) => !d.deletedAt))
    sources.push({ kind: "document", id: doc.id, name: doc.name });
  return { access, sheets, docs, sources };
}

export async function equipmentSources(ctx: DrawingContext, sheetId: string) {
  const { sources } = await searchContext(ctx, sheetId);
  return { sources };
}

export async function equipmentMatchesBatch(
  ctx: DrawingContext,
  input: { sheetId: string; tag: string; sources: EquipmentSource[] },
) {
  if (!tagPattern(input.tag))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter an equipment tag such as HEX-2 or FCU-1.",
    });
  if (!input.sources.length || input.sources.length > 32)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Search up to 32 sources at once.",
    });
  const context = await searchContext(ctx, input.sheetId);
  // Revalidate supplied IDs against current set membership, versions and document ACLs.
  const sources = input.sources.map((source) => {
    const found = context.sources.find(
      (s) => s.kind === source.kind && s.id === source.id,
    );
    if (!found)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Search source is no longer available.",
      });
    return found;
  });
  const drawingIds = sources
    .filter((s) => s.kind === "drawing")
    .map((s) => s.id);
  const metadata = drawingIds.length
    ? await ctx.db
        .select({
          sheetId: drawingWorkspaceMetadata.sheetId,
          data: drawingWorkspaceMetadata.data,
        })
        .from(drawingWorkspaceMetadata)
        .where(inArray(drawingWorkspaceMetadata.sheetId, drawingIds))
    : [];
  const currentSources = new Map(
    metadata.map((row) => [row.sheetId, row.data.currentSourceSheetId]),
  );
  const { jobId, organizationId } = context.access.sheet;
  const sourceOrder = new Map(
    sources.map((s, index) => [`${s.kind}:${s.id}`, index]),
  );
  const fileKey = (source: EquipmentSource) => {
    if (source.kind === "drawing") {
      const target = context.sheets.find((s) => s.id === source.id)!;
      const current =
        context.sheets.find((s) => s.id === currentSources.get(target.id)) ??
        target;
      return drawingPdfLocation(current.imageUrl, jobId)?.file ?? source.id;
    }
    const doc = context.docs.documents.find((d) => d.id === source.id)!;
    return (
      context.docs.versions.find((v) => v.id === doc.currentVersionId)
        ?.sha256 ?? source.id
    );
  };
  sources.sort((a, b) => fileKey(a).localeCompare(fileKey(b)));
  // One index load per immutable file in this request, even when it spans many pages
  // or is too large to retain in the process cache. Workers already limit CPU concurrency.
  const indexes = new Map<string, ReturnType<typeof equipmentIndex>>();
  const indexFor = (file: string, format: "pdf" | "office") => {
    const key = `${format}:${file}`;
    let index = indexes.get(key);
    if (!index) {
      // Sources from the same file are adjacent. Retain only this file, so a
      // batch of large documents cannot multiply the index's memory bound.
      indexes.clear();
      index = equipmentIndex(file, format);
      indexes.set(key, index);
    }
    return index;
  };
  const results = [];
  for (const source of sources) {
    const links: DrawingMarkupLink[] = [];
    const warnings: string[] = [];
    if (source.kind === "drawing") {
      const target = context.sheets.find((s) => s.id === source.id)!;
      const current =
        context.sheets.find((s) => s.id === currentSources.get(target.id)) ??
        target;
      const location = drawingPdfLocation(current.imageUrl, jobId);
      if (!location) warnings.push(`${target.name}: no searchable source PDF.`);
      else
        try {
          const index = await indexFor(location.file, "pdf");
          const page = index.pages.find((p) => p.page === location.page);
          if (!page?.words.length)
            warnings.push(
              `${target.name}: no embedded text; scanned recognition is needed.`,
            );
          for (const [n, box] of equipmentTagLocations(
            page?.words ?? [],
            input.tag,
          ).entries()) {
            const destination = equipmentDrawingDestination({
              jobId,
              setId: target.setId,
              sheetId: target.id,
              sourceSheetId: current.id,
              name: target.name,
              tag: input.tag,
              box,
            });
            links.push({
              label:
                `${input.tag} — ${target.name}${n ? ` (${n + 1})` : ""}`.slice(
                  0,
                  255,
                ),
              url: destination.href,
            });
          }
          if (index.incomplete && !page)
            warnings.push(`${target.name}: source exceeds the indexing limit.`);
        } catch {
          warnings.push(
            `${target.name}: could not finish text search. Try again or link manually.`,
          );
        }
    } else {
      const doc = context.docs.documents.find((d) => d.id === source.id)!;
      let found = containsEquipmentTag(
        [
          doc.name,
          doc.description,
          ...doc.tags,
          doc.submittal?.title,
          doc.submittal?.manufacturer,
          doc.submittal?.specSection,
        ]
          .filter(Boolean)
          .join(" "),
        input.tag,
      );
      const version = context.docs.versions.find(
        (v) => v.id === doc.currentVersionId,
      );
      const office = version && /\.(?:docx|xlsx|pptx)$/i.test(version.name);
      if (version && (version.mimeType === "application/pdf" || office)) {
        try {
          const index = await indexFor(
            documentBlobPath(organizationId, version.sha256),
            office ? "office" : "pdf",
          );
          found ||= index.pages.some(
            (p) => equipmentTagLocations(p.words, input.tag).length > 0,
          );
          if (!index.pages.some((p) => p.words.length))
            warnings.push(
              `${doc.name}: no searchable text; scanned recognition is needed.`,
            );
          if (index.incomplete)
            warnings.push(
              `${doc.name}: only the first 2,000 PDF pages were searched.`,
            );
        } catch {
          warnings.push(
            `${doc.name}: contents could not be searched. Metadata was checked.`,
          );
        }
      } else if (version)
        warnings.push(
          `${doc.name}: only its name, tags and description were searched.`,
        );
      if (found)
        links.push({
          label: `${input.tag} — ${doc.name}`.slice(0, 255),
          url: `/dashboard/jobs/${jobId}/documents?document=${doc.id}`,
        });
    }
    results.push({
      source,
      links: links.slice(0, 50),
      warnings,
      overflow: links.length > 50,
    });
  }
  return {
    results: results.sort(
      (a, b) =>
        sourceOrder.get(`${a.source.kind}:${a.source.id}`)! -
        sourceOrder.get(`${b.source.kind}:${b.source.id}`)!,
    ),
  };
}

// Keep the old endpoint usable by already-open clients during deployment.
export async function equipmentMatches(
  ctx: DrawingContext,
  input: { sheetId: string; tag: string; source: EquipmentSource },
) {
  const { results } = await equipmentMatchesBatch(ctx, {
    ...input,
    sources: [input.source],
  });
  return results[0]!;
}
