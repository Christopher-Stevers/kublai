"use client";

import { useState, type CSSProperties } from "react";
import { DrawingThumbnail } from "./DrawingThumbnail";
import type { ScrollPage } from "./drawing-scroll-pages";

/** The paper exists before its preview, including when offline or loading fails. */
export function DrawingScrollPage({ page, offset, loadPreview, style }: {
  page: ScrollPage;
  offset: number;
  loadPreview: boolean;
  style: CSSProperties;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = loadPreview && loaded === page.imageUrl;
  return (
    <div
      data-drawing-scroll-page={offset}
      data-preview-ready={ready}
      className="absolute overflow-hidden ring-1 ring-black/10"
      style={{ ...style, backgroundColor: "#fff", color: "#64748b" }}
    >
      {!ready && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center">
        <span className="text-base font-medium">{page.name}</span>
        <span className="text-xs">{failed === page.imageUrl ? "Preview unavailable" : loadPreview ? "Loading preview…" : "Preview loads as you scroll"}</span>
      </div>}
      {loadPreview && <DrawingThumbnail
        src={page.imageUrl}
        alt={page.name}
        draggable={false}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: ready ? 1 : 0 }}
        onLoad={() => { setLoaded(page.imageUrl); setFailed(null); }}
        onError={() => { setLoaded(null); setFailed(page.imageUrl); }}
      />}
    </div>
  );
}
