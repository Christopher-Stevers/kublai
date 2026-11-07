"use client";

import { useLayoutEffect, useRef } from "react";
import { DrawingTileCache } from "~/lib/drawing-tile-cache";
import type { DrawingTileRequest } from "~/lib/drawing-tiles";

export function DrawingTileLayer({ requests, resolveAssetUrl }: { requests: DrawingTileRequest[]; resolveAssetUrl?: (url: string) => Promise<string> }) {
  const container = useRef<HTMLDivElement>(null);
  const cache = useRef<DrawingTileCache | null>(null);
  useLayoutEffect(() => {
    if (container.current) cache.current = new DrawingTileCache(container.current, undefined, undefined, resolveAssetUrl);
    return () => { cache.current?.dispose(); cache.current = null; };
  }, [resolveAssetUrl]);
  useLayoutEffect(() => { cache.current?.update(requests); }, [requests, resolveAssetUrl]);
  return <div ref={container} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true" />;
}
