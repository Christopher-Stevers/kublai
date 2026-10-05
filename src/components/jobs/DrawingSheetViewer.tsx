"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isTileManifest,
  pickTileLevel,
  visibleTiles,
  type TileManifest,
} from "~/lib/drawing-tiles";
import { loadPdfDocument } from "~/lib/pdf-client";

const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
/** How often tile choices follow the view while it is moving. */
const COMMIT_MS = 120;
type Point = { x: number; y: number };
type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };

/**
 * Pan-and-zoom for one drawing sheet, built like a map:
 * - the saved sheet image shows immediately;
 * - sharper tiles (2× and 4×) load for just the visible area, with the next
 *   level down kept underneath so nothing is ever blank;
 * - beyond the deepest tiles (or before tiles exist) the visible area is
 *   redrawn from the original PDF once the view settles.
 * Movement is applied straight to the layer once per frame, with momentum.
 * Give it a `key` per sheet so each sheet opens unzoomed.
 */
export function DrawingSheetViewer({
  src,
  alt,
  pdf,
  tiles,
}: {
  src: string;
  alt: string;
  pdf?: { url: string; page: number } | null;
  /** Folder holding manifest.json and <factor>/<col>_<row>.webp tiles. */
  tiles?: string | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const sharp = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; natural: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  // `live` follows every pointer move; `view` is committed for tiles/redraws.
  const live = useRef<View>(REST);
  const [view, setView] = useState<View>(REST);
  const [moving, setMoving] = useState(false);
  const [sharpFor, setSharpFor] = useState("");
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | null>(null);
  const lastTap = useRef(0);
  const frameRequest = useRef(0);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef(0);
  const velocity = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });

  // Fit the sheet inside the frame whenever the image or frame size changes.
  useEffect(() => {
    const el = frame.current;
    const img = image.current;
    if (!el || !img) return;
    const measure = () => {
      if (!img.naturalWidth || !el.clientWidth || !el.clientHeight) return;
      const ratio = Math.min(el.clientWidth / img.naturalWidth, el.clientHeight / img.naturalHeight);
      setFit({ width: img.naturalWidth * ratio, height: img.naturalHeight * ratio, natural: img.naturalWidth });
      setFrameSize({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    img.addEventListener("load", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      img.removeEventListener("load", measure);
      observer.disconnect();
    };
  }, [src]);

  // Tile manifest (absent until the tiles for this sheet have been made).
  useEffect(() => {
    if (!tiles) return;
    let cancelled = false;
    void fetch(`${tiles}/manifest.json`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (!cancelled && isTileManifest(value)) setManifest(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tiles]);

  /** Keeps the sheet from being dragged entirely out of view. */
  const clamp = useCallback(
    (next: View): View => {
      const el = frame.current;
      if (!el || !fit) return next;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.scale));
      const maxX = Math.max(0, (fit.width * scale - el.clientWidth) / 2 + el.clientWidth * 0.4);
      const maxY = Math.max(0, (fit.height * scale - el.clientHeight) / 2 + el.clientHeight * 0.4);
      return {
        scale,
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [fit],
  );

  const paint = () => {
    frameRequest.current = 0;
    const { x, y, scale } = live.current;
    if (layer.current)
      layer.current.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  };
  /** Moves the sheet now (next frame) and lets tiles catch up shortly after. */
  const move = (next: View, settle = false) => {
    live.current = clamp(next);
    frameRequest.current ||= requestAnimationFrame(paint);
    setMoving(!settle);
    if (settle) {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = null;
      setView(live.current);
    } else {
      commitTimer.current ??= setTimeout(() => {
        commitTimer.current = null;
        setView(live.current);
      }, COMMIT_MS);
    }
  };
  useLayoutEffect(paint);
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRequest.current);
      cancelAnimationFrame(animation.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  const stopAnimation = () => {
    cancelAnimationFrame(animation.current);
    animation.current = 0;
  };
  /** Eases to a target view (double tap). */
  const animateTo = (target: View, ms = 240) => {
    stopAnimation();
    const from = live.current;
    const to = clamp(target);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const ease = 1 - Math.pow(1 - t, 3);
      move(
        {
          scale: from.scale + (to.scale - from.scale) * ease,
          x: from.x + (to.x - from.x) * ease,
          y: from.y + (to.y - from.y) * ease,
        },
        t === 1,
      );
      if (t < 1) animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  };
  /** Keeps a flick gliding and slowing down. */
  const glide = () => {
    let { x: vx, y: vy } = velocity.current;
    if (Math.hypot(vx, vy) < 0.05) return move(live.current, true);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay;
      vy *= decay;
      const before = live.current;
      move({ ...before, x: before.x + vx * dt, y: before.y + vy * dt });
      const stuck = live.current.x === before.x && live.current.y === before.y;
      if (Math.hypot(vx, vy) < 0.02 || stuck) {
        move(live.current, true);
        animation.current = 0;
      } else animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  };

  /** Zooms by `factor` keeping the point under `at` (frame centre-relative) still. */
  const zoomAt = (base: View, factor: number, at: Point): View => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.scale * factor));
    const ratio = scale / base.scale;
    return { scale, x: at.x - (at.x - base.x) * ratio, y: at.y - (at.y - base.y) * ratio };
  };
  const fromCentre = (clientX: number, clientY: number): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };
  const startGesture = () => {
    gesture.current = { view: live.current, points: [...pointers.current.values()] };
  };

  // Geometry of the committed view.
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  const shownWidth = fit ? fit.width * view.scale : 0;
  const shownHeight = fit ? fit.height * view.scale : 0;
  const left = frameSize.width / 2 + view.x - shownWidth / 2;
  const top = frameSize.height / 2 + view.y - shownHeight / 2;
  const density = fit ? (shownWidth / fit.natural) * dpr : 1; // screen px per saved-image px
  const level = manifest ? pickTileLevel(manifest, density) : null;
  const deepest = manifest?.levels.reduce((a, b) => Math.max(a, b.factor), 1) ?? 1;
  const visible = shownWidth
    ? {
        left: -left / shownWidth,
        top: -top / shownHeight,
        right: (frameSize.width - left) / shownWidth,
        bottom: (frameSize.height - top) / shownHeight,
      }
    : null;
  const tileLayers =
    manifest && level && visible
      ? manifest.levels
          .filter((item) => item.factor <= level.factor)
          .sort((a, b) => a.factor - b.factor)
          .slice(-2) // the needed level, with the next one down beneath it
          .map((item) => ({ ...item, tiles: visibleTiles(item, manifest.tileSize, visible) }))
      : [];
  // Redraw from the PDF only past the deepest tiles, or when there are none.
  const needsPdf = Boolean(pdf) && fit !== null && (!manifest ? density > 1.05 : density > deepest * 1.05);
  const viewKey = fit
    ? [view.scale, view.x, view.y, fit.width, fit.height, frameSize.width, frameSize.height]
        .map((n) => n.toFixed(2))
        .join(":")
    : "";

  useEffect(() => {
    if (!needsPdf || !pdf || !fit || !frameSize.width || moving) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const doc = await loadPdfDocument(pdf.url);
          const page = await doc.getPage(pdf.page);
          if (cancelled) return;
          const viewport = page.getViewport({
            scale: (shownWidth / page.getViewport({ scale: 1 }).width) * dpr,
            offsetX: left * dpr,
            offsetY: top * dpr,
          });
          const work = document.createElement("canvas");
          work.width = Math.round(frameSize.width * dpr);
          work.height = Math.round(frameSize.height * dpr);
          const render = page.render({ canvas: work, viewport });
          task = render;
          await render.promise;
          const target = sharp.current;
          if (cancelled || !target) return;
          target.width = work.width;
          target.height = work.height;
          const ctx = target.getContext("2d")!;
          // Keep only the sheet itself; PDF.js paints the whole canvas white.
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.save();
          ctx.beginPath();
          ctx.rect(left * dpr, top * dpr, shownWidth * dpr, shownHeight * dpr);
          ctx.clip();
          ctx.drawImage(work, 0, 0);
          ctx.restore();
          setSharpFor(viewKey);
        } catch {
          // Keep showing the image and tiles if the PDF can't be drawn.
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
    // viewKey captures view, fit and frame size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf?.url, pdf?.page, viewKey, needsPdf, moving]);

  return (
    <div
      ref={frame}
      className="relative h-full w-full touch-none overflow-hidden bg-muted select-none"
      onPointerDown={(event) => {
        stopAnimation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        velocity.current = { x: 0, y: 0, t: performance.now() };
        startGesture();
        if (pointers.current.size === 1) {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            // Double tap: zoom in around the point, or back out when zoomed.
            animateTo(
              live.current.scale > 1.5
                ? REST
                : zoomAt(live.current, 3, fromCentre(event.clientX, event.clientY)),
            );
            lastTap.current = 0;
          } else lastTap.current = now;
        }
      }}
      onPointerMove={(event) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const now = [...pointers.current.values()];
        const before = gesture.current.points;
        const base = gesture.current.view;
        if (now.length >= 2 && before.length >= 2) {
          const a = now[0]!, b = now[1]!;
          const a0 = before[0]!, b0 = before[1]!;
          const factor =
            Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
          const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
          const mid0 = fromCentre((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
          const zoomed = zoomAt(base, factor, mid0);
          move({ ...zoomed, x: zoomed.x + mid.x - mid0.x, y: zoomed.y + mid.y - mid0.y });
        } else if (now.length === 1 && before[0]) {
          const p = now[0]!;
          move({ ...base, x: base.x + p.x - before[0].x, y: base.y + p.y - before[0].y });
          // Track the finger's speed for momentum.
          const t = performance.now();
          const dt = Math.max(1, t - velocity.current.t);
          velocity.current = {
            x: 0.7 * ((p.x - previous.x) / dt) + 0.3 * velocity.current.x,
            y: 0.7 * ((p.y - previous.y) / dt) + 0.3 * velocity.current.y,
            t,
          };
        }
      }}
      onPointerUp={(event) => {
        const wasPanning = pointers.current.size === 1;
        pointers.current.delete(event.pointerId);
        startGesture();
        if (pointers.current.size === 0) {
          // Ignore a stale speed if the finger rested before lifting.
          if (wasPanning && performance.now() - velocity.current.t < 80) glide();
          else move(live.current, true);
        }
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        startGesture();
        if (pointers.current.size === 0) move(live.current, true);
      }}
      onWheel={(event) => {
        stopAnimation();
        move(zoomAt(live.current, Math.exp(-event.deltaY * 0.0015), fromCentre(event.clientX, event.clientY)));
        if (commitTimer.current) clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(() => {
          commitTimer.current = null;
          move(live.current, true);
        }, COMMIT_MS);
      }}
    >
      <div
        ref={layer}
        className="absolute top-1/2 left-1/2 origin-center will-change-transform"
        style={{ width: fit?.width, height: fit?.height, visibility: fit ? "visible" : "hidden" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} src={src} alt={alt} draggable={false} className="absolute inset-0 h-full w-full" />
        {tileLayers.map((item) =>
          item.tiles.map(({ col, row }) => {
            const size = manifest!.tileSize;
            const w = Math.min(size, item.width - col * size);
            const h = Math.min(size, item.height - row * size);
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${item.factor}/${col}_${row}`}
                src={`${tiles}/${item.factor}/${col}_${row}.webp`}
                alt=""
                draggable={false}
                decoding="async"
                className="absolute opacity-0 transition-opacity duration-200"
                onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
                style={{
                  left: `${((col * size) / item.width) * 100}%`,
                  top: `${((row * size) / item.height) * 100}%`,
                  // A hair of overlap hides seams between neighbouring tiles.
                  width: `calc(${(w / item.width) * 100}% + 0.5px)`,
                  height: `calc(${(h / item.height) * 100}% + 0.5px)`,
                }}
              />
            );
          }),
        )}
      </div>
      {pdf && (
        <canvas
          ref={sharp}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150"
          style={{ opacity: needsPdf && !moving && sharpFor === viewKey ? 1 : 0 }}
        />
      )}
    </div>
  );
}
