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
/** Pages drawn each side of the open one; a flick travels at most this far. */
const NEIGHBORS = 3;

export function scrollNeighbors(sheets: ScrollPage[], index: number): Omit<ScrollStack, "onPage"> {
  return {
    previous: sheets.slice(Math.max(0, index - NEIGHBORS), index),
    next: sheets.slice(index + 1, index + 1 + NEIGHBORS),
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
