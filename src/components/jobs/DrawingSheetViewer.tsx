"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  isTileManifest,
  planDrawingTiles,
  type TileManifest,
} from "~/lib/drawing-tiles";
import { readPdfSheetScale } from "~/lib/pdf-sheet-scale";
import { loadSnapLines } from "~/lib/pdf-snap-lines";
import {
  formatLengthAs,
  MEASURE_TAP_SLOP_PX,
  parseLengthAs,
  readSheetScale,
  scaleUnitFor,
  snapToAngle,
  realLength,
  scaleFromKnownLength,
  sheetPointFromFrame,
  writeSheetScale,
  type LengthUnit,
  type SheetPoint,
  type SheetScale,
} from "~/lib/sheet-measure";
import { scaleReadMessage } from "~/lib/sheet-scale-text";
import { buildSnapIndex, mergeCollinear, snapToLine, type SnapIndex, type SnapSegment } from "~/lib/sheet-snap";
import { SheetMeasureBar } from "./SheetMeasureBar";
import { DrawingTileLayer } from "./DrawingTileLayer";
import { DrawingPdfLayer } from "./DrawingPdfLayer";
import { DrawingAnnotationLayer } from "./DrawingAnnotationLayer";
import { DrawingDraftToolbar } from "./DrawingDraftToolbar";
import { useDrawingEditor, type DrawingEditorProps } from "./useDrawingEditor";
import { DrawingComparisonLayer, type DrawingComparison } from "./DrawingComparisonLayer";
export type { DrawingEditorProps } from "./useDrawingEditor";

const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
/** A tap this close to a line, in screen pixels, lands on that line. */
const SNAP_PX = 18;
/** A finger can grab an existing point within this screen-space radius. */
const NODE_GRAB_PX = 24;
/** How often tile choices follow the view while it is moving. */
const COMMIT_MS = 50;
type Point = { x: number; y: number };
type MeasureNode = { point: SheetPoint; line: SnapSegment | null };
type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };

/**
 * Pan-and-zoom for one drawing sheet, built like a map:
 * - the saved sheet image shows immediately;
 * - sharper tiles (2× and 4×) load for just the visible area, with the next
 *   level down kept underneath so nothing is ever blank;
 * - beyond the deepest tiles (or before tiles exist) the visible area is
 *   redrawn from the original PDF, retaining sharp pixels through gestures.
 * Movement is applied straight to the layer once per frame, with momentum.
 * Measure mode traces points on the sheet and totals the real distance once the
 * printed scale has been read. A tap near a straight line in the
 * PDF, including a dashed grid, lands on that line. Give it a `key` per sheet
 * so each sheet opens unzoomed.
 */
/** Holding this long while measuring picks up the point to slide it. */
const MEASURE_HOLD_MS = 250;
const LOUPE_PX = 128;
const LOUPE_ZOOM = 2.5;
const LOUPE_GAP_PX = 56;

