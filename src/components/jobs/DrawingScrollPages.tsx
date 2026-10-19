"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
type Sheet = { id: string; name: string; imageUrl: string; width: number; height: number };
/** How long scrolling must pause before the interactive page moves. */
const SETTLE_MS = 150;
/** Keep only the current page's interactive workspace alive; other pages use lazy previews. */
export function DrawingScrollPages({ enabled, sheets, index, onPage, children }: {
  enabled: boolean; sheets: Sheet[]; index: number; onPage: (index: number) => void; children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scrollSelected = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Where the reader is (page plus fraction), so a resize keeps their place.
  const anchor = useRef<{ page: number; fraction: number } | null>(null);
  const shown = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Page positions come from the sheet sizes, so scrolling never measures the DOM.
  const layout = useMemo(() => {
    const heights = sheets.map(sheet => Math.max(size.height, size.width * sheet.height / Math.max(1, sheet.width)) || 0);
    return heights.map((height, page) => ({ top: heights.slice(0, page).reduce((sum, value) => sum + value, 0), height, style: height > 0 ? height : "100%" }));
  }, [sheets, size.width, size.height]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => () => clearTimeout(settle.current), []);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) { shown.current = null; anchor.current = null; return; }
    if (!layout[index]?.height) return;
    const jumped = shown.current !== index;
    shown.current = index;
    if (scrollSelected.current === index) { scrollSelected.current = null; return; }
    // A page jump goes to the page top; a resize keeps the reader's place.
    const kept = jumped ? null : anchor.current;
    const page = layout[kept?.page ?? index] ?? layout[index];
    node.scrollTop = page.top + (kept?.fraction ?? 0) * page.height;
  }, [enabled, index, layout]);
  if (!enabled) return <>{children}</>;
  return <div ref={container} className="relative h-full overflow-y-auto overscroll-contain" aria-label="Scrolling pages"
    onScroll={() => {
      const node = container.current;
      if (!node) return;
      const top = node.scrollTop;
      const first = layout.findIndex(page => top < page.top + page.height);
      if (first < 0) return;
      anchor.current = { page: first, fraction: (top - layout[first]!.top) / Math.max(1, layout[first]!.height) };
      const middle = top + node.clientHeight * 0.5;
      const next = layout.findIndex(page => middle >= page.top && middle < page.top + page.height);
      // Moving the interactive page rebuilds the whole workspace, so wait until scrolling stops.
      clearTimeout(settle.current);
      if (next < 0 || next === index) return;
      settle.current = setTimeout(() => { scrollSelected.current = next; onPage(next); }, SETTLE_MS);
    }}>
    {sheets.map((sheet, page) => <section key={sheet.id} aria-label={sheet.name}
      // Off-screen previews skip layout and paint.
      style={{ height: layout[page]?.style, contentVisibility: page === index ? undefined : "auto" }}
      className="relative border-b-8 border-background">
      {page === index ? children : <img src={sheet.imageUrl} alt={sheet.name} loading="lazy" decoding="async" className="h-full w-full object-contain" />}
    </section>)}
  </div>;
}
