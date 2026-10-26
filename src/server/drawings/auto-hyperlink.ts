import { MAX_DRAWING_LINKS } from "~/lib/drawing-links";
import { normalizeEquipmentTag } from "~/lib/equipment-tags";
import {
  destinationsFromRegisters,
  jobFiles,
  readRegisters,
} from "./equipment-register";
import type { DrawingContext } from "./service";

/** A single ACL check/index pass replaces tag × source network requests. */
export async function autoHyperlinkPreview(
  ctx: DrawingContext,
  input: { sheetId: string; tags: string[]; scope: "job" | "set" },
) {
  const job = await jobFiles(ctx, input.sheetId);
  if (input.scope === "set")
    job.drawings = job.drawings.filter(
      (d) => d.sheet.setId === job.context.access.sheet.setId,
    );
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
