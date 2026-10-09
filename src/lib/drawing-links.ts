import type {
  DrawingMarkup,
  DrawingMarkupLink,
  DrawingJobSheet,
} from "./drawing-workspace";
import { isAppLink } from "./app-links";

export const MAX_DRAWING_LINKS = 50;
/** The saved list is authoritative; older one-destination markups still work. */
export function drawingMarkupLinks(markup: DrawingMarkup): DrawingMarkupLink[] {
  if (markup.links !== undefined) return markup.links;
  const label = markup.text?.trim().slice(0, 255);
  if (markup.targetSheetId)
    return [
      {
        label: label?.length ? label : "Drawing sheet",
        targetSheetId: markup.targetSheetId,
      },
    ];
  if (markup.href)
    return [
      {
        label: label?.length ? label : markup.href.slice(0, 255),
        url: markup.href,
      },
    ];
  return [];
}

export function drawingLinkHref(
  link: DrawingMarkupLink,
  jobId: string,
  sheets: DrawingJobSheet[],
) {
  if (link.targetSheetId) {
    const sheet = sheets.find((item) => item.id === link.targetSheetId);
    return sheet
      ? `/dashboard/jobs/${jobId}/drawings?drawingSet=${sheet.setId}&drawingSheet=${sheet.id}`
      : null;
  }
  return link.url && isAppLink(link.url) ? link.url : null;
}

export const drawingLinkTargetKinds = [
  "sheet",
  "document",
  "photo",
  "chat",
  "materialList",
  "job",
] as const;
export type DrawingLinkTargetKind = (typeof drawingLinkTargetKinds)[number];
export type DrawingLinkTarget = DrawingMarkupLink & {
  key: string;
  description?: string;
};
export type DrawingLinkTargets = {
  jobs: { id: string; name: string }[];
  targets: DrawingLinkTarget[];
};
