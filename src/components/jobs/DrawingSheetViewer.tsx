"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isTileManifest,
  pickTileLevel,
  visibleTiles,
  type TileManifest,
} from "~/lib/drawing-tiles";
import { loadPdfDocument } from "~/lib/pdf-client";
import {
  convertScale,
  formatLength,
  MEASURE_TAP_SLOP_PX,
  parseLength,
  readSheetScale,
  realLength,
  scaleFromKnownLength,
  sheetPointFromFrame,
  writeSheetScale,
  type MeasureUnit,
  type SheetPoint,
  type SheetScale,
} from "~/lib/sheet-measure";
import { SheetMeasureBar } from "./SheetMeasureBar";

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
 * Measure mode traces points on the sheet and totals the real distance once a
 * scale has been set from a known length. Give it a `key` per sheet so each
 * sheet opens unzoomed.
 */
export function DrawingSheetViewer({
  src,
  alt,
  pdf,
  tiles,
  sheetKey,
}: {
  src: string;
  alt: string;
  pdf?: { url: string; page: number } | null;
  /** Folder holding manifest.json and <factor>/<col>_<row>.webp tiles. */
  tiles?: string | null;
  /** Remembers this sheet's scale on this computer. */
  sheetKey?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const sharp = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; natural: number; aspect: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  // `live` follows every pointer move; `view` is committed for tiles/redraws.
  const live = useRef<View>(REST);
  const [view, setView] = useState<View>(REST);
  const [moving, setMoving] = useState(false);
  const [sharpFor, setSharpFor] = useState("");
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | null>(null);
  const measureTap = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [path, setPath] = useState<SheetPoint[]>([]);
  const [calPoints, setCalPoints] = useState<SheetPoint[]>([]);
  const [hover, setHover] = useState<SheetPoint | null>(null);
  const [sheetScale, setSheetScale] = useState<SheetScale | null>(null);
  const [unit, setUnit] = useState<MeasureUnit>("ft");
  const [draft, setDraft] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);
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
      setFit({
        width: img.naturalWidth * ratio,
        height: img.naturalHeight * ratio,
        natural: img.naturalWidth,
        aspect: img.naturalHeight / img.naturalWidth,
      });
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

  // Each sheet keeps its own scale. The trace itself lasts only for this visit.
  useEffect(() => {
    const stored = sheetKey ? readSheetScale(sheetKey) : null;
    setSheetScale(stored);
    setUnit(stored?.unit ?? "ft");
    setPath([]);
    setCalPoints([]);
    setCalibrating(false);
    setHover(null);
    setDraft("");
    setScaleError(null);
  }, [sheetKey]);

  const rememberHover = (point: SheetPoint | null) => {
    setHover((current) => (current?.x === point?.x && current?.y === point?.y ? current : point));
  };
  const pointFromClient = (clientX: number, clientY: number) => {
    const el = frame.current;
    if (!el || !fit) return null;
    const rect = el.getBoundingClientRect();
    return sheetPointFromFrame(
      { x: clientX - rect.left, y: clientY - rect.top },
      { width: el.clientWidth, height: el.clientHeight },
      fit,
      live.current,
    );
  };
  const commitPoint = (point: SheetPoint) => {
    if (calibrating) setCalPoints((points) => (points.length >= 2 ? points : [...points, point]));
    else setPath((points) => (points.length >= 400 ? points : [...points, point]));
    setHover(null);
  };
  const undoPoint = useCallback(() => {
    if (calibrating) setCalPoints((points) => points.slice(0, -1));
    else setPath((points) => points.slice(0, -1));
  }, [calibrating]);
  const changeUnit = (next: MeasureUnit) => {
    setUnit(next);
    setSheetScale((current) => {
      if (!current) return current;
      const converted = convertScale(current, next);
      if (sheetKey) writeSheetScale(sheetKey, converted);
      return converted;
    });
  };
  const applyScale = () => {
    if (!fit || calPoints.length < 2) return;
    const known = parseLength(draft, unit);
    if (known === null) {
      setScaleError("Enter a length like 24'6\" or 7.5.");
      return;
    }
    if (!(known > 0)) {
      setScaleError("Enter a length greater than zero.");
      return;
    }
    const unitsPerSheetWidth = scaleFromKnownLength(calPoints[0]!, calPoints[1]!, fit.aspect, known);
    if (unitsPerSheetWidth === null) {
      setScaleError("Those two points are on top of each other. Tap the two ends of the length.");
      return;
    }
    const next = { unit, unitsPerSheetWidth };
    setSheetScale(next);
    if (sheetKey) writeSheetScale(sheetKey, next);
    setCalPoints([]);
    setCalibrating(false);
    setDraft("");
    setScaleError(null);
  };
  useEffect(() => {
    if (!measuring) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (event.key === "Escape") {
        if (calibrating) {
          setCalibrating(false);
          setCalPoints([]);
          setDraft("");
          setScaleError(null);
        } else setMeasuring(false);
      } else if (!typing && (event.key === "Backspace" || (event.key === "z" && (event.metaKey || event.ctrlKey)))) {
        event.preventDefault();
        undoPoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring, calibrating, undoPoint]);

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
    const transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    if (layer.current) layer.current.style.transform = transform;
    // The sharp PDF canvas sits above the sheet, so the trace is a second
    // layer with the same transform, painted after that canvas.
    if (marks.current) marks.current.style.transform = transform;
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

  const drawn = calibrating ? calPoints : path;
  const rubber =
    hover && ((calibrating && calPoints.length === 1) || (!calibrating && path.length >= 1)) ? hover : null;
  const marked = rubber ? [...drawn, rubber] : drawn;
  const total =
    sheetScale && fit && !calibrating && marked.length >= 2
      ? formatLength(realLength(marked, fit.aspect, sheetScale.unitsPerSheetWidth), sheetScale.unit)
      : null;

  return (
    <div
      ref={frame}
      className={`relative h-full w-full touch-none overflow-hidden bg-muted select-none${measuring ? " cursor-crosshair" : ""}`}
      onPointerDown={(event) => {
        if (measuring && event.button !== 0) return;
        stopAnimation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        velocity.current = { x: 0, y: 0, t: performance.now() };
        startGesture();
        if (pointers.current.size === 1) {
          if (measuring) {
            // A short press drops a point. A drag still pans, and a second finger still pinches.
            measureTap.current = { x: event.clientX, y: event.clientY, moved: false };
            return;
          }
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
        } else if (measureTap.current) measureTap.current.moved = true;
      }}
      onPointerMove={(event) => {
        if (measuring && event.buttons === 0) rememberHover(pointFromClient(event.clientX, event.clientY));
        const previous = pointers.current.get(event.pointerId);
        if (!previous || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const now = [...pointers.current.values()];
        const before = gesture.current.points;
        const base = gesture.current.view;
        if (now.length >= 2 && before.length >= 2) {
          if (measureTap.current) measureTap.current.moved = true;
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
          if (measuring && measureTap.current && !measureTap.current.moved) {
            if (Math.hypot(p.x - measureTap.current.x, p.y - measureTap.current.y) <= MEASURE_TAP_SLOP_PX) {
              rememberHover(pointFromClient(event.clientX, event.clientY));
              return;
            }
            measureTap.current.moved = true;
            rememberHover(null);
            gesture.current = { view: live.current, points: [{ x: p.x, y: p.y }] };
            return;
          }
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
        const tap = measureTap.current;
        const wasSingle = pointers.current.size === 1;
        pointers.current.delete(event.pointerId);
        measureTap.current = null;
        startGesture();
        if (pointers.current.size > 0) return;
        if (measuring && tap && !tap.moved && wasSingle) {
          const point = pointFromClient(event.clientX, event.clientY);
          if (point) commitPoint(point);
          move(live.current, true);
          return;
        }
        // Ignore a stale speed if the finger rested before lifting.
        if (wasSingle && performance.now() - velocity.current.t < 80) glide();
        else move(live.current, true);
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        measureTap.current = null;
        startGesture();
        if (pointers.current.size === 0) move(live.current, true);
      }}
      onPointerLeave={() => {
        if (measuring) rememberHover(null);
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
        {tileLayers.map((item) => (
          // Each level is laid out in its own pixels (whole-number tile
          // positions, exact sizes) and scaled once to the sheet, so tile edges
          // meet exactly at any zoom.
          <div
            key={item.factor}
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: item.width,
              height: item.height,
              transform: `scale(${(fit?.width ?? 0) / item.width}, ${(fit?.height ?? 0) / item.height})`,
            }}
          >
            {item.tiles.map(({ col, row }) => {
              const size = manifest!.tileSize;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${col}_${row}`}
                  src={`${tiles}/${item.factor}/${col}_${row}.webp`}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="absolute opacity-0 transition-opacity duration-200"
                  onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
                  style={{
                    left: col * size,
                    top: row * size,
                    width: Math.min(size, item.width - col * size),
                    height: Math.min(size, item.height - row * size),
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      {pdf && (
        <canvas
          ref={sharp}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150"
          style={{ opacity: needsPdf && !moving && sharpFor === viewKey ? 1 : 0 }}
        />
      )}
      {fit && marked.length > 0 && (
        <div
          ref={marks}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 z-[1] origin-center"
          style={{ width: fit.width, height: fit.height }}
        >
          <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${fit.width} ${fit.height}`}>
            {marked.length >= 2 && (
              <g>
                <polyline
                  points={marked.map((point) => `${point.x * fit.width},${point.y * fit.height}`).join(" ")}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={marked.map((point) => `${point.x * fit.width},${point.y * fit.height}`).join(" ")}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            {marked.map((point, index) => (
              <circle
                key={index}
                cx={point.x * fit.width}
                cy={point.y * fit.height}
                r={Math.max(3, 6 / view.scale)}
                fill="#d97706"
                stroke="#111111"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      )}
      <SheetMeasureBar
        measuring={measuring}
        calibrating={calibrating}
        pointCount={path.length}
        calibrationCount={calPoints.length}
        total={total}
        unit={unit}
        scaleSet={sheetScale !== null}
        draft={draft}
        error={scaleError}
        onToggle={() => {
          setMeasuring((on) => !on);
          setCalibrating(false);
          setCalPoints([]);
          setHover(null);
          setScaleError(null);
        }}
        onUndo={undoPoint}
        onClear={() => {
          setPath([]);
          setHover(null);
        }}
        onStartScale={() => {
          setCalibrating(true);
          setCalPoints([]);
          setDraft("");
          setScaleError(null);
          setHover(null);
        }}
        onCancelScale={() => {
          setCalibrating(false);
          setCalPoints([]);
          setDraft("");
          setScaleError(null);
        }}
        onDraft={(value) => {
          setDraft(value);
          setScaleError(null);
        }}
        onUnit={changeUnit}
        onApply={applyScale}
      />
    </div>
  );
}
