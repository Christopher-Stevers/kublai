import { inArray } from "drizzle-orm";
import { drawingWorkspaceMetadata } from "~/server/db/drawing-workspace-schema";
import { documentBlobPath } from "~/server/documents/storage";
import type { TitleBlockWord } from "~/lib/drawing-title-block";
import {
  equipmentDocumentDestination,
  equipmentDrawingDestination,
} from "~/lib/equipment-tags";
import { equipmentIndex, drawingPdfLocation } from "./equipment-index";
import { searchContext } from "./equipment-links";
import { textMatches } from "~/lib/text-matches";
import type { DrawingContext } from "./service";

export type TextSearchHit = {
  kind: "drawing" | "document";
  /** Drawing sheet or document id. */
  id: string;
  name: string;
  page: number;
  text: string;
  url: string;
  /** Drawing hits: the PDF page shown and where the text is on it. */
  sourceSheetId?: string;
  box?: TitleBlockWord;
};

const LIMIT = 100;
const BUDGET_MS = 15_000;

/** An index, or "late" once the request's time is up. A late index keeps
 * building, so the next search finds it ready. */
async function indexBy(
  file: string,
  deadline: number,
): Promise<Awaited<ReturnType<typeof equipmentIndex>> | null | "late"> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "late";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const index = equipmentIndex(file, "pdf").catch(() => null);
  const result = await Promise.race([
    index,
    new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), remaining))),
  ]);
  clearTimeout(timer);
  return result;
}

/** Searches the text of this drawing set's PDF pages, or of the job's PDF
 * documents, from the same index the drawing tag links read. */
export async function searchDrawingText(
  ctx: DrawingContext,
  input: { sheetId: string; kind: "drawing" | "document"; query: string },
) {
  const context = await searchContext(ctx, input.sheetId);
  const { jobId, organizationId } = context.access.sheet;
  const hits: TextSearchHit[] = [];
  let unreadable = 0;
  let pending = 0;
  const deadline = Date.now() + BUDGET_MS;
  const add = (hit: TextSearchHit) => {
    if (hits.length <= LIMIT) hits.push(hit);
  };
  if (input.kind === "drawing") {
    const sheets = context.sheets.filter(
      (s) =>
        s.setId === context.access.sheet.setId && !context.historical.has(s.id),
    );
    const metadata = sheets.length
      ? await ctx.db
          .select({
            sheetId: drawingWorkspaceMetadata.sheetId,
            data: drawingWorkspaceMetadata.data,
          })
          .from(drawingWorkspaceMetadata)
          .where(
            inArray(
              drawingWorkspaceMetadata.sheetId,
              sheets.map((s) => s.id),
            ),
          )
      : [];
    const currentSources = new Map(
      metadata.map((row) => [row.sheetId, row.data.currentSourceSheetId]),
    );
    const pages = sheets.flatMap((target) => {
      const current =
        context.sheets.find((s) => s.id === currentSources.get(target.id)) ??
        target;
      const location = drawingPdfLocation(current.imageUrl, jobId);
      return location ? [{ target, current, ...location }] : [];
    });
    // One index load per PDF, pages in their order in it.
    pages.sort((a, b) => a.file.localeCompare(b.file) || a.page - b.page);
    let file = "";
    let index: Awaited<ReturnType<typeof indexBy>> = null;
    for (const { target, current, ...location } of pages) {
      if (hits.length > LIMIT) break;
      if (location.file !== file) {
        file = location.file;
        index = await indexBy(file, deadline);
      }
      if (index === "late") {
        pending++;
        continue;
      }
      const words = index?.pages.find((p) => p.page === location.page)?.words;
      if (!words?.length) {
        unreadable++;
        continue;
      }
      for (const box of textMatches(words, input.query))
        add({
          kind: "drawing",
          id: target.id,
          name: target.name,
          page: location.page,
          text: box.text.slice(0, 200),
          sourceSheetId: current.id,
          box,
          url: equipmentDrawingDestination({
            jobId,
            setId: target.setId,
            sheetId: target.id,
            sourceSheetId: current.id,
            name: target.name,
            tag: input.query,
            box,
            highlight: true,
          }).href,
        });
    }
  } else {
    for (const doc of context.docs.documents.filter((d) => !d.deletedAt)) {
      if (hits.length > LIMIT) break;
      const version = context.docs.versions.find(
        (v) => v.id === doc.currentVersionId,
      );
      if (version?.mimeType !== "application/pdf") continue;
      const index = await indexBy(
        documentBlobPath(organizationId, version.sha256),
        deadline,
      );
      if (index === "late") {
        pending++;
        continue;
      }
      if (!index?.pages.some((p) => p.words.length)) {
        unreadable++;
        continue;
      }
      for (const page of index.pages)
        for (const box of textMatches(page.words, input.query))
          add({
            kind: "document",
            id: doc.id,
            name: doc.name,
            page: page.page,
            text: box.text.slice(0, 200),
            url: equipmentDocumentDestination({
              jobId,
              documentId: doc.id,
              versionId: version.id,
              name: doc.name,
              tag: input.query,
              page: page.page,
              box,
            }).href,
          });
    }
  }
  return {
    hits: hits.slice(0, LIMIT),
    more: hits.length > LIMIT,
    /** Pages or files with no text to search: scanned without recognition. */
    unreadable,
    /** Pages or files still being read; a later search includes them. */
    pending,
  };
}
