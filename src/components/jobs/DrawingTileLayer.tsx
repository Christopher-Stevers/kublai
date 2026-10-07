"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { DrawingTileCache } from "~/lib/drawing-tile-cache";
import type { DrawingTileRequest } from "~/lib/drawing-tiles";

export function DrawingTileLayer({ requests }: { requests: DrawingTileRequest[] }) {
  const container = useRef<HTMLDivElement>(null);
  const cache = useRef<DrawingTileCache | null>(null);
  useLayoutEffect(() => {
    if (container.current && !cache.current) cache.current = new DrawingTileCache(container.current);
    cache.current?.update(requests);
  }, [requests]);
  useEffect(() => () => {
    cache.current?.dispose();
    cache.current = null;
  }, []);
  return <div ref={container} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true" />;
}
