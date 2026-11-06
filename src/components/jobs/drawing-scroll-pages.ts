import type { DrawingViewport } from "./DrawingSheetViewer";

/** Continuous scroll: the open sheet's viewer also draws the pages either side,
 * a short gap apart, so they pan and zoom with it like one long document. */
export type ScrollPage = { id: string; name: string; imageUrl: string; width: number; height: number };
export type ScrollStack = {
  previous: ScrollPage[];
  next: ScrollPage[];
  /** The camera settled `offset` pages away: open that page with this view. */
  onPage: (offset: number, viewport: DrawingViewport) => void;
};
type Size = { width: number; height: number };
/** Space between pages, in screen pixels at fit. */
export const SCROLL_PAGE_GAP = 12;

/** Keep every page in the layout; preview loading is limited independently. */
export function scrollNeighbors(sheets: ScrollPage[], index: number): Omit<ScrollStack, "onPage"> {
  return {
    previous: sheets.slice(0, index),
    next: sheets.slice(index + 1),
  };
}

export type StackedPage = { offset: number; page: ScrollPage | null; top: number; width: number; height: number };

/** Each page's box in the open page's fit pixels, measured from its centre.
 * Every page fits the frame the way it would when opened, so the camera keeps
 * its zoom when the open page changes. */
export function pageStack(frame: Size, fit: Size, stack: ScrollStack): StackedPage[] {
  const size = (page: ScrollPage) => {
    const ratio = Math.min(frame.width / Math.max(1, page.width), frame.height / Math.max(1, page.height));
    return { width: page.width * ratio, height: page.height * ratio };
  };
  const pages: StackedPage[] = [{ offset: 0, page: null, top: -fit.height / 2, ...fit }];
  let top = -fit.height / 2;
  stack.previous.slice().reverse().forEach((page, i) => {
    const box = size(page);
    top -= SCROLL_PAGE_GAP + box.height;
    pages.unshift({ offset: -1 - i, page, top, ...box });
  });
  let bottom = fit.height / 2;
  stack.next.forEach((page, i) => {
    const box = size(page);
    pages.push({ offset: i + 1, page, top: bottom + SCROLL_PAGE_GAP, ...box });
    bottom += SCROLL_PAGE_GAP + box.height;
  });
  return pages;
}

/** Pan beyond either edge, retaining a small visible strip of the sheet. */
export function pagePanLimit(sheetExtent: number, viewportExtent: number) {
  return (sheetExtent + viewportExtent) / 2 - Math.min(sheetExtent, viewportExtent) * 0.1;
}

/** Keep the outer pages reachable while permitting overscroll at every zoom. */
export function scrollLimits(pages: StackedPage[], frame: Size, scale: number) {
  const first = pages[0]!, last = pages[pages.length - 1]!;
  const width = Math.max(...pages.map(page => page.width));
  return {
    maxX: pagePanLimit(width * scale, frame.width),
    minY: -(last.top + last.height / 2) * scale - pagePanLimit(last.height * scale, frame.height),
    maxY: -(first.top + first.height / 2) * scale + pagePanLimit(first.height * scale, frame.height),
  };
}

/** The page under the frame centre, and the same view as that page's own. */
export function pageAtCentre(pages: StackedPage[], view: { scale: number; x: number; y: number }) {
  const centre = -view.y / view.scale;
  const page = pages.find(page => centre < page.top + page.height + SCROLL_PAGE_GAP / 2) ?? pages[pages.length - 1]!;
  return {
    offset: page.offset,
    viewport: {
      center: { x: 0.5 - view.x / (page.width * view.scale), y: (centre - page.top) / page.height },
      zoom: view.scale,
    },
  };
}

/** Drawing pages on the private file route have a 640px copy for cards. */
export const DRAWING_THUMBNAIL_WIDTH = 640;
export const drawingThumbnailUrl = (src: string) =>
  /^\/api\/job-rooms\/files\/[^?]+\/floor-\d+\.webp$/i.test(src)
    ? `${src}?thumb=1`
    : null;

/** Small on screen, the 640px copy is as sharp as the page and decodes in a
 * fraction of the time; the full image loads only once a page is shown large. */
export function needsFullPage(width: number, scale: number, dpr: number) {
  return width * scale * dpr > DRAWING_THUMBNAIL_WIDTH * 1.25;
}

/** Load previews in and just beyond the viewport without decoding the whole set.
 * Every other page still has its correctly sized placeholder in the stack. */
export function scrollPreviewOffsets(pages: StackedPage[], frame: Size, view: { scale: number; y: number }) {
  const centre = -view.y / view.scale;
  const reach = frame.height / view.scale;
  return new Set(pages
    .filter(page => page.offset !== 0 && page.top <= centre + reach && page.top + page.height >= centre - reach)
    .sort((a, b) => Math.abs(a.top + a.height / 2 - centre) - Math.abs(b.top + b.height / 2 - centre))
    .slice(0, 24)
    .map(page => page.offset));
}
