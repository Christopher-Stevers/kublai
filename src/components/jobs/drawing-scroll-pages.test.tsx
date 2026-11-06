import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingPageModeSetting, useDrawingPageMode } from "./DrawingPageMode";
import { pageAtCentre, pageStack, SCROLL_PAGE_GAP, scrollLimits, scrollNeighbors } from "./drawing-scroll-pages";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shares and remembers the document/drawing mode across mounted settings", () => {
  function Reader() { return <output>{useDrawingPageMode().scroll ? "Scrolling" : "Buttons"}</output>; }
  const view = render(<><DrawingPageModeSetting /><Reader /></>);
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("Scrolling")).toBeVisible();
  view.unmount();
  render(<DrawingPageModeSetting />);
  expect(screen.getByRole("switch")).toBeChecked();
});

describe("continuous scroll pages", () => {
  const page = (n: number, width = 1000, height = 500) => ({ id: String(n), name: `Page ${n}`, imageUrl: `/${n}.webp`, width, height });
  const sheets = [0, 1, 2, 3, 4].map(n => page(n));
  // A phone held upright: landscape sheets fit its width.
  const frame = { width: 400, height: 700 };
  const fit = { width: 400, height: 200 };

  it("stacks the pages either side a short gap apart", () => {
    const stack = { ...scrollNeighbors(sheets, 1), onPage: vi.fn() };
    const pages = pageStack(frame, fit, stack);
    expect(pages.map(p => [p.offset, p.top, p.height])).toEqual([
      [-1, -100 - SCROLL_PAGE_GAP - 200, 200],
      [0, -100, 200],
      [1, 100 + SCROLL_PAGE_GAP, 200],
      [2, 300 + 2 * SCROLL_PAGE_GAP, 200],
      [3, 500 + 3 * SCROLL_PAGE_GAP, 200],
    ]);
    expect(scrollNeighbors(sheets, 4)).toEqual({ previous: sheets.slice(1, 4), next: [] });
  });

  it("fits a portrait neighbour by its own height, as it opens", () => {
    const [, next] = pageStack({ width: 1000, height: 500 }, { width: 1000, height: 500 }, { ...scrollNeighbors([page(0), page(1, 500, 1000)], 0), onPage: vi.fn() });
    expect(next).toMatchObject({ width: 250, height: 500, top: 250 + SCROLL_PAGE_GAP });
  });

  it("travels through the drawn pages but not past the first page's top", () => {
    const pages = pageStack(frame, fit, { ...scrollNeighbors(sheets, 0), onPage: vi.fn() });
    const fitted = scrollLimits(pages, frame, 1);
    // The first page sits at the top of the frame, not floating in the middle.
    expect(fitted.maxY).toBe(-(-100 + 350));
    expect(fitted.maxX).toBe(0);
    const zoomed = scrollLimits(pages, frame, 4);
    expect(zoomed.maxY).toBe(4 * (100 - 350 / 4));
    expect(zoomed.maxX).toBe((400 * 4 - 400) / 2);
    const last = pages[pages.length - 1]!;
    expect(zoomed.minY).toBe(-4 * (last.top + last.height - 350 / 4));
  });

  it("finds the page under the centre and keeps the view on it", () => {
    const pages = pageStack(frame, fit, { ...scrollNeighbors(sheets, 1), onPage: vi.fn() });
    expect(pageAtCentre(pages, { scale: 2, x: 0, y: -2 * 50 }).offset).toBe(0);
    // Into the gap's lower half belongs to the page below.
    expect(pageAtCentre(pages, { scale: 2, x: 0, y: -2 * (100 + SCROLL_PAGE_GAP / 2 + 1) }).offset).toBe(1);
    const landed = pageAtCentre(pages, { scale: 3, x: 120, y: -3 * (100 + SCROLL_PAGE_GAP + 50) });
    expect(landed).toEqual({ offset: 1, viewport: { center: { x: 0.5 - 120 / 1200, y: 0.25 }, zoom: 3 } });
    expect(pageAtCentre(pages, { scale: 1, x: 0, y: 260 }).offset).toBe(-1);
  });
});