export function DrawingSheetViewer({
  src,
  alt,
  pdf,
  tiles,
  sheetKey,
  comparison,
  resolveAssetUrl,
  navigateTo,
  onViewportChange,
  ...editorProps
}: DrawingEditorProps & {
  src: string;
  alt: string;
  pdf?: { url: string; page: number } | null;
  /** Folder holding manifest.json and <factor>/<col>_<row>.webp tiles. */
  tiles?: string | null;
  /** Remembers this sheet's scale on this computer. */
  sheetKey?: string;
  comparison?: DrawingComparison;
  resolveAssetUrl?: (url: string) => Promise<string>;
  navigateTo?: { center: SheetPoint; zoom: number; requestId: string } | null;
  onViewportChange?: (viewport: { center: SheetPoint; zoom: number }) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; natural: number; aspect: number } | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  // `live` follows every pointer move; `view` is committed for tiles/redraws.
  const live = useRef<View>(REST);
  const [view, setView] = useState<View>(REST);
  const [moving, setMoving] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | null>(null);
  const measureTap = useRef<{ x: number; y: number; moved: boolean; holding?: boolean } | null>(null);
  // Press and hold while measuring: the point follows the finger (snapping to
  // lines) with a magnifier above the thumb; lifting sets it.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const loupeCanvas = useRef<HTMLCanvasElement>(null);
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (measureTap.current) measureTap.current.holding = false;
    setLoupe(null);
  };
  const [measuring, setMeasuring] = useState(false);
  const markId = `measure-${useId().replace(/:/g, "")}`;
  const [calibrating, setCalibrating] = useState(false);
  const [trace, setTrace] = useState<MeasureNode[]>([]);
  const path = trace.map(({ point }) => point);
  const [calNodes, setCalNodes] = useState<MeasureNode[]>([]);
  const calPoints = calNodes.map(({ point }) => point);
  const nodeDrag = useRef<{ pointerId: number; index: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<SheetPoint | null>(null);
  const [snapLine, setSnapLine] = useState<SnapSegment | null>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex | null>(null);
  const snapSegments = useRef<SnapSegment[] | null>(null);
  const snapKey = useRef<string | null>(null);
  const [localSheetScale, setLocalSheetScale] = useState<SheetScale | null>(null);
  // An explicit null is authoritative: this shared sheet has not been calibrated.
  const controlledScale = editorProps.sharedScale !== undefined;
  const sheetScale = editorProps.sharedScale === undefined ? localSheetScale : editorProps.sharedScale;
  // The unit lengths are typed and shown in (m, mm, in, ft). The shared scale
  // itself stays in meters or feet.
  const [unit, setUnit] = useState<LengthUnit>("ft");
  // The next measuring or calibration point locked square (90°) or at 45°.
  const [angleSnap, setAngleSnap] = useState<45 | 90 | null>(null);
  const [draft, setDraft] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);
  const [readingScale, setReadingScale] = useState(false);
  const [scaleReadError, setScaleReadError] = useState<string | null>(null);
  const scaleRead = useRef(0);
  const seenSheet = useRef(sheetKey);
  if (seenSheet.current !== sheetKey) {
    seenSheet.current = sheetKey;
    scaleRead.current += 1;
  }
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const panTap = useRef<{ time: number; x: number; y: number; moved: boolean } | null>(null);
  const quickZoom = useRef<{ pointerId: number; y: number; anchor: Point; view: View; moved: boolean } | null>(null);
  const frameRequest = useRef(0);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef(0);
  const velocity = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  const editor = useDrawingEditor({ ...editorProps, sourceSheetId: editorProps.sourceSheetId ?? sheetKey, sharedScale: sheetScale }, fit?.aspect ?? 1, (fit?.width ?? 1) * live.current.scale);
  const viewportListener = useRef(onViewportChange);
  viewportListener.current = onViewportChange;
  const annotationTool = editorProps.tool ?? "pan";
  useEffect(() => { setMeasuring(false); setCalibrating(false); }, [annotationTool]);
  useEffect(() => {
    nodeDrag.current = null;
    setDragIndex(null);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    measureTap.current = null;
    setLoupe(null);
    setHover(null);
    setSnapLine(null);
    setAngleSnap(null);
  }, [measuring, calibrating, sheetKey]);


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

  // Tiles can finish generating after this sheet was opened. Retry missing
  // manifests without requiring navigation away; PDF rendering remains usable.
  useEffect(() => {
    setManifest(null);
    if (!tiles) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const retryDelays = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000];
    const load = async () => {
      try {
        const manifestUrl = `${tiles}/manifest.json`;
        const response = await fetch(resolveAssetUrl ? await resolveAssetUrl(manifestUrl) : manifestUrl, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.ok) {
          const value: unknown = await response.json();
          if (isTileManifest(value)) {
            if (!controller.signal.aborted) setManifest(value);
            return;
          }
        }
        // Authentication failures will not improve by polling.
        if (response.status === 401 || response.status === 403) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      const delay = retryDelays[attempt++];
      if (!controller.signal.aborted && delay !== undefined) timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tiles, resolveAssetUrl]);

  // Each sheet keeps its own scale. The trace itself lasts only for this visit.
  useEffect(() => {
    const stored = !controlledScale && sheetKey ? readSheetScale(sheetKey) : null;
    if (!controlledScale) setLocalSheetScale(stored);
    setUnit(stored?.unit ?? "ft");
    setTrace([]);
    setAngleSnap(null);
    setCalNodes([]);
    setCalibrating(false);
    setHover(null);
    setSnapLine(null);
    setDraft("");
    setScaleError(null);
    setScaleReadError(null);
    setReadingScale(false);
  }, [sheetKey, controlledScale]);

  useEffect(() => {
    const shared = editorProps.sharedScale;
    // Keep a chosen mm/in when the scale is in the same system.
    if (shared !== undefined)
      setUnit((current) => (scaleUnitFor(current) === shared?.unit ? current : shared?.unit ?? "ft"));
  }, [editorProps.sharedScale, sheetKey]);

  // Read the drawing's lines once, when measuring starts. Taps stay free until they arrive.
  // Depend on the url and page, not the object: the parent builds a new object on every render.
  const pdfUrl = pdf?.url;
  const pdfPage = pdf?.page;
  useEffect(() => {
    if (!pdfUrl || pdfPage == null) return;
    if (!measuring) return;
    const key = `${pdfUrl}#${pdfPage}`;
    if (snapKey.current === key && snapSegments.current) return;
    if (snapKey.current !== key) {
      snapSegments.current = null;
      snapKey.current = null;
      setSnapIndex(null);
      setSnapLine(null);
      setCalNodes((nodes) => nodes.map((node) => ({ ...node, line: null })));
      setTrace((nodes) => nodes.map((node) => ({ ...node, line: null })));
    }
    let cancelled = false;
    void loadSnapLines({ url: pdfUrl, page: pdfPage })
      .then((segments) => {
        if (cancelled) return;
        snapKey.current = key;
        snapSegments.current = segments;
        const aspect = fitRef.current?.aspect;
        if (aspect && aspect > 0) setSnapIndex(buildSnapIndex(mergeCollinear(segments, aspect), aspect));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [measuring, pdfUrl, pdfPage]);

  useEffect(() => {
    const segments = snapSegments.current;
    const aspect = fit?.aspect;
    if (!segments || !(aspect && aspect > 0)) return;
    setSnapIndex(buildSnapIndex(mergeCollinear(segments, aspect), aspect));
  }, [fit?.aspect]);

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
  const rememberLine = (segment: SnapSegment | null) => {
    setSnapLine((current) =>
      current === segment ||
      (current !== null &&
        segment !== null &&
        current.x1 === segment.x1 &&
        current.y1 === segment.y1 &&
        current.x2 === segment.x2 &&
        current.y2 === segment.y2)
        ? current
        : segment,
    );
  };
  const aimFromClient = (clientX: number, clientY: number, movingNode?: number): { point: SheetPoint; segment: SnapSegment | null; angle?: 45 | 90 } | null => {
    const point = pointFromClient(clientX, clientY);
    if (!point) return null;
    // Moving the first node uses its next neighbor; all others use the previous.
    const nodes = calibrating ? calNodes : trace;
    const anchorNode = movingNode !== undefined
      ? nodes[movingNode === 0 ? 1 : movingNode - 1]
      : calibrating ? nodes.length === 1 ? nodes[0] : undefined : nodes.at(-1);
    const anchor = anchorNode?.point;
    const reference = anchorNode?.line ?? null;
    const shown = fit ? fit.width * live.current.scale : 0;
    const hit = snapIndex && shown > 0
      ? snapToLine(point, snapIndex, SNAP_PX / shown, anchor ? reference : null)
      : null;
    if (anchor && fit) {
      const angled = snapToAngle(anchor, hit?.point ?? point, fit.aspect, reference, hit?.segment ?? null);
      if (angled) return { point: angled.point, segment: hit?.segment ?? null, angle: angled.angle };
    }
    return hit ? { point: hit.point, segment: hit.segment } : { point, segment: null };
  };
  const rememberAim = (clientX: number, clientY: number, movingNode?: number) => {
    const aim = aimFromClient(clientX, clientY, movingNode);
    rememberHover(aim?.point ?? null);
    rememberLine(aim?.segment ?? null);
    const angle = aim?.angle ?? null;
    setAngleSnap((current) => (current === angle ? current : angle));
  };
  const clearAim = () => {
    rememberHover(null);
    rememberLine(null);
    setAngleSnap(null);
  };
  // Keep the saved geometry untouched until release, so Cancel/pinch can roll back.
  const cancelNodeDrag = () => {
    nodeDrag.current = null;
    setDragIndex(null);
    endHold();
    clearAim();
  };
  const nodeAtClient = (clientX: number, clientY: number) => {
    const el = frame.current;
    if (!el || !fit) return null;
    const rect = el.getBoundingClientRect();
    const nodes = calibrating ? calNodes : trace;
    const current = live.current;
    let closest: number | null = null;
    let distance = NODE_GRAB_PX;
    for (let i = 0; i < nodes.length; i++) {
      const point = nodes[i]!.point;
      const x = rect.left + el.clientWidth / 2 + current.x + (point.x - 0.5) * fit.width * current.scale;
      const y = rect.top + el.clientHeight / 2 + current.y + (point.y - 0.5) * fit.height * current.scale;
      const away = Math.hypot(clientX - x, clientY - y);
      if (away <= distance) { closest = i; distance = away; }
    }
    return closest;
  };
  const commitPoint = (point: SheetPoint, segment: SnapSegment | null) => {
    if (calibrating) {
      setCalNodes((points) => (points.length >= 2 ? points : [...points, { point, line: segment }]));
    } else setTrace((points) => (points.length >= 400 ? points : [...points, { point, line: segment }]));
    setHover(null);
    setSnapLine(null);
    setAngleSnap(null);
  };
  const undoPoint = useCallback(() => {
    nodeDrag.current = null;
    setDragIndex(null);
    setLoupe(null);
    if (calibrating) {
      setCalNodes((points) => points.slice(0, -1));
    } else setTrace((points) => points.slice(0, -1));
    setHover(null);
    setSnapLine(null);
    setAngleSnap(null);
  }, [calibrating]);
  const proposeScale = (next: SheetScale) => {
    if (!controlledScale) {
      setLocalSheetScale(next);
      setUnit((current) => (scaleUnitFor(current) === next.unit ? current : next.unit));
      if (sheetKey) writeSheetScale(sheetKey, next);
    }
    editorProps.onScaleChange?.(next);
  };
  // Changing the unit only changes how lengths are typed and shown here.
  const changeUnit = (next: LengthUnit) => setUnit(next);
  const beginLengthScale = () => {
    clearAim();
    setCalibrating(true);
    setCalNodes([]);
    setDraft("");
    setScaleError(null);
    setScaleReadError(null);
  };
  const readPrintedScale = () => {
    if (!pdfUrl || pdfPage == null) {
      beginLengthScale();
      return;
    }
    const request = ++scaleRead.current;
    setScaleReadError(null);
    setReadingScale(true);
    void readPdfSheetScale({ url: pdfUrl, page: pdfPage })
      .then((result) => {
        if (scaleRead.current !== request) return;
        if (!result.ok) {
          setScaleReadError(scaleReadMessage(result));
          return;
        }
        proposeScale(result.scale);
        setCalibrating(false);
        setCalNodes([]);
        setDraft("");
        setScaleError(null);
      })
      .catch(() => {
        if (scaleRead.current !== request) return;
        setScaleReadError(scaleReadMessage({ ok: false, reason: "none" }));
      })
      .finally(() => {
        if (scaleRead.current === request) setReadingScale(false);
      });
  };
  const applyScale = () => {
    if (!fit || calPoints.length < 2) return;
    const parsed = parseLengthAs(draft, unit);
    const known = parsed?.length ?? null;
    if (known === null || !parsed) {
      setScaleError(`Enter a length in ${unit}, like ${unit === "ft" ? "24'6\"" : unit === "in" ? "18" : unit === "mm" ? "7500" : "7.5"}.`);
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
    const next = { unit: parsed.unit, unitsPerSheetWidth };
    proposeScale(next);
    setCalNodes([]);
    setCalibrating(false);
    setDraft("");
    setScaleError(null);
    setScaleReadError(null);
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
          setCalNodes([]);
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
    // Measurements stay above the image, tiles and persistent PDF patches.
    if (marks.current) marks.current.style.transform = transform;
  };
  /** Moves the sheet now (next frame) and lets tiles catch up shortly after. */
  const move = (next: View, settle = false) => {
    live.current = clamp(next);
    frameRequest.current ||= requestAnimationFrame(paint);
    setMoving(!settle);
    if (settle) {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
      commitTimer.current = null;
      wheelSettleTimer.current = null;
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
      if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
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

  useEffect(() => {
    if (!navigateTo || !fit) return;
    stopAnimation();
    move({ scale: navigateTo.zoom, x: (0.5 - navigateTo.center.x) * fit.width * navigateTo.zoom, y: (0.5 - navigateTo.center.y) * fit.height * navigateTo.zoom }, true);
    // A unique request makes selecting the same bookmark again intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTo?.requestId, fit?.width, fit?.height]);
  useEffect(() => {
    if (!fit) return;
    viewportListener.current?.({ center: {
      x: Math.min(1, Math.max(0, 0.5 - view.x / (fit.width * view.scale))),
      y: Math.min(1, Math.max(0, 0.5 - view.y / (fit.height * view.scale))),
    }, zoom: view.scale });
  }, [view, fit]);

  // Geometry of the committed view.
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  const shownWidth = fit ? fit.width * view.scale : 0;
  const shownHeight = fit ? fit.height * view.scale : 0;
  const left = frameSize.width / 2 + view.x - shownWidth / 2;
  const top = frameSize.height / 2 + view.y - shownHeight / 2;
  const density = fit ? (shownWidth / fit.natural) * dpr : 1; // screen px per saved-image px
  const deepest = manifest?.levels.reduce((a, b) => Math.max(a, b.factor), 1) ?? 1;
  const visible = shownWidth
    ? {
        left: -left / shownWidth,
        top: -top / shownHeight,
        right: (frameSize.width - left) / shownWidth,
        bottom: (frameSize.height - top) / shownHeight,
      }
    : null;
  const tileRequests = manifest && tiles && visible
    ? planDrawingTiles(tiles, manifest, density, visible)
    : [];
  // Beyond pre-rendered tiles, add a viewport-sized PDF patch. It lives inside
  // the same transform as the tiles, so already-sharp pixels keep moving.
  const needsPdf = Boolean(pdf) && fit !== null && (!manifest ? density > 1.05 : density > deepest * 1.05);

  const savedPoints = calibrating ? calPoints : path;
  const drawn = dragIndex !== null && hover
    ? savedPoints.map((point, index) => index === dragIndex ? hover : point)
    : savedPoints;
  const rubber =
    dragIndex === null && hover && ((calibrating && calPoints.length === 1) || (!calibrating && path.length >= 1)) ? hover : null;
  const marked = rubber ? [...drawn, rubber] : drawn;
  // The measuring line and X marks are sized in sheet units (like the
  // drawing's gridlines) so they zoom with it, but never thinner than about a
  // screen pixel or smaller than ~10px across when zoomed out.
  const markStroke = Math.max(0.08, 1.1 / view.scale);
  const markArm = Math.max(0.6, 5 / view.scale);
  const lockedAngle = rubber || dragIndex !== null ? angleSnap : null;
  const anglePair = dragIndex !== null
    ? [drawn[dragIndex === 0 ? 1 : dragIndex - 1], drawn[dragIndex]]
    : [marked.at(-2), marked.at(-1)];

  // Paint the magnifier from what is on screen: the saved image, any sharper
  // tiles and the PDF redraw, at LOUPE_ZOOM around the aimed point.
  useEffect(() => {
    const canvas = loupeCanvas.current;
    const sheet = layer.current;
    if (!loupe || !canvas || !sheet) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(LOUPE_PX * dpr);
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const box = sheet.getBoundingClientRect();
    const toClient = (point: SheetPoint) => ({
      x: box.left + point.x * box.width,
      y: box.top + point.y * box.height,
    });
    const centre = hover ? toClient(hover) : loupe;
    const reach = LOUPE_PX / 2 / LOUPE_ZOOM;
    const src = { left: centre.x - reach, top: centre.y - reach, right: centre.x + reach, bottom: centre.y + reach };
    const k = LOUPE_ZOOM * dpr;
    const map = (c: { x: number; y: number }) => ({ x: (c.x - src.left) * k, y: (c.y - src.top) * k });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    for (const el of sheet.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas")) {
      const r = el.getBoundingClientRect();
      const l = Math.max(r.left, src.left), t = Math.max(r.top, src.top);
      const rr = Math.min(r.right, src.right), b = Math.min(r.bottom, src.bottom);
      if (rr <= l || b <= t || r.width <= 0 || r.height <= 0) continue;
      const image = el instanceof HTMLImageElement;
      if (image && !el.complete) continue;
      const nw = image ? el.naturalWidth : el.width;
      const nh = image ? el.naturalHeight : el.height;
      if (!nw || !nh) continue;
      const style = getComputedStyle(el);
      if (style.opacity === "0" || style.visibility === "hidden" || style.display === "none") continue;
      try {
        ctx.drawImage(
          el,
          ((l - r.left) * nw) / r.width,
          ((t - r.top) * nh) / r.height,
          ((rr - l) * nw) / r.width,
          ((b - t) * nh) / r.height,
          (l - src.left) * k,
          (t - src.top) * k,
          (rr - l) * k,
          (b - t) * k,
        );
      } catch {
        // An image that cannot be drawn is simply left out of the magnifier.
      }
    }
    const strokeLine = (a: { x: number; y: number }, z: { x: number; y: number }, colour: string, width: number) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(z.x, z.y);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.stroke();
    };
    if (snapLine) {
      strokeLine(
        map(toClient({ x: snapLine.x1, y: snapLine.y1 })),
        map(toClient({ x: snapLine.x2, y: snapLine.y2 })),
        "rgba(34, 211, 238, 0.85)",
        1.5 * dpr,
      );
    }
    for (let i = 1; i < marked.length; i++) {
      strokeLine(
        map(toClient(marked[i - 1]!)),
        map(toClient(marked[i]!)),
        lockedAngle ? "rgba(22, 163, 74, 0.95)" : "rgba(217, 119, 6, 0.9)",
        (lockedAngle ? 2.5 : 1.5) * dpr,
      );
    }
    if (lockedAngle) {
      ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#15803d";
      ctx.strokeText(`${lockedAngle}°`, 6 * dpr, 16 * dpr);
      ctx.fillText(`${lockedAngle}°`, 6 * dpr, 16 * dpr);
    }
    const c = map(centre);
    const arm = 10 * dpr;
    for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
      strokeLine({ x: c.x - dx * arm, y: c.y - dy * arm }, { x: c.x + dx * arm, y: c.y + dy * arm }, "rgba(255,255,255,0.8)", 3.5 * dpr);
      strokeLine({ x: c.x - dx * arm, y: c.y - dy * arm }, { x: c.x + dx * arm, y: c.y + dy * arm }, "#b45309", 1.5 * dpr);
    }
  });
  const snapMark = Math.max(1.2, 8 / view.scale);
  const total =
    sheetScale && fit && !calibrating && marked.length >= 2
      ? formatLengthAs(realLength(marked, fit.aspect, sheetScale.unitsPerSheetWidth), sheetScale.unit, unit)
      : null;

  return (
    <div
      ref={frame}
      className={`relative h-full w-full touch-none overflow-hidden bg-muted select-none [&_img]:pointer-events-none${measuring ? dragIndex !== null ? " cursor-grabbing" : " cursor-crosshair" : ""}`}
      // No phone long-press menu (copy/save image, open link) on the drawing:
      // long presses are for working on the sheet.
      style={{ WebkitTouchCallout: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (measuring && event.button !== 0) return;
        stopAnimation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        velocity.current = { x: 0, y: 0, t: performance.now() };
        startGesture();
        if (pointers.current.size > 1) {
          if (nodeDrag.current) cancelNodeDrag();
          editor.cancelGesture();
          quickZoom.current = null;
          panTap.current = null;
          lastTap.current = null;
        }
        if (!measuring && pointers.current.size === 1 && editor.down(pointFromClient(event.clientX, event.clientY), event.target)) {
          lastTap.current = null;
          return;
        }
        if (pointers.current.size === 1) {
          if (measuring) {
            const index = nodeAtClient(event.clientX, event.clientY);
            if (index !== null) {
              endHold();
              measureTap.current = null;
              nodeDrag.current = { pointerId: event.pointerId, index, x: event.clientX, y: event.clientY, moved: false };
              setDragIndex(index);
              clearAim();
              setHover((calibrating ? calNodes : trace)[index]!.point);
              setLoupe({ x: event.clientX, y: event.clientY });
              return;
            }
            // A short press drops a point. Holding still lets the point be slid
            // into place with a magnifier. A drag still pans, and a second
            // finger still pinches.
            measureTap.current = { x: event.clientX, y: event.clientY, moved: false };
            if (holdTimer.current) clearTimeout(holdTimer.current);
            holdTimer.current = setTimeout(() => {
              holdTimer.current = null;
              const tap = measureTap.current;
              const finger = [...pointers.current.values()][0];
              if (!tap || tap.moved || pointers.current.size !== 1 || !finger) return;
              tap.holding = true;
              navigator.vibrate?.(8);
              rememberAim(finger.x, finger.y);
              setLoupe({ x: finger.x, y: finger.y });
            }, MEASURE_HOLD_MS);
            return;
          }
          const now = Date.now();
          const previousTap = lastTap.current;
          lastTap.current = null;
          if (previousTap && now - previousTap.time < 300 &&
              Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 32) {
            // Wait for release before step-zooming: dragging the second press
            // instead controls zoom continuously around its original position.
            quickZoom.current = { pointerId: event.pointerId, y: event.clientY,
              anchor: fromCentre(event.clientX, event.clientY), view: live.current, moved: false };
            panTap.current = null;
          } else {
            panTap.current = { time: now, x: event.clientX, y: event.clientY, moved: false };
          }
        } else if (measureTap.current) {
          measureTap.current.moved = true;
          endHold();
        }
      }}
      onPointerMove={(event) => {
        if (measuring && event.buttons === 0 && !nodeDrag.current) rememberAim(event.clientX, event.clientY);
        const previous = pointers.current.get(event.pointerId);
        if (!previous || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const drag = nodeDrag.current;
        if (drag?.pointerId === event.pointerId && pointers.current.size === 1) {
          drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 2;
          if (drag.moved) rememberAim(event.clientX, event.clientY, drag.index);
          setLoupe({ x: event.clientX, y: event.clientY });
          return;
        }
        const zoom = quickZoom.current;
        if (zoom?.pointerId === event.pointerId && pointers.current.size === 1) {
          const dy = event.clientY - zoom.y;
          zoom.moved ||= Math.abs(dy) > 6;
          if (zoom.moved) move(zoomAt(zoom.view, Math.exp(dy * 0.008), zoom.anchor));
          return;
        }
        if (panTap.current && Math.hypot(event.clientX - panTap.current.x, event.clientY - panTap.current.y) > 6) {
          panTap.current.moved = true;
        }
        const now = [...pointers.current.values()];
        const before = gesture.current.points;
        const base = gesture.current.view;
        if (now.length >= 2 && before.length >= 2) {
          if (measureTap.current) measureTap.current.moved = true;
          if (loupe) endHold();
          const a = now[0]!, b = now[1]!;
          const a0 = before[0]!, b0 = before[1]!;
          const factor =
            Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
          const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
          const mid0 = fromCentre((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
          const zoomed = zoomAt(base, factor, mid0);
          move({ ...zoomed, x: zoomed.x + mid.x - mid0.x, y: zoomed.y + mid.y - mid0.y });
        } else if (now.length === 1 && before[0]) {
          if (!measuring && editor.move(pointFromClient(event.clientX, event.clientY))) return;
          const p = now[0]!;
          if (measuring && measureTap.current?.holding) {
            rememberAim(event.clientX, event.clientY);
            setLoupe({ x: event.clientX, y: event.clientY });
            return;
          }
          if (measuring && measureTap.current && !measureTap.current.moved) {
            if (Math.hypot(p.x - measureTap.current.x, p.y - measureTap.current.y) <= MEASURE_TAP_SLOP_PX) {
              rememberAim(event.clientX, event.clientY);
              return;
            }
            measureTap.current.moved = true;
            clearAim();
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
        if (!pointers.current.has(event.pointerId)) return;
        const drag = nodeDrag.current;
        if (drag?.pointerId === event.pointerId) {
          const moved = drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 2;
          const aim = moved ? aimFromClient(event.clientX, event.clientY, drag.index) : null;
          if (aim) {
            const replace = (nodes: MeasureNode[]) => nodes.map((node, index) => index === drag.index ? { point: aim.point, line: aim.segment } : node);
            if (calibrating) setCalNodes(replace);
            else setTrace(replace);
          }
          pointers.current.delete(event.pointerId);
          cancelNodeDrag();
          startGesture();
          move(live.current, true);
          return;
        }
        const zoom = quickZoom.current;
        if (zoom?.pointerId === event.pointerId) {
          pointers.current.delete(event.pointerId);
          quickZoom.current = null;
          startGesture();
          if (zoom.moved) move(zoomAt(zoom.view, Math.exp((event.clientY - zoom.y) * 0.008), zoom.anchor), true);
          else animateTo(zoom.view.scale > 1.5 ? REST : zoomAt(zoom.view, 3, zoom.anchor));
          return;
        }
        const candidate = panTap.current;
        lastTap.current = candidate && !candidate.moved && Date.now() - candidate.time < 300 &&
          Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) <= 6
          ? { time: Date.now(), x: event.clientX, y: event.clientY } : null;
        panTap.current = null;
        const tap = measureTap.current;
        const wasSingle = pointers.current.size === 1;
        const edited = !measuring && wasSingle && editor.up(pointFromClient(event.clientX, event.clientY));
        pointers.current.delete(event.pointerId);
        measureTap.current = null;
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = null;
        setLoupe(null);
        startGesture();
        if (pointers.current.size > 0) return;
        if (edited) { move(live.current, true); return; }
        if (measuring && tap && !tap.moved && wasSingle) {
          const aim = aimFromClient(event.clientX, event.clientY);
          if (aim) commitPoint(aim.point, aim.segment);
          move(live.current, true);
          return;
        }
        // Ignore a stale speed if the finger rested before lifting.
        if (wasSingle && performance.now() - velocity.current.t < 80) glide();
        else move(live.current, true);
      }}
      onPointerCancel={(event) => {
        if (nodeDrag.current) cancelNodeDrag();
        editor.cancelGesture();
        quickZoom.current = null;
        panTap.current = null;
        lastTap.current = null;
        pointers.current.delete(event.pointerId);
        endHold();
        measureTap.current = null;
        startGesture();
        if (pointers.current.size === 0) move(live.current, true);
      }}
      onPointerLeave={() => {
        if (measuring && !nodeDrag.current) clearAim();
      }}
      onWheel={(event) => {
        stopAnimation();
        move(zoomAt(live.current, Math.exp(-event.deltaY * 0.0015), fromCentre(event.clientX, event.clientY)));
        if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
        wheelSettleTimer.current = setTimeout(() => {
          wheelSettleTimer.current = null;
          move(live.current, true);
        }, 80);
      }}
    >
      <div
        ref={layer}
        className="absolute top-1/2 left-1/2 origin-center will-change-transform"
        style={{ width: fit?.width, height: fit?.height, visibility: fit ? "visible" : "hidden" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} src={src} alt={alt} draggable={false} className="absolute inset-0 h-full w-full" />
        <DrawingTileLayer key={tiles ?? src} requests={tileRequests} resolveAssetUrl={resolveAssetUrl} />
        {pdf && fit && (
          <DrawingPdfLayer
            pdf={pdf}
            fit={fit}
            frameSize={frameSize}
            view={view}
            dpr={dpr}
            enabled={needsPdf}
            moving={moving}
          />
        )}
        {comparison && fit && <DrawingComparisonLayer primary={{ src, pdf }} comparison={comparison} fit={fit} frameSize={frameSize} view={view} dpr={dpr} />}
        {fit && <DrawingAnnotationLayer annotations={editorProps.annotations ?? []} aspect={fit.aspect} selectedId={editorProps.selectedId} draft={measuring ? null : editor.draft} editing={editor.editing} hidden={editorProps.hideAnnotations} sharedScale={sheetScale} onSelect={editorProps.onSelect} screenPixelSize={1000 / (fit.width * view.scale)} showResizeHandles={!measuring && annotationTool === "select" && editorProps.selectionMode !== "move" && Boolean(editorProps.onUpdate)} canEditAnnotation={editorProps.canEditAnnotation} />}
      </div>
      {fit && (marked.length > 0 || snapLine) && (
        <div
          ref={marks}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 z-[1] origin-center"
          style={{ width: fit.width, height: fit.height }}
        >
          <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${fit.width} ${fit.height}`}>
            {snapLine && (
              <g>
                <line
                  x1={snapLine.x1 * fit.width}
                  y1={snapLine.y1 * fit.height}
                  x2={snapLine.x2 * fit.width}
                  y2={snapLine.y2 * fit.height}
                  stroke="#ffffff"
                  strokeOpacity={0.6}
                  strokeWidth={markStroke * 2.2}
                  strokeLinecap="round"
                />
                <line
                  x1={snapLine.x1 * fit.width}
                  y1={snapLine.y1 * fit.height}
                  x2={snapLine.x2 * fit.width}
                  y2={snapLine.y2 * fit.height}
                  stroke="#22d3ee"
                  strokeOpacity={0.85}
                  strokeWidth={markStroke}
                  strokeLinecap="round"
                />
              </g>
            )}
            {snapLine && hover && (
              <rect
                x={hover.x * fit.width - snapMark / 2}
                y={hover.y * fit.height - snapMark / 2}
                width={snapMark}
                height={snapMark}
                fill="none"
                stroke="#22d3ee"
                strokeWidth={markStroke}
              />
            )}
            {marked.length >= 2 && (
              <>
                {/* A thin line that fades out just before each point, so it
                    never covers the spot under an X. */}
                <defs>
                  <radialGradient id={`${markId}-fade`}>
                    <stop offset="0.45" stopColor="#000000" />
                    <stop offset="1" stopColor="#ffffff" />
                  </radialGradient>
                  <mask
                    id={`${markId}-ends`}
                    maskUnits="userSpaceOnUse"
                    x={-fit.width}
                    y={-fit.height}
                    width={fit.width * 3}
                    height={fit.height * 3}
                  >
                    <rect x={-fit.width} y={-fit.height} width={fit.width * 3} height={fit.height * 3} fill="#ffffff" />
                    {marked.map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x * fit.width}
                        cy={point.y * fit.height}
                        r={markArm * 1.8}
                        fill={`url(#${markId}-fade)`}
                      />
                    ))}
                  </mask>
                </defs>
                <g mask={`url(#${markId}-ends)`}>
                  <polyline
                    points={marked.map((point) => `${point.x * fit.width},${point.y * fit.height}`).join(" ")}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={0.6}
                    strokeWidth={markStroke * 2.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <polyline
                    points={marked.map((point) => `${point.x * fit.width},${point.y * fit.height}`).join(" ")}
                    fill="none"
                    stroke={lockedAngle ? "#16a34a" : "#d97706"}
                    strokeWidth={lockedAngle ? markStroke * 1.6 : markStroke}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
                {lockedAngle && anglePair[0] && anglePair[1] && (() => {
                  // Square or 45°: say so next to the middle of the line.
                  const a = anglePair[0], b = anglePair[1];
                  const size = Math.max(2.2, 13 / view.scale);
                  return (
                    <text
                      x={((a.x + b.x) / 2) * fit.width + size * 0.6}
                      y={((a.y + b.y) / 2) * fit.height - size * 0.6}
                      fontSize={size}
                      fontWeight={700}
                      fill="#15803d"
                      stroke="#ffffff"
                      strokeWidth={size * 0.25}
                      paintOrder="stroke"
                    >
                      {lockedAngle}°
                    </text>
                  );
                })()}
              </>
            )}
            {/* End points are thin, semi-transparent X marks so they can be
                placed precisely and the linework under them stays visible. */}
            {marked.map((point, index) => {
              const cx = point.x * fit.width;
              const cy = point.y * fit.height;
              const arm = markArm;
              return (
                <g key={index} data-measure-node={index < drawn.length ? index : undefined} opacity={dragIndex === index ? 1 : 0.6}>
                  {[
                    [-1, -1, 1, 1],
                    [-1, 1, 1, -1],
                  ].map(([ax, ay, bx, by], stroke) => (
                    <g key={stroke}>
                      <line
                        x1={cx + ax! * arm}
                        y1={cy + ay! * arm}
                        x2={cx + bx! * arm}
                        y2={cy + by! * arm}
                        stroke="#ffffff"
                        strokeOpacity={0.6}
                        strokeWidth={markStroke * 2.2}
                        strokeLinecap="round"
                      />
                      <line
                        x1={cx + ax! * arm}
                        y1={cy + ay! * arm}
                        x2={cx + bx! * arm}
                        y2={cy + by! * arm}
                        stroke="#b45309"
                        strokeWidth={markStroke}
                        strokeLinecap="round"
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {!measuring && <DrawingDraftToolbar tool={annotationTool} count={editor.pointCount} canFinish={editor.canFinish} onUndo={editor.undo} onCancel={editor.clear} onFinish={editor.finish} />}
      {loupe && fit && frame.current && (() => {
        const box = frame.current.getBoundingClientRect();
        const half = LOUPE_PX / 2;
        // Above the thumb; below it when there is no room at the top.
        const above = loupe.y - box.top - LOUPE_GAP_PX - half;
        const top = above - half >= 8 ? above : loupe.y - box.top + LOUPE_GAP_PX + half;
        const left = Math.min(Math.max(loupe.x - box.left, half + 8), box.width - half - 8);
        return (
          <canvas
            ref={loupeCanvas}
            aria-hidden="true"
            className="pointer-events-none absolute z-30 rounded-full border-2 border-white bg-white shadow-[0_4px_16px_rgba(0,0,0,0.45)] ring-1 ring-black/30"
            style={{ width: LOUPE_PX, height: LOUPE_PX, left: left - half, top: top - half }}
          />
        );
      })()}
      <SheetMeasureBar
        measuring={measuring}
        calibrating={calibrating}
        pointCount={path.length}
        calibrationCount={calPoints.length}
        total={total}
        unit={unit}
        scaleSet={sheetScale !== null}
        snapping={Boolean(snapIndex && snapIndex.segments.length > 0)}
        draft={draft}
        error={scaleError}
        reading={readingScale}
        scaleLabel={sheetScale?.label}
        readError={scaleReadError}
        onToggle={() => {
          clearAim();
          setMeasuring((on) => !on);
          setCalibrating(false);
          setCalNodes([]);
          setScaleError(null);
          setScaleReadError(null);
        }}
        onUndo={undoPoint}
        onClear={() => {
          cancelNodeDrag();
          setTrace([]);
        }}
        onStartScale={beginLengthScale}
        onReadPrinted={pdfUrl && pdfPage != null ? readPrintedScale : undefined}
        onCancelScale={() => {
          clearAim();
          setCalibrating(false);
          setCalNodes([]);
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
