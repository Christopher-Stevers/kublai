import { TRPCError } from "@trpc/server";
import type { HyperlinkScope, HyperlinkTargets } from "~/lib/hyperlink-scope";
import { MAX_DRAWING_LINKS } from "~/lib/drawing-links";
import { normalizeEquipmentTag } from "~/lib/equipment-tags";
import {
  destinationsFromRegisters,
  jobFiles,
  readRegisters,
} from "./equipment-register";
import type { DrawingContext } from "./service";

/** Only expose current sources already filtered by job and document permissions. */
export async function autoHyperlinkTargets(
  ctx: DrawingContext,
  sheetId: string,
): Promise<HyperlinkTargets> {
  const job = await jobFiles(ctx, sheetId);
  return {
    drawings: job.drawings.map(({ sheet }) => ({
      id: sheet.id,
      name: sheet.name,
      setId: sheet.setId,
      setName: sheet.setName ?? "Drawings",
    })),
    documents: job.documents
      .filter((d) => d.file)
      .map(({ doc }) => ({
        id: doc.id,
        name: doc.name,
        folderId: doc.folderId,
      })),
    folders: job.context.docs.folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
    })),
  };
}

/** A single ACL check/index pass replaces tag × source network requests. */
export async function autoHyperlinkPreview(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    tags: string[];
    scope: HyperlinkScope["scope"];
    drawingIds?: string[];
    documentIds?: string[];
  },
) {
  const job = await jobFiles(ctx, input.sheetId);
  if (input.scope === "set")
    job.drawings = job.drawings.filter(
      (d) => d.sheet.setId === job.context.access.sheet.setId,
    );
  if (input.scope === "drawings") job.documents = [];
  if (input.scope === "documents") job.drawings = [];
  if (input.scope === "custom") {
    const drawings = new Set(input.drawingIds ?? []),
      documents = new Set(input.documentIds ?? []);
    if (
      [...drawings].some(
        (id) => !job.drawings.some((d) => d.sheet.id === id),
      ) ||
      [...documents].some(
        (id) => !job.documents.some((d) => d.doc.id === id && d.file),
      )
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "A selected search source is no longer available. Reload the source list.",
      });
    job.drawings = job.drawings.filter((d) => drawings.has(d.sheet.id));
    job.documents = job.documents.filter((d) => documents.has(d.doc.id));
  }
  const paths = new Set([
    ...job.drawings.map((d) => d.file),
    ...job.documents.flatMap((d) => (d.file ? [d.file] : [])),
  ]);
  const indexes = await readRegisters(
    job.files.filter((f) => paths.has(f.file)),
    12_000,
  );
  const warnings = new Set<string>();
  const results = [...new Set(input.tags.map(normalizeEquipmentTag))].map(
    (tag) => {
      const found = destinationsFromRegisters(job, indexes, {
        sheetId: input.sheetId,
        tag,
      });
      found.warnings.forEach((w) => warnings.add(w));
      const links = [
        ...found.drawings
          .filter((d) => !d.here)
          .flatMap((d) => d.links.slice(0, 1)),
        ...found.documents.map((d) => ({
          label: `${tag} — ${d.name}`.slice(0, 255),
          url: d.url,
        })),
      ];
      const unique = [...new Map(links.map((l) => [l.url, l])).values()];
      return {
        tag,
        links: unique.slice(0, MAX_DRAWING_LINKS),
        overflow: unique.length > MAX_DRAWING_LINKS,
        drawings: found.drawings.filter((d) => !d.here).length,
        documents: found.documents.length,
      };
    },
  );
  if (indexes.pending)
    warnings.add(
      `${indexes.pending} files are still being indexed. Scan again to include their destinations.`,
    );
  return { results, warnings: [...warnings], pending: indexes.pending };
}
