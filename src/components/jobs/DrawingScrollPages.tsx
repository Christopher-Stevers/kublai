"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
type Sheet = { id: string; name: string; imageUrl: string; width: number; height: number };
/** Keep only the current page's interactive workspace alive; other pages use lazy previews. */
export function DrawingScrollPages({ enabled, sheets, index, onPage, children }: {
  enabled: boolean; sheets: Sheet[]; index: number; onPage: (index: number) => void; children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scrollSelected = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);
  useLayoutEffect(() => {
    if (scrollSelected.current === index) { scrollSelected.current = null; return; }
    const node = container.current;
    const page = node?.children[index] as HTMLElement | undefined;
    if (node && page) node.scrollTop = page.offsetTop;
  }, [enabled, index, size.width, size.height]);
  if (!enabled) return <>{children}</>;
  return <div ref={container} className="relative h-full overflow-y-auto overscroll-contain" aria-label="Scrolling pages"
    onScroll={() => {
      const node = container.current;
      if (!node) return;
      const position = node.scrollTop + node.clientHeight * 0.5;
      const next = Array.from(node.children).findIndex(element => {
        const page = element as HTMLElement;
        return position >= page.offsetTop && position < page.offsetTop + page.offsetHeight;
      });
      if (next >= 0 && next !== index) { scrollSelected.current = next; onPage(next); }
    }}>
    {sheets.map((sheet, page) => <section key={sheet.id} aria-label={sheet.name}
      style={{ height: Math.max(size.height, size.width * sheet.height / Math.max(1, sheet.width)) || "100%" }}
      className="relative border-b-8 border-background">
      {page === index ? children : <img src={sheet.imageUrl} alt={sheet.name} loading="lazy" className="h-full w-full object-contain" />}
    </section>)}
  </div>;
}
