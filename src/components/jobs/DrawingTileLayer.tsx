"use client";

import { useLayoutEffect, useRef } from "react";
import { DrawingTileCache } from "~/lib/drawing-tile-cache";
import type { DrawingTileRequest } from "~/lib/drawing-tiles";

export function DrawingTileLayer({ requests, resolveAssetUrl, restMs = 0, onViewReady }: {
  requests: DrawingTileRequest[];
  resolveAssetUrl?: (url: string) => Promise<string>;
  /** Wait this long for the view to hold still before downloading for it. */
  restMs?: number;
  /** Whether the tiles on screen have all arrived. */
  onViewReady?: (ready: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cache = useRef<DrawingTileCache | null>(null);
  const viewReady = useRef(onViewReady);
  useLayoutEffect(() => { viewReady.current = onViewReady; }, [onViewReady]);
  useLayoutEffect(() => {
    if (container.current) cache.current = new DrawingTileCache(container.current, undefined, undefined, resolveAssetUrl, (ready) => viewReady.current?.(ready));
    return () => { cache.current?.dispose(); cache.current = null; };
  }, [resolveAssetUrl]);
  useLayoutEffect(() => { cache.current?.update(requests, restMs); }, [requests, resolveAssetUrl, restMs]);
  return <div ref={container} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true" />;
}
