import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { MAX_DRAWING_LINKS, drawingMarkupLinks } from "~/lib/drawing-links";
import {
  type DrawingEntity,
  type DrawingJobSheet,
  type DrawingMarkupLink,
} from "~/lib/drawing-workspace";
import {
  equipmentDrawingDestination,
  equipmentTagLocations,
} from "~/lib/equipment-tags";
import { readSnapshotState } from "~/lib/snapshot-source";
import { drawingPdfLocation, equipmentIndex } from "./equipment-index";

export function withoutTagHighlight(
  link: DrawingMarkupLink,
): DrawingMarkupLink {
  if (!link.url) return link;
  const url = new URL(link.url, "https://snapshot.invalid");
  const state = readSnapshotState(url.hash);
  if (!state?.drawing) return link;
  state.drawing.search = "";
  delete state.drawing.highlight;
  url.hash = `snapshot=${encodeURIComponent(JSON.stringify(state))}`;
  return {
    ...link,
    url: link.url.startsWith("/")
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href,
  };
}
export function equipmentAnnotationId(
  origin: string,
  sheet: string,
  source: string,
  points: unknown,
) {
  const hex = createHash("sha256")
    .update(JSON.stringify([origin, sheet, source, points]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Only explicitly linked pages in this set are annotated. Coordinates come from their PDF text. */
export async function equipmentAnnotationPlan(
  entity: DrawingEntity,
  jobId: string,
  sheets: DrawingJobSheet[],
  currentSource: (sheetId: string) => Promise<string>,
) {
  if (
    entity.kind !== "markup" ||
    entity.data.type !== "link" ||
    !entity.data.equipmentTag ||
    entity.data.equipmentOriginId ||
    entity.visibility === "archived"
  )
    return [];
  const origin = sheets.find((s) => s.id === entity.sheetId);
  if (!origin) return [];
  const links = drawingMarkupLinks(entity.data).map(withoutTagHighlight);
  const targets = new Set<string>();
  for (const link of links) {
    if (!link.url) continue;
    const url = new URL(link.url, "https://snapshot.invalid");
    // Automatic search produces local drawing destinations only.
    if (!link.url.startsWith(`/dashboard/jobs/${jobId}/drawings`)) continue;
    const drawing = readSnapshotState(url.hash)?.drawing;
    if (
      drawing?.jobId === jobId &&
      drawing.sheetId !== origin.id &&
      sheets.some((s) => s.id === drawing.sheetId && s.setId === origin.setId)
    )
      targets.add(drawing.sheetId);
  }
  const points = entity.data.points;
  const back = equipmentDrawingDestination({
    jobId,
    setId: origin.setId,
    sheetId: origin.id,
    sourceSheetId: entity.data.sourceSheetId,
    name: origin.name,
    tag: entity.data.equipmentTag,
    box: {
      text: entity.data.equipmentTag,
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    },
  });
  const destinations =
    links.length >= MAX_DRAWING_LINKS
      ? links
      : [
          {
            label: back.title ?? `${entity.data.equipmentTag} — ${origin.name}`,
            url: back.href,
          },
          ...links,
        ].slice(0, MAX_DRAWING_LINKS);
  const result: Array<{
    id: string;
    sheetId: string;
    sourceSheetId: string;
    points: Array<{ x: number; y: number }>;
    links: DrawingMarkupLink[];
  }> = [];
  for (const sheetId of [...targets].sort()) {
    const sourceSheetId = await currentSource(sheetId);
    const source = sheets.find((s) => s.id === sourceSheetId);
    const location = source && drawingPdfLocation(source.imageUrl, jobId);
    if (!location)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "A linked drawing has no searchable PDF. Remove it or retry after its upload finishes.",
      });
    const index = await equipmentIndex(location.file, "pdf");
    const page = index.pages.find((p) => p.page === location.page);
    if (!page)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Could not search a linked drawing. Retry before saving the equipment links.",
      });
    for (const box of equipmentTagLocations(
      page.words,
      entity.data.equipmentTag,
    )) {
      const points = [
        { x: box.left, y: box.top },
        { x: box.right, y: box.bottom },
      ];
      result.push({
        id: equipmentAnnotationId(entity.id, sheetId, sourceSheetId, points),
        sheetId,
        sourceSheetId,
        points,
        links: destinations,
      });
      if (result.length > 50)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "More than 50 matching tags. Link fewer drawings at a time.",
        });
    }
  }
  return result;
}
