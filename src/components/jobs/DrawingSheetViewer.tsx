"use client";
import { DrawingMeasureNode } from "./DrawingMeasureNode";
import { SNAPSHOT_FREEZE_EVENT } from "~/lib/snapshot-source";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  isTileManifest,
  planDrawingTiles,
  type TileManifest,
} from "~/lib/drawing-tiles";
import { readPdfSheetScale } from "~/lib/pdf-sheet-scale";
import { drawingVectorViewBox } from "~/lib/drawing-viewport";
import { buildDrawingSnapIndex } from "~/lib/drawing-geometry-client";
import { loadSnapLines } from "~/lib/pdf-snap-lines";
import {
  formatLengthAs,
  convertScale,
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
import {
  DEFAULT_MEASURE_COLOR,
  measureColorHalo,
  readMeasureColor,
  validMeasureColor,
  writeMeasureColor,
} from "~/lib/sheet-measure-color";
import { DrawingAppearanceFilter } from "./DrawingAppearanceFilter";
import {
  DEFAULT_DRAWING_APPEARANCE,
  drawingAppearanceMatrix,
  type DrawingAppearance,
} from "~/lib/drawing-appearance";
import {
  measurementAngleArc,
  measurementAngleReference,
} from "~/lib/sheet-measure-angles";
import {
  savedMeasureNodes,
  savedMeasureScale,
  savedMeasureReferences,
} from "~/lib/saved-measure-run";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import { sheetMeasureStyle } from "~/lib/sheet-measure-style";
import {
  emptyMeasureRun,
  hitMeasureRun,
  measureRunReducer,
  measureRunWidths,
  runAngleReference,
  MAX_MEASURE_NODES,
} from "~/lib/sheet-measure-run";
import { scaleReadMessage } from "~/lib/sheet-scale-text";
import { snapToLine, type SnapIndex, type SnapSegment } from "~/lib/sheet-snap";
import { SheetMeasureBar } from "./SheetMeasureBar";
import { DrawingTileLayer } from "./DrawingTileLayer";
import { DrawingPdfLayer } from "./DrawingPdfLayer";
import { DrawingPdfLinkLayer } from "./DrawingPdfLinkLayer";
import { readDrawingPdfLinks } from "~/lib/drawing-pdf-links";
import type { DrawingPdfLink } from "~/lib/drawing-text";
import { DrawingAnnotationLayer } from "./DrawingAnnotationLayer";
import { DrawingDraftToolbar } from "./DrawingDraftToolbar";
import { useDrawingEditor, type DrawingEditorProps } from "./useDrawingEditor";
import { InlineTextEditor, type InlineTextEditing } from "./InlineTextEditor";
import {
  DrawingComparisonLayer,
  type DrawingComparison,
} from "./DrawingComparisonLayer";
import { Button } from "~/components/ui/button";
import { NetworkIcon } from "lucide-react";
import { usePipeSystemSelection } from "./usePipeSystemSelection";
import { PipeSystemPanel } from "./PipeSystemPanel";
export type { DrawingEditorProps } from "./useDrawingEditor";

const MIN_ZOOM = 1;
const MAX_ZOOM = 50;
/** A tap this close to a line, in screen pixels, lands on that line. */
const SNAP_PX = 18;
/** A finger can grab an existing point within this screen-space radius. */
const NODE_GRAB_PX = 24;
/** How often tile choices follow the view while it is moving. */
const COMMIT_MS = 50;
type Point = { x: number; y: number };
type MeasureNode = {
  point: SheetPoint;
  line: SnapSegment | null;
  referenceOnly?: boolean;
};
export type DrawingViewport = { center: SheetPoint; zoom: number };
type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };
const NO_ANNOTATIONS: NonNullable<DrawingEditorProps["annotations"]> = [];

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
 * so each sheet starts with fresh tool state.
 */
/** Holding this long while measuring picks up the point to slide it. */
const MEASURE_HOLD_MS = 250;
const LOUPE_PX = 128;
const LOUPE_ZOOM = 2.5;
const LOUPE_GAP_PX = 56;

export function DrawingSheetViewer({
  src,
  sourceSize,
  alt,
  pdf,
  tiles,
  sheetKey,
  comparison,
  appearance = DEFAULT_DRAWING_APPEARANCE,
  resolveAssetUrl,
  navigateTo,
  onViewportChange,
  initialViewport,
  toolControls,
  onPdfReady,
  onPdfError,
  onPdfLink,
  textEditing,
  ...editorProps
}: DrawingEditorProps & {
  /** A text markup typed in place on the drawing. */
  textEditing?: InlineTextEditing | null;
  src: string;
  /** Known page dimensions let PDF detail start before a preview image arrives. */
  sourceSize?: { width: number; height: number };
  alt: string;
  onPdfLink?: (link: DrawingPdfLink) => void;
  onPdfReady?: () => void;
  onPdfError?: (error: unknown) => void;
  pdf?: { url: string; page: number } | null;
  /** Folder holding manifest.json and <factor>/<col>_<row>.webp tiles. */
  tiles?: string | null;
  /** Remembers this sheet's scale on this computer. */
  sheetKey?: string;
  comparison?: DrawingComparison;
  appearance?: DrawingAppearance;
  resolveAssetUrl?: (url: string) => Promise<string>;
  navigateTo?: { center: SheetPoint; zoom: number; requestId: string } | null;
  onViewportChange?: (viewport: DrawingViewport) => void;
  /** Carry the viewing position into a newly opened sheet. */
  initialViewport?: DrawingViewport | null;
  /**
   * Measure and Pipe system are switched from a host toolbar: each change of
   * a request number toggles that mode, and the idle Measure strip is hidden.
   */
  toolControls?: {
    measureRequest: number;
    pipeRequest: number;
    /** Atomic switch: finish a run before starting another mode. */
    modeRequest?: { id: number; mode: "idle" | "measure" | "pipe" };
    onMode?: (mode: { measuring: boolean; pipe: boolean }) => void;
  };
}) {
  const usesInkComparison =
    comparison?.mode === "overlay" || comparison?.mode === "difference";
  const appearanceId = `drawing-appearance-${useId().replace(/:/g, "")}`;
  const appearanceMatrix = drawingAppearanceMatrix(appearance);
  const appearanceFilter = appearanceMatrix
    ? `url(#${appearanceId})`
    : undefined;
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const overlayPaint = useRef<((view: View) => void) | null>(null);
  const pdfPaint = useRef<((view: View) => void) | null>(null);
  const annotationViewport = useRef<SVGSVGElement>(null);
  const pipeViewport = useRef<SVGSVGElement>(null);
  const marks = useRef<SVGSVGElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{
    width: number;
    height: number;
    natural: number;
    aspect: number;
  } | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  // `live` follows every pointer move; `view` is committed for tiles/redraws.
  const live = useRef<View>(REST);
  const entryViewport = useRef(initialViewport);
  const [view, setView] = useState<View>(REST);
  const [moving, setMoving] = useState(false);
  const [pdfLinks, setPdfLinks] = useState<{
    key: string;
    links: DrawingPdfLink[];
  } | null>(null);
  const pdfLinkUrl = pdf?.url;
  const pdfLinkPage = pdf?.page;
  const pdfLinkKey = pdf ? `${pdf.url}:${pdf.page}` : "";
  const readsPdfLinks = Boolean(onPdfLink);
  useEffect(() => {
    if (!pdfLinkUrl || pdfLinkPage === undefined || !readsPdfLinks) return;
    let cancelled = false;
    void readDrawingPdfLinks({ url: pdfLinkUrl, page: pdfLinkPage })
      .then((links) => {
        if (!cancelled) setPdfLinks({ key: pdfLinkKey, links });
      })
      .catch(() => {
        if (!cancelled) setPdfLinks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfLinkUrl, pdfLinkPage, pdfLinkKey, readsPdfLinks]);
  const importedLinks = pdfLinks?.key === pdfLinkKey ? pdfLinks.links : [];
  const pdfLinkTap = useRef<{
    pointerId: number;
    x: number;
    y: number;
    link: DrawingPdfLink;
  } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const middlePan = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const [middlePanning, setMiddlePanning] = useState(false);
  const gesture = useRef<{ view: View; points: Point[] } | null>(null);
  const measureTap = useRef<{
    x: number;
    y: number;
    moved: boolean;
    holding?: boolean;
  } | null>(null);
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
  const [measureColor, setMeasureColor] = useState(DEFAULT_MEASURE_COLOR);
  const measureHalo = measureColorHalo(measureColor);
  useEffect(() => setMeasureColor(readMeasureColor()), []);
  const changeMeasureColor = (color: string) => {
    if (!validMeasureColor(color)) return;
    setMeasureColor(color.toLowerCase());
    writeMeasureColor(color);
  };
  const [pipeMode, setPipeMode] = useState(false);
  const pipeTap = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const pipeCalibration = useRef(false);
  const pipe = usePipeSystemSelection({
    active: pipeMode,
    url: pdf?.url,
    page: pdf?.page,
    sheetKey,
  });
  const markId = `measure-${useId().replace(/:/g, "")}`;
  const [calibrating, setCalibrating] = useState(false);
  const [run, dispatchRun] = useReducer(
    measureRunReducer,
    undefined,
    emptyMeasureRun,
  );
  const trace = run.nodes;
  const [measureSource, setMeasureSource] = useState<{
    id: string;
    revision: number;
    data: DrawingMarkup;
  } | null>(null);
  const [runScaleOverride, setRunScaleOverride] = useState<SheetScale | null>(
    null,
  );
  const [gapMode, setGapMode] = useState(false);
  const [gapMessage, setGapMessage] = useState<string | null>(null);
  const editingTextId = textEditing?.id ?? null;
  const visibleAnnotations = useMemo(() => {
    const annotations = editorProps.annotations ?? NO_ANNOTATIONS;
    // The note being typed is drawn by the editor, not twice.
    const hidden =
      measuring && measureSource ? measureSource.id : editingTextId;
    return hidden
      ? annotations.filter((entity) => entity.id !== hidden)
      : annotations;
  }, [editorProps.annotations, measuring, measureSource, editingTextId]);
  const path = trace.map(({ point }) => point);
  const [measurementLayer, setMeasurementLayer] = useState("General");
  const [calNodes, updateCalNodes] = useState<MeasureNode[]>([]);
  const [calFuture, setCalFuture] = useState<MeasureNode[][]>([]);
  const setCalNodes = (next: React.SetStateAction<MeasureNode[]>) => {
    setCalFuture([]);
    updateCalNodes(next);
  };
  const calPoints = calNodes.map(({ point }) => point);
  const nodeDrag = useRef<{
    pointerId: number;
    index: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<SheetPoint | null>(null);
  const [snapLine, setSnapLine] = useState<SnapSegment | null>(null);
  const [snapIndex, setSnapIndex] = useState<SnapIndex | null>(null);
  const snapSegments = useRef<SnapSegment[] | null>(null);
  const snapKey = useRef<string | null>(null);
  const [localSheetScale, setLocalSheetScale] = useState<SheetScale | null>(
    null,
  );
  // An explicit null is authoritative: this shared sheet has not been calibrated.
  const controlledScale = editorProps.sharedScale !== undefined;
  const sheetScale =
    editorProps.sharedScale === undefined
      ? localSheetScale
      : editorProps.sharedScale;
  const runScale =
    runScaleOverride ??
    (measureSource
      ? savedMeasureScale(measureSource.data, sheetScale)
      : sheetScale);
  const {
    hideAnnotations,
    onUpdate,
    annotations,
    sourceSheetId: measureSheetId,
    canEditAnnotation,
  } = editorProps;
  const savedRuns = useMemo(
    () =>
      hideAnnotations || !onUpdate
        ? []
        : (annotations ?? []).filter(
            (entity) =>
              entity.kind === "markup" &&
              entity.data.type === "dimension" &&
              entity.data.parents &&
              entity.data.points.length < MAX_MEASURE_NODES &&
              entity.visibility !== "archived" &&
              entity.data.sourceSheetId === (measureSheetId ?? sheetKey) &&
              (canEditAnnotation?.(entity.id) ?? true),
          ),
    [
      hideAnnotations,
      onUpdate,
      annotations,
      measureSheetId,
      canEditAnnotation,
      sheetKey,
    ],
  );
  // The unit lengths are typed and shown in (m, mm, in, ft). The shared scale
  // itself stays in meters or feet.
  const [unit, setUnit] = useState<LengthUnit>("ft");
  // The next measuring or calibration point locked square (90°) or at 45°.
  const [angleSnap, setAngleSnap] = useState<45 | 90 | null>(null);
  const [draft, setDraft] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);
  const [readingScale, setReadingScale] = useState(false);
  const [savingScale, setSavingScale] = useState(false);
  const scaleSave = useRef(0);
  const scaleSavePending = useRef(false);
  const [scaleReadError, setScaleReadError] = useState<string | null>(null);
  const scaleRead = useRef(0);
  const seenSheet = useRef(sheetKey);
  if (seenSheet.current !== sheetKey) {
    seenSheet.current = sheetKey;
    scaleRead.current += 1;
    scaleSave.current += 1;
  }
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const panTap = useRef<{
    time: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const quickZoom = useRef<{
    pointerId: number;
    y: number;
    anchor: Point;
    view: View;
    moved: boolean;
  } | null>(null);
  const frameRequest = useRef(0);
  const pipeHalo = useRef<SVGPathElement>(null);
  const pipeStroke = useRef<SVGPathElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef(0);
  const velocity = useRef<{ x: number; y: number; t: number }>({
    x: 0,
    y: 0,
    t: 0,
  });
  // Selecting a saved measurement reopens it in Measure, set from its own
  // points, unit, colour and layer, the way it was made.
  const resumeRun = useRef<(entity: DrawingEntity) => void>(() => undefined);
  const editor = useDrawingEditor(
    {
      ...editorProps,
      onSelect: (id) => {
        const run = id
          ? savedRuns.find((entity) => entity.id === id)
          : undefined;
        if (run && !pipeMode) {
          resumeRun.current(run);
          return;
        }
        editorProps.onSelect?.(id);
      },
      ...(pipeMode
        ? { tool: "pan" as const, onUpdate: undefined, onDelete: undefined }
        : {}),
      sourceSheetId: editorProps.sourceSheetId ?? sheetKey,
      sharedScale: sheetScale,
    },
    fit?.aspect ?? 1,
    (fit?.width ?? 1) * live.current.scale,
  );
  const viewportListener = useRef(onViewportChange);
  viewportListener.current = onViewportChange;
  const annotationTool = editorProps.tool ?? "pan";
  const pdfLinksEnabled =
    !measuring &&
    !pipeMode &&
    !comparison &&
    annotationTool === "pan" &&
    Boolean(onPdfLink);
  const pdfLinkAt = (point: SheetPoint | null) =>
    point &&
    importedLinks.find(
      (link) =>
        point.x >= link.left &&
        point.x <= link.right &&
        point.y >= link.top &&
        point.y <= link.bottom,
    );
  useEffect(() => {
    pdfLinkTap.current = null;
  }, [pdfLinkKey, pdfLinksEnabled]);
  useEffect(() => {
    if (toolControls?.modeRequest) return;
    setMeasuring(false);
    setCalibrating(false);
    setPipeMode(false);
  }, [annotationTool, toolControls?.modeRequest]);
  useEffect(() => {
    setPipeMode(false);
    pipeTap.current = null;
    pipeCalibration.current = false;
  }, [sheetKey, pdf?.url, pdf?.page]);
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

  useEffect(() => {
    if (!measuring || calibrating) {
      setGapMode(false);
      setGapMessage(null);
    }
  }, [measuring, calibrating, sheetKey, pdf?.url, pdf?.page]);

  useEffect(() => {
    if (!measureSource) return;
    const current = savedRuns.find((entity) => entity.id === measureSource.id);
    if (!current || current.revision !== measureSource.revision) {
      dispatchRun({ type: "clear" });
      setMeasureSource(null);
      setRunScaleOverride(null);
      setGapMode(false);
      setGapMessage(
        "This measurement changed or is no longer editable. Select it again to continue.",
      );
    }
  }, [measureSource, savedRuns]);

  // Fit the sheet inside the frame whenever the image or frame size changes.
  useEffect(() => {
    const el = frame.current;
    const img = image.current;
    if (!el || !img) return;
    const measure = () => {
      const width = img.naturalWidth > 0 ? img.naturalWidth : (sourceSize?.width ?? 0);
      const height = img.naturalHeight > 0 ? img.naturalHeight : (sourceSize?.height ?? 0);
      if (
        ![width, height].every(n => Number.isFinite(n) && n > 0) ||
        !el.clientWidth || !el.clientHeight
      ) return;
      const ratio = Math.min(el.clientWidth / width, el.clientHeight / height);
      setFit({ width: width * ratio, height: height * ratio, natural: width, aspect: height / width });
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
  }, [src, sourceSize?.width, sourceSize?.height]);

  // Tiles can finish generating after this sheet was opened. Retry missing
  // manifests without requiring navigation away; PDF rendering remains usable.
  useEffect(() => {
    setManifest(null);
    if (!tiles) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const retryDelays = [
      500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000,
    ];
    const load = async () => {
      try {
        const manifestUrl = `${tiles}/manifest.json`;
        const response = await fetch(
          resolveAssetUrl ? await resolveAssetUrl(manifestUrl) : manifestUrl,
          {
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
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
      if (!controller.signal.aborted && delay !== undefined)
        timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tiles, resolveAssetUrl]);

  // Each sheet keeps its own scale. Unfinished traces last only for this visit.
  useEffect(() => {
    scaleSave.current += 1;
    scaleSavePending.current = false;
    setSavingScale(false);
    const stored =
      !controlledScale && sheetKey ? readSheetScale(sheetKey) : null;
    if (!controlledScale) setLocalSheetScale(stored);
    if (!controlledScale) setUnit(stored?.unit ?? "ft");
    dispatchRun({ type: "clear" });
    setMeasureSource(null);
    setRunScaleOverride(null);
    setGapMode(false);
    setGapMessage(null);
    setAngleSnap(null);
    setCalNodes([]);
    setCalibrating(false);
    setHover(null);
    setSnapLine(null);
    setDraft("");
    setScaleError(null);
    setScaleReadError(null);
    setReadingScale(false);
  }, [sheetKey, controlledScale, pdf?.url, pdf?.page]);

  useEffect(() => {
    const shared = editorProps.sharedScale;
    // Keep a chosen mm/in when the scale is in the same system.
    if (shared !== undefined)
      setUnit((current) =>
        scaleUnitFor(current) === shared?.unit
          ? current
          : (shared?.unit ?? "ft"),
      );
  }, [editorProps.sharedScale, sheetKey, pdf?.url, pdf?.page]);

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
      dispatchRun({ type: "forget-lines" });
    }
    const controller = new AbortController();
    void loadSnapLines({ url: pdfUrl, page: pdfPage })
      .then(async (segments) => {
        if (controller.signal.aborted) return;
        const aspect = fitRef.current?.aspect;
        const index =
          aspect && aspect > 0
            ? await buildDrawingSnapIndex(segments, aspect, controller.signal)
            : null;
        if (controller.signal.aborted) return;
        snapKey.current = key;
        snapSegments.current = segments;
        setSnapIndex(index);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [measuring, pdfUrl, pdfPage]);

  useEffect(() => {
    const segments = snapSegments.current;
    const aspect = fit?.aspect;
    if (!segments || !(aspect && aspect > 0)) return;
    const controller = new AbortController();
    void buildDrawingSnapIndex(segments, aspect, controller.signal)
      .then((index) => {
        if (!controller.signal.aborted) setSnapIndex(index);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [fit?.aspect]);

  const rememberHover = (point: SheetPoint | null) => {
    setHover((current) =>
      current?.x === point?.x && current?.y === point?.y ? current : point,
    );
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
  const gapHit = (point: SheetPoint) => {
    if (!fit) return null;
    const tolerance = SNAP_PX / Math.max(1, fit.width * live.current.scale);
    if (trace.length) {
      const hit = hitMeasureRun(trace, point, fit.aspect, tolerance);
      return hit ? { hit, nodes: trace, source: null } : null;
    }
    let nearest = tolerance;
    let result: {
      hit: NonNullable<ReturnType<typeof hitMeasureRun>>;
      nodes: typeof trace;
      source: { id: string; revision: number; data: DrawingMarkup } | null;
    } | null = null;
    for (const entity of savedRuns) {
      if (entity.kind !== "markup") continue;
      const nodes = savedMeasureNodes(entity.data);
      const hit = hitMeasureRun(nodes, point, fit.aspect, tolerance);
      if (!hit) continue;
      const distance = Math.hypot(
        point.x - hit.point.x,
        (point.y - hit.point.y) * fit.aspect,
      );
      if (distance <= nearest) {
        nearest = distance;
        result = {
          hit,
          nodes,
          source: {
            id: entity.id,
            revision: entity.revision,
            data: entity.data,
          },
        };
      }
    }
    return result;
  };
  const aimFromClient = (
    clientX: number,
    clientY: number,
    movingNode?: number,
  ): {
    point: SheetPoint;
    segment: SnapSegment | null;
    angle?: 45 | 90;
  } | null => {
    const point = pointFromClient(clientX, clientY);
    if (!point) return null;
    if (gapMode && !calibrating && movingNode === undefined && fit) {
      const selected = gapHit(point);
      if (!selected) return null;
      const start = selected.nodes[selected.hit.from]!.point,
        end = selected.nodes[selected.hit.to]!.point;
      return {
        point: selected.hit.point,
        segment: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
      };
    }
    // Moving the first node uses its next neighbor; other nodes follow connectivity.
    const nodes = calibrating ? calNodes : trace;
    const endIndex = movingNode ?? nodes.length;
    const angleReference =
      !calibrating || movingNode !== undefined || nodes.length === 1
        ? calibrating
          ? measurementAngleReference(nodes, endIndex)
          : runAngleReference(trace, endIndex, run.active)
        : null;
    const anchor = angleReference?.anchor;
    const reference = angleReference?.reference ?? null;
    // Line selection only prefers actual PDF linework, never the synthesized
    // measurement reference (which is used solely for angle locking).
    const referenceNode = angleReference
      ? nodes[angleReference.anchorIndex]
      : null;
    const attachedLine = referenceNode?.referenceOnly
      ? null
      : referenceNode?.line;
    const shown = fit ? fit.width * live.current.scale : 0;
    const hit =
      snapIndex && shown > 0
        ? snapToLine(point, snapIndex, SNAP_PX / shown, attachedLine, 4 / shown)
        : null;
    if (anchor && fit) {
      const angled = snapToAngle(
        anchor,
        hit?.point ?? point,
        fit.aspect,
        reference,
        hit?.segment ?? null,
      );
      // Angle locks must stay within the same screen-space reach as line snaps.
      // A small angular error on a long measurement can otherwise move the end
      // far from the line or exact point the user is aiming at.
      if (
        angled &&
        Math.hypot(
          angled.point.x - point.x,
          (angled.point.y - point.y) * fit.aspect,
        ) *
          shown <=
          SNAP_PX
      )
        return {
          point: angled.point,
          segment: hit?.segment ?? null,
          angle: angled.angle,
        };
    }
    return hit
      ? { point: hit.point, segment: hit.segment }
      : { point, segment: null };
  };
  const rememberAim = (
    clientX: number,
    clientY: number,
    movingNode?: number,
  ) => {
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
    if (!el || !fit || scaleSavePending.current) return null;
    const rect = el.getBoundingClientRect();
    const nodes = calibrating ? calNodes : trace;
    const current = live.current;
    let closest: number | null = null;
    let distance = NODE_GRAB_PX;
    for (let i = 0; i < nodes.length; i++) {
      const point = nodes[i]!.point;
      const x =
        rect.left +
        el.clientWidth / 2 +
        current.x +
        (point.x - 0.5) * fit.width * current.scale;
      const y =
        rect.top +
        el.clientHeight / 2 +
        current.y +
        (point.y - 0.5) * fit.height * current.scale;
      const away = Math.hypot(clientX - x, clientY - y);
      if (away <= distance) {
        closest = i;
        distance = away;
      }
    }
    return closest;
  };
  const commitPoint = (point: SheetPoint, segment: SnapSegment | null) => {
    if (scaleSavePending.current) return;
    if (calibrating) {
      setCalNodes((points) =>
        points.length >= 2 ? points : [...points, { point, line: segment }],
      );
    } else {
      dispatchRun({ type: "append", point, line: segment });
      setGapMessage(null);
    }
    setHover(null);
    setSnapLine(null);
    setAngleSnap(null);
  };
  const undoPoint = useCallback(() => {
    if (gapMode) {
      setGapMode(false);
      setGapMessage(null);
      setHover(null);
      setSnapLine(null);
      return;
    }
    nodeDrag.current = null;
    setDragIndex(null);
    setLoupe(null);
    if (calibrating) {
      if (calNodes.length) {
        setCalFuture((future) => [calNodes, ...future]);
        updateCalNodes(calNodes.slice(0, -1));
      }
    } else {
      dispatchRun({ type: "undo" });
      setGapMessage(null);
    }
    setHover(null);
    setSnapLine(null);
    setAngleSnap(null);
  }, [calibrating, gapMode, calNodes]);
  const redoPoint = () => {
    if (calibrating) {
      const next = calFuture[0];
      if (next) {
        updateCalNodes(next);
        setCalFuture(calFuture.slice(1));
      }
    } else dispatchRun({ type: "redo" });
    setGapMode(false);
    setGapMessage(null);
    clearAim();
  };
  const proposeScale = (next: SheetScale) => {
    if (scaleSavePending.current) return;
    const request = ++scaleSave.current;
    const finish = (accepted: boolean | void) => {
      if (scaleSave.current !== request) return;
      if (accepted === false)
        throw new Error("Scale was not saved. Try again.");
      if (measureSource) setRunScaleOverride(next);
      if (!controlledScale) {
        setLocalSheetScale(next);
        setUnit((current) =>
          scaleUnitFor(current) === next.unit ? current : next.unit,
        );
        if (sheetKey) writeSheetScale(sheetKey, next);
      }
      setCalNodes([]);
      setCalibrating(false);
      setDraft("");
      setScaleError(null);
      setScaleReadError(null);
      if (pipeCalibration.current) {
        pipeCalibration.current = false;
        setMeasuring(false);
      }
    };
    const failed = (reason: unknown) => {
      if (scaleSave.current !== request) return;
      setScaleError(
        reason instanceof Error
          ? reason.message
          : "Scale was not saved. Try again.",
      );
    };
    setScaleError(null);
    try {
      if (controlledScale && !editorProps.onScaleChange)
        throw new Error("You cannot change this drawing's scale right now.");
      const saved = editorProps.onScaleChange?.(next);
      if (saved instanceof Promise) {
        scaleSavePending.current = true;
        setSavingScale(true);
        void saved
          .then(finish)
          .catch(failed)
          .finally(() => {
            if (scaleSave.current !== request) return;
            scaleSavePending.current = false;
            setSavingScale(false);
          });
      } else finish(saved);
    } catch (reason) {
      failed(reason);
    }
  };
  // Changing the unit only changes how lengths are typed and shown here.
  const changeUnit = (next: LengthUnit) => setUnit(next);
  const beginLengthScale = () => {
    if (
      scaleSavePending.current ||
      (controlledScale && !editorProps.onScaleChange)
    )
      return;
    setGapMode(false);
    setGapMessage(null);
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
    if (!fit || calPoints.length < 2 || scaleSavePending.current) return;
    const parsed = parseLengthAs(draft, unit);
    const known = parsed?.length ?? null;
    if (known === null || !parsed) {
      setScaleError(
        `Enter a length in ${unit}, like ${unit === "ft" ? "24'6\"" : unit === "in" ? "18" : unit === "mm" ? "7500" : "7.5"}.`,
      );
      return;
    }
    if (!(known > 0)) {
      setScaleError("Enter a length greater than zero.");
      return;
    }
    const unitsPerSheetWidth = scaleFromKnownLength(
      calPoints[0]!,
      calPoints[1]!,
      fit.aspect,
      known,
    );
    if (unitsPerSheetWidth === null) {
      setScaleError(
        "Those two points are on top of each other. Tap the two ends of the length.",
      );
      return;
    }
    const next = { unit: parsed.unit, unitsPerSheetWidth };
    proposeScale(next);
  };
  useEffect(() => {
    if (!measuring) return;
    const onKey = (event: KeyboardEvent) => {
      if (scaleSavePending.current) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (event.key === "Escape") {
        if (gapMode) {
          setGapMode(false);
          setGapMessage(null);
          setHover(null);
          setSnapLine(null);
          return;
        }
        if (calibrating) {
          setCalibrating(false);
          setCalNodes([]);
          setDraft("");
          setScaleError(null);
          if (pipeCalibration.current) {
            pipeCalibration.current = false;
            setMeasuring(false);
          }
        } else {
          if (measureSource) {
            dispatchRun({ type: "clear" });
            setMeasureSource(null);
            setRunScaleOverride(null);
          }
          setMeasuring(false);
        }
      } else if (
        !typing &&
        (event.key === "Backspace" ||
          (event.key === "z" && (event.metaKey || event.ctrlKey)))
      ) {
        event.preventDefault();
        undoPoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring, calibrating, gapMode, undoPoint, measureSource]);

  /** Keeps the sheet from being dragged entirely out of view. */
  const clamp = useCallback(
    (next: View): View => {
      const el = frame.current;
      if (!el || !fit) return next;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.scale));
      const maxX = Math.max(
        0,
        (fit.width * scale - el.clientWidth) / 2 + el.clientWidth * 0.4,
      );
      const maxY = Math.max(
        0,
        (fit.height * scale - el.clientHeight) / 2 + el.clientHeight * 0.4,
      );
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
    pdfPaint.current?.(live.current);
    overlayPaint.current?.(live.current);
    if (fit && frame.current) {
      const size = {
        width: frame.current.clientWidth,
        height: frame.current.clientHeight,
      };
      const camera = drawingVectorViewBox(fit, size, live.current);
      if (camera) {
        annotationViewport.current?.setAttribute("viewBox", camera);
        pipeViewport.current?.setAttribute("viewBox", camera);
      }
      const measureCamera = drawingVectorViewBox(
        fit,
        size,
        live.current,
        fit.width,
      );
      if (measureCamera) marks.current?.setAttribute("viewBox", measureCamera);
      // Screen-sized pipe highlights follow the live camera before the
      // throttled React/tile state catches up.
      pipeHalo.current?.setAttribute(
        "stroke-width",
        String(7000 / (fit.width * scale)),
      );
      pipeStroke.current?.setAttribute(
        "stroke-width",
        String(4000 / (fit.width * scale)),
      );
    }
  };
  const publishViewport = () => {
    if (!fit) return;
    const current = live.current;
    viewportListener.current?.({
      center: {
        x: 0.5 - current.x / (fit.width * current.scale),
        y: 0.5 - current.y / (fit.height * current.scale),
      },
      zoom: current.scale,
    });
  };
  /** Moves the sheet now (next frame) and lets tiles catch up shortly after. */
  const move = (next: View, settle = false) => {
    live.current = clamp(next);
    publishViewport();
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
  useEffect(() => {
    const freeze = () => {
      stopAnimation();
      move(live.current, true);
      paint();
    };
    window.addEventListener(SNAPSHOT_FREEZE_EVENT, freeze);
    return () => window.removeEventListener(SNAPSHOT_FREEZE_EVENT, freeze);
  });
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
    return {
      scale,
      x: at.x - (at.x - base.x) * ratio,
      y: at.y - (at.y - base.y) * ratio,
    };
  };
  const fromCentre = (clientX: number, clientY: number): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
  };
  const startGesture = () => {
    gesture.current = {
      view: live.current,
      points: [...pointers.current.values()],
    };
  };
  const endMiddlePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (middlePan.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    middlePan.current = null;
    setMiddlePanning(false);
    move(live.current, true);
  };

  useEffect(() => {
    if (!navigateTo || !fit) return;
    stopAnimation();
    move(
      {
        scale: navigateTo.zoom,
        x: (0.5 - navigateTo.center.x) * fit.width * navigateTo.zoom,
        y: (0.5 - navigateTo.center.y) * fit.height * navigateTo.zoom,
      },
      true,
    );
    // A unique request makes selecting the same bookmark again intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTo?.requestId, fit?.width, fit?.height]);
  useLayoutEffect(() => {
    const entry = entryViewport.current;
    if (!entry || !fit) return;
    entryViewport.current = null;
    move(
      {
        scale: entry.zoom,
        x: (0.5 - entry.center.x) * fit.width * entry.zoom,
        y: (0.5 - entry.center.y) * fit.height * entry.zoom,
      },
      true,
    );
    // The inherited view is applied once, after this sheet's dimensions are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);
  useEffect(() => {
    publishViewport();
    // Movement publishes synchronously, including before the redraw timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // Geometry of the committed view.
  const dpr =
    typeof window === "undefined"
      ? 1
      : Math.min(window.devicePixelRatio || 1, 3);
  const shownWidth = fit ? fit.width * view.scale : 0;
  const shownHeight = fit ? fit.height * view.scale : 0;
  const left = frameSize.width / 2 + view.x - shownWidth / 2;
  const top = frameSize.height / 2 + view.y - shownHeight / 2;
  const density = fit ? (shownWidth / fit.natural) * dpr : 1; // screen px per saved-image px
  const tileRequests = useMemo(() => {
    if (!manifest || !tiles || !shownWidth || !shownHeight) return [];
    return planDrawingTiles(tiles, manifest, density, {
      left: -left / shownWidth,
      top: -top / shownHeight,
      right: (frameSize.width - left) / shownWidth,
      bottom: (frameSize.height - top) / shownHeight,
    });
  }, [
    manifest,
    tiles,
    density,
    shownWidth,
    shownHeight,
    left,
    top,
    frameSize.width,
    frameSize.height,
  ]);
  // Raster previews/tiles are fast fallbacks, not a quality gate: thin CAD
  // lines and small text need original PDF pixels even at intermediate zoom.
  // The bounded patch moves with the sheet and is replaced only when ready.
  const needsPdf = Boolean(pdf) && fit !== null;

  const savedPoints = calibrating ? calPoints : path;
  const drawn =
    dragIndex !== null && hover
      ? savedPoints.map((point, index) => (index === dragIndex ? hover : point))
      : savedPoints;
  const rubber =
    !gapMode &&
    dragIndex === null &&
    hover &&
    ((calibrating && calPoints.length === 1) ||
      (!calibrating && path.length >= 1))
      ? hover
      : null;
  const marked =
    pipeMode && !calibrating ? [] : rubber ? [...drawn, rubber] : drawn;
  const pipeSelected = Boolean(pipe.selection?.segments.length);
  const pipeTotal =
    pipeSelected &&
    sheetScale &&
    Number.isFinite(sheetScale.unitsPerSheetWidth) &&
    sheetScale.unitsPerSheetWidth > 0
      ? formatLengthAs(
          pipe.selection!.lengthInSheetWidths * sheetScale.unitsPerSheetWidth,
          sheetScale.unit,
          unit,
        )
      : null;
  const pipeHighlight = useMemo(
    () =>
      pipeMode && pipeSelected && fit
        ? pipe
            .selection!.segments.map(
              (segment) =>
                `M${segment.x1 * 1000},${segment.y1 * fit.aspect * 1000}L${segment.x2 * 1000},${segment.y2 * fit.aspect * 1000}`,
            )
            .join(" ")
        : "",
    [pipeMode, pipeSelected, pipe.selection, fit],
  );
  // The measuring line and X marks are sized in sheet units (like the
  // drawing's gridlines) so they zoom with it, but never thinner than about a
  // screen pixel or smaller than ~10px across when zoomed out.
  const measureStyle = sheetMeasureStyle(1 / view.scale);
  const markStroke = measureStyle.stroke;
  const markArm = measureStyle.arm;
  const lockedAngle = rubber || dragIndex !== null ? angleSnap : null;
  const activeAngleSegment =
    dragIndex === 0 && marked.length > 2
      ? 1
      : dragIndex !== null
        ? Math.max(0, dragIndex - 1)
        : marked.length - 2;
  const markedNodes = marked.map((point, index) => ({
    point,
    line:
      index === dragIndex && hover
        ? snapLine
        : ((calibrating ? calNodes : trace)[index]?.line ?? null),
    parent: calibrating
      ? index === 0
        ? null
        : index - 1
      : index < trace.length
        ? trace[index]!.parent
        : run.active,
  }));
  const markedEdges = markedNodes.flatMap((node, endIndex) => {
    const start = node.parent === null ? undefined : markedNodes[node.parent];
    return start
      ? [
          {
            index: endIndex - 1,
            endIndex,
            from: node.parent!,
            start: start.point,
            end: node.point,
          },
        ]
      : [];
  });
  const branched =
    !calibrating &&
    markedNodes.some(
      (node, index) => node.parent !== (index === 0 ? null : index - 1),
    );
  const MeasureShape = branched ? "path" : "polyline";
  const measureShape = branched
    ? {
        d: markedEdges
          .map(
            ({ start, end }) =>
              `M${start.x * (fit?.width ?? 0)},${start.y * (fit?.height ?? 0)}L${end.x * (fit?.width ?? 0)},${end.y * (fit?.height ?? 0)}`,
          )
          .join(" "),
      }
    : {
        points: marked
          .map(
            (point) =>
              `${point.x * (fit?.width ?? 0)},${point.y * (fit?.height ?? 0)}`,
          )
          .join(" "),
      };
  const angleArcs = fit
    ? markedEdges.flatMap(({ end, index, endIndex: edgeEnd }) => {
        const active =
          index === activeAngleSegment &&
          (rubber !== null || dragIndex !== null);
        // A first-node drag uses the stationary next node as the vertex.
        const endIndex = active && dragIndex === 0 ? 0 : edgeEnd;
        const reference = calibrating
          ? measurementAngleReference(markedNodes, endIndex)
          : runAngleReference(markedNodes, endIndex, run.active);
        if (!reference) return [];
        const arc = measurementAngleArc(
          reference.anchor,
          endIndex === 0 ? marked[0]! : end,
          reference.reference,
          fit.width,
          fit.height,
          view.scale,
          reference.previous,
        );
        if (!arc) return [];
        // Without an attached first line, only show the horizontal fallback when
        // it corresponds to a 45°/90° lock, rather than an arbitrary sheet heading.
        if (
          !reference.previous &&
          !reference.reference &&
          Math.min(Math.abs(arc.degrees - 45), Math.abs(arc.degrees - 90)) >
            1e-6
        )
          return [];
        return [{ ...arc, index, active }];
      })
    : [];
  const knownLength = calibrating ? parseLengthAs(draft, unit) : null;
  const dimensionLabels = fit
    ? markedEdges.map(({ start, end, index }) => {
        const dx = (end.x - start.x) * fit.width;
        const dy = (end.y - start.y) * fit.height;
        // Keep vertical/reversed labels upright and just above their own segment.
        let rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (rotation > 90) rotation -= 180;
        else if (rotation < -90) rotation += 180;
        const label =
          knownLength && knownLength.length > 0
            ? formatLengthAs(knownLength.length, knownLength.unit, unit)
            : (calibrating ? sheetScale : runScale)
              ? formatLengthAs(
                  realLength(
                    [start, end],
                    fit.aspect,
                    (calibrating ? sheetScale : runScale)!.unitsPerSheetWidth,
                  ),
                  (calibrating ? sheetScale : runScale)!.unit,
                  unit,
                )
              : calibrating
                ? "Enter length"
                : "Set scale";
        return {
          index,
          label,
          rotation,
          x: ((start.x + end.x) * fit.width) / 2,
          y: ((start.y + end.y) * fit.height) / 2,
        };
      })
    : [];

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
    const src = {
      left: centre.x - reach,
      top: centre.y - reach,
      right: centre.x + reach,
      bottom: centre.y + reach,
    };
    const k = LOUPE_ZOOM * dpr;
    const map = (c: { x: number; y: number }) => ({
      x: (c.x - src.left) * k,
      y: (c.y - src.top) * k,
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    for (const el of sheet.querySelectorAll<
      HTMLImageElement | HTMLCanvasElement
    >("img, canvas")) {
      const r = el.getBoundingClientRect();
      const l = Math.max(r.left, src.left),
        t = Math.max(r.top, src.top);
      const rr = Math.min(r.right, src.right),
        b = Math.min(r.bottom, src.bottom);
      if (rr <= l || b <= t || r.width <= 0 || r.height <= 0) continue;
      const image = el instanceof HTMLImageElement;
      if (image && !el.complete) continue;
      const nw = image ? el.naturalWidth : el.width;
      const nh = image ? el.naturalHeight : el.height;
      if (!nw || !nh) continue;
      const style = getComputedStyle(el);
      if (
        style.opacity === "0" ||
        style.visibility === "hidden" ||
        style.display === "none"
      )
        continue;
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
    // Clip only overlays, preserving the drawing beneath the reticle center.
    const target = map(centre);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.moveTo(target.x + 4 * dpr, target.y);
    ctx.arc(target.x, target.y, 4 * dpr, 0, Math.PI * 2);
    ctx.clip("evenodd");
    const strokeLine = (
      a: { x: number; y: number },
      z: { x: number; y: number },
      colour: string,
      width: number,
    ) => {
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
    for (const { start, end } of markedEdges) {
      strokeLine(
        map(toClient(start)),
        map(toClient(end)),
        measureHalo,
        (lockedAngle ? 4.5 : 3.5) * dpr,
      );
      strokeLine(
        map(toClient(start)),
        map(toClient(end)),
        measureColor,
        (lockedAngle ? 2.5 : 1.5) * dpr,
      );
    }
    for (const arc of angleArcs) {
      const vertex = map(
        toClient({
          x: arc.vertex.x / fit!.width,
          y: arc.vertex.y / fit!.height,
        }),
      );
      if (arc.referenceEnd) {
        strokeLine(
          vertex,
          map(
            toClient({
              x: arc.referenceEnd.x / fit!.width,
              y: arc.referenceEnd.y / fit!.height,
            }),
          ),
          measureColor,
          1.5 * dpr,
        );
      }
      const start = Math.atan2(
        arc.start.y - arc.vertex.y,
        arc.start.x - arc.vertex.x,
      );
      const finish = Math.atan2(
        arc.finish.y - arc.vertex.y,
        arc.finish.x - arc.vertex.x,
      );
      const sweep = Math.atan2(
        Math.sin(finish - start),
        Math.cos(finish - start),
      );
      for (const [color, width] of [
        [measureHalo, 3.5],
        [measureColor, 1.5],
      ] as const) {
        ctx.beginPath();
        ctx.arc(
          vertex.x,
          vertex.y,
          ((arc.radius * box.width) / fit!.width) * k,
          start,
          start + sweep,
          sweep < 0,
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = width * dpr;
        ctx.stroke();
      }
      const label = map(
        toClient({ x: arc.label.x / fit!.width, y: arc.label.y / fit!.height }),
      );
      ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = measureHalo;
      ctx.fillStyle = measureColor;
      ctx.strokeText(arc.text, label.x, label.y);
      ctx.fillText(arc.text, label.x, label.y);
    }
    const c = map(centre);
    const arm = 10 * dpr;
    for (const dx of [-1, 1])
      for (const dy of [-1, 1]) {
        for (const [color, width] of [
          [measureHalo, 3.5],
          [measureColor, 1.5],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(c.x + dx * arm * 0.35, c.y + dy * arm * 0.35);
          ctx.lineTo(c.x + dx * arm, c.y + dy * arm);
          ctx.strokeStyle = color;
          ctx.lineWidth = width * dpr;
          ctx.lineCap = "butt";
          ctx.stroke();
        }
      }
    ctx.restore();
  });
  const snapMark = Math.max(1.2, 8 / view.scale);
  const total =
    runScale && fit && !calibrating && marked.length >= 2
      ? formatLengthAs(
          measureRunWidths(markedNodes, fit.aspect) *
            runScale.unitsPerSheetWidth,
          runScale.unit,
          unit,
        )
      : null;

  const toggleMeasuring = () => {
    if (!measuring) editorProps.onSelect?.(null);
    if (
      measuring &&
      !calibrating &&
      trace.length >= 2 &&
      (measureSource ? editorProps.onUpdate : editorProps.onCreate)
    ) {
      const sourceSheetId = editorProps.sourceSheetId ?? sheetKey;
      if (sourceSheetId) {
        const scale = runScale && convertScale(runScale, scaleUnitFor(unit));
        const completed: DrawingMarkup = {
          ...(measureSource?.data ?? {}),
          sourceSheetId,
          type: "dimension",
          layer: measurementLayer,
          points: trace.map((node) => ({ ...node.point })),
          parents: trace.map((node) => node.parent),
          angleReferences: savedMeasureReferences(trace),
          stroke: measureColor,
          width: measureSource?.data.width ?? 2,
          fill: "none",
          ...(scale
            ? {
                unit,
                scale:
                  scale.unitsPerSheetWidth *
                  (unit === "mm" ? 1000 : unit === "in" ? 12 : 1),
              }
            : {}),
        };
        if (measureSource) editorProps.onUpdate?.(measureSource.id, completed);
        else editorProps.onCreate?.(completed);
        dispatchRun({ type: "clear" });
        setMeasureSource(null);
        setRunScaleOverride(null);
        setGapMode(false);
        setGapMessage(null);
      }
    }
    clearAim();
    pipeCalibration.current = false;
    pipeTap.current = null;
    setPipeMode(false);
    setMeasuring((on) => !on);
    setCalibrating(false);
    setCalNodes([]);
    setScaleError(null);
    setScaleReadError(null);
  };
  resumeRun.current = (entity) => {
    if (entity.kind !== "markup") return;
    const data = entity.data;
    editorProps.onSelect?.(null);
    clearAim();
    setPipeMode(false);
    setCalibrating(false);
    setCalNodes([]);
    setMeasuring(true);
    setMeasureSource({ id: entity.id, revision: entity.revision, data });
    setMeasurementLayer(data.layer ?? "General");
    setRunScaleOverride(null);
    setMeasureColor(data.stroke);
    setUnit(data.unit === "cm" ? "m" : (data.unit ?? sheetScale?.unit ?? "ft"));
    dispatchRun({ type: "load", nodes: savedMeasureNodes(data) });
    setGapMode(false);
    setGapMessage(null);
  };
  const togglePipe = () => {
    endHold();
    cancelNodeDrag();
    editor.cancelGesture();
    clearAim();
    pipeTap.current = null;
    pipeCalibration.current = false;
    setMeasuring(false);
    setCalibrating(false);
    setCalNodes([]);
    setScaleError(null);
    setScaleReadError(null);
    setPipeMode((on) => !on);
  };
  // A host toolbar (the Drawings bottom bar) can switch Measure and Pipe
  // system through the same steps as their own buttons, and is told which is on.
  const switchMode = (mode: "idle" | "measure" | "pipe") => {
    if (measuring && mode !== "measure") toggleMeasuring();
    else if (!measuring && mode === "measure") toggleMeasuring();
    if (pipeMode && mode !== "pipe") setPipeMode(false);
    else if (!pipeMode && mode === "pipe") togglePipe();
    if (mode !== "measure") {
      endHold();
      cancelNodeDrag();
      editor.cancelGesture();
      clearAim();
    }
  };
  const hostToggles = useRef({ toggleMeasuring, togglePipe, switchMode });
  hostToggles.current = { toggleMeasuring, togglePipe, switchMode };
  const modeRequest = toolControls?.modeRequest;
  const seenModeRequest = useRef(modeRequest?.id);
  useEffect(() => {
    if (!modeRequest || seenModeRequest.current === modeRequest.id) return;
    seenModeRequest.current = modeRequest.id;
    hostToggles.current.switchMode(modeRequest.mode);
  }, [modeRequest]);
  const measureRequest = toolControls?.measureRequest ?? 0;
  const pipeRequest = toolControls?.pipeRequest ?? 0;
  const seenRequests = useRef({ measure: measureRequest, pipe: pipeRequest });
  useEffect(() => {
    if (seenRequests.current.measure === measureRequest) return;
    seenRequests.current.measure = measureRequest;
    hostToggles.current.toggleMeasuring();
  }, [measureRequest]);
  useEffect(() => {
    if (seenRequests.current.pipe === pipeRequest) return;
    seenRequests.current.pipe = pipeRequest;
    hostToggles.current.togglePipe();
  }, [pipeRequest]);
  const reportMode = toolControls?.onMode;
  useEffect(() => {
    reportMode?.({ measuring, pipe: pipeMode });
  }, [measuring, pipeMode, reportMode]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div
        ref={frame}
        className={`bg-muted relative min-h-0 w-full flex-1 touch-none overflow-hidden select-none [&_img]:pointer-events-none${middlePanning || dragIndex !== null ? "cursor-grabbing" : measuring ? "cursor-crosshair" : ""}`}
        // No phone long-press menu (copy/save image, open link) on the drawing:
        // long presses are for working on the sheet.
        style={{ WebkitTouchCallout: "none" }}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        // Capture gives the middle button priority over every drawing tool and
        // its overlays. Cancel only in-flight edits; keep committed draft points.
        onPointerDownCapture={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          stopAnimation();
          pointers.current.clear();
          gesture.current = null;
          cancelNodeDrag();
          editor.cancelGesture();
          pdfLinkTap.current = null;
          measureTap.current = null;
          pipeTap.current = null;
          quickZoom.current = null;
          panTap.current = null;
          lastTap.current = null;
          middlePan.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
          setMiddlePanning(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMoveCapture={(event) => {
          const pan = middlePan.current;
          if (pan?.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          move({
            ...live.current,
            x: live.current.x + event.clientX - pan.x,
            y: live.current.y + event.clientY - pan.y,
          });
          pan.x = event.clientX;
          pan.y = event.clientY;
        }}
        onPointerUpCapture={endMiddlePan}
        onPointerCancelCapture={endMiddlePan}
        onLostPointerCapture={(event) => {
          if (pdfLinkTap.current?.pointerId === event.pointerId)
            pdfLinkTap.current = null;
          endMiddlePan(event);
        }}
        onPointerDown={(event) => {
          if ((measuring || pipeMode) && event.button !== 0) return;
          stopAnimation();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          velocity.current = { x: 0, y: 0, t: performance.now() };
          startGesture();
          if (pointers.current.size > 1) {
            if (nodeDrag.current) cancelNodeDrag();
            editor.cancelGesture();
            pdfLinkTap.current = null;
            quickZoom.current = null;
            panTap.current = null;
            lastTap.current = null;
            pipeTap.current = null;
          }
          if (pipeMode && !calibrating && pointers.current.size === 1) {
            pipeTap.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
            lastTap.current = null;
            return;
          }
          if (
            !measuring &&
            !pipeMode &&
            pointers.current.size === 1 &&
            editor.down(
              pointFromClient(event.clientX, event.clientY),
              event.target,
            )
          ) {
            lastTap.current = null;
            return;
          }
          if (
            pdfLinksEnabled &&
            event.button === 0 &&
            pointers.current.size === 1
          ) {
            const link = pdfLinkAt(
              pointFromClient(event.clientX, event.clientY),
            );
            if (link) {
              pdfLinkTap.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                link,
              };
              lastTap.current = null;
              panTap.current = null;
              return;
            }
          }
          if (pointers.current.size === 1) {
            if (measuring) {
              const index = nodeAtClient(event.clientX, event.clientY);
              if (
                index !== null &&
                (calibrating || (!gapMode && !run.branching))
              ) {
                endHold();
                measureTap.current = null;
                nodeDrag.current = {
                  pointerId: event.pointerId,
                  index,
                  x: event.clientX,
                  y: event.clientY,
                  moved: false,
                };
                setDragIndex(index);
                clearAim();
                setHover((calibrating ? calNodes : trace)[index]!.point);
                setLoupe({ x: event.clientX, y: event.clientY });
                return;
              }
              // A short press drops a point. Holding still lets the point be slid
              // into place with a magnifier. A drag still pans, and a second
              // finger still pinches.
              measureTap.current = {
                x: event.clientX,
                y: event.clientY,
                moved: false,
              };
              if (holdTimer.current) clearTimeout(holdTimer.current);
              holdTimer.current = setTimeout(() => {
                holdTimer.current = null;
                const tap = measureTap.current;
                const finger = [...pointers.current.values()][0];
                if (!tap || tap.moved || pointers.current.size !== 1 || !finger)
                  return;
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
            if (
              previousTap &&
              now - previousTap.time < 300 &&
              Math.hypot(
                event.clientX - previousTap.x,
                event.clientY - previousTap.y,
              ) < 32
            ) {
              // Wait for release before step-zooming: dragging the second press
              // instead controls zoom continuously around its original position.
              quickZoom.current = {
                pointerId: event.pointerId,
                y: event.clientY,
                anchor: fromCentre(event.clientX, event.clientY),
                view: live.current,
                moved: false,
              };
              panTap.current = null;
            } else {
              panTap.current = {
                time: now,
                x: event.clientX,
                y: event.clientY,
                moved: false,
              };
            }
          } else if (measureTap.current) {
            measureTap.current.moved = true;
            endHold();
          }
        }}
        onPointerMove={(event) => {
          if (measuring && event.buttons === 0 && !nodeDrag.current)
            rememberAim(event.clientX, event.clientY);
          if (
            pdfLinkTap.current &&
            Math.hypot(
              event.clientX - pdfLinkTap.current.x,
              event.clientY - pdfLinkTap.current.y,
            ) > 6
          )
            pdfLinkTap.current = null;
          const previous = pointers.current.get(event.pointerId);
          if (!previous || !gesture.current) return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (
            pipeTap.current &&
            Math.hypot(
              event.clientX - pipeTap.current.x,
              event.clientY - pipeTap.current.y,
            ) > MEASURE_TAP_SLOP_PX
          )
            pipeTap.current.moved = true;
          const drag = nodeDrag.current;
          if (
            drag?.pointerId === event.pointerId &&
            pointers.current.size === 1
          ) {
            drag.moved ||=
              Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 2;
            if (drag.moved)
              rememberAim(event.clientX, event.clientY, drag.index);
            setLoupe({ x: event.clientX, y: event.clientY });
            return;
          }
          const zoom = quickZoom.current;
          if (
            zoom?.pointerId === event.pointerId &&
            pointers.current.size === 1
          ) {
            const dy = event.clientY - zoom.y;
            zoom.moved ||= Math.abs(dy) > 6;
            if (zoom.moved)
              move(zoomAt(zoom.view, Math.exp(dy * 0.008), zoom.anchor));
            return;
          }
          if (
            panTap.current &&
            Math.hypot(
              event.clientX - panTap.current.x,
              event.clientY - panTap.current.y,
            ) > 6
          ) {
            panTap.current.moved = true;
          }
          const now = [...pointers.current.values()];
          const before = gesture.current.points;
          const base = gesture.current.view;
          if (now.length >= 2 && before.length >= 2) {
            if (measureTap.current) measureTap.current.moved = true;
            if (loupe) endHold();
            const a = now[0]!,
              b = now[1]!;
            const a0 = before[0]!,
              b0 = before[1]!;
            const factor =
              Math.hypot(a.x - b.x, a.y - b.y) /
              Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
            const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
            const mid0 = fromCentre((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
            const zoomed = zoomAt(base, factor, mid0);
            move({
              ...zoomed,
              x: zoomed.x + mid.x - mid0.x,
              y: zoomed.y + mid.y - mid0.y,
            });
          } else if (now.length === 1 && before[0]) {
            if (
              !measuring &&
              !pipeMode &&
              (() => {
                const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
                for (const sample of samples)
                  editor.move(pointFromClient(sample.clientX, sample.clientY));
                return editor.move(
                  pointFromClient(event.clientX, event.clientY),
                );
              })()
            )
              return;
            const p = now[0]!;
            if (measuring && measureTap.current?.holding) {
              rememberAim(event.clientX, event.clientY);
              setLoupe({ x: event.clientX, y: event.clientY });
              return;
            }
            if (measuring && measureTap.current && !measureTap.current.moved) {
              if (
                Math.hypot(
                  p.x - measureTap.current.x,
                  p.y - measureTap.current.y,
                ) <= MEASURE_TAP_SLOP_PX
              ) {
                rememberAim(event.clientX, event.clientY);
                return;
              }
              measureTap.current.moved = true;
              clearAim();
              gesture.current = {
                view: live.current,
                points: [{ x: p.x, y: p.y }],
              };
              return;
            }
            move({
              ...base,
              x: base.x + p.x - before[0].x,
              y: base.y + p.y - before[0].y,
            });
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
            const moved =
              drag.moved ||
              Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 2;
            const aim = moved
              ? aimFromClient(event.clientX, event.clientY, drag.index)
              : null;
            if (!moved && !calibrating)
              dispatchRun({ type: "select", index: drag.index });
            if (aim) {
              const replace = (nodes: MeasureNode[]) =>
                nodes.map((node, index) =>
                  index === drag.index
                    ? { point: aim.point, line: aim.segment }
                    : node,
                );
              if (calibrating) setCalNodes(replace);
              else
                dispatchRun({
                  type: "move",
                  index: drag.index,
                  point: aim.point,
                  line: aim.segment,
                });
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
            if (zoom.moved)
              move(
                zoomAt(
                  zoom.view,
                  Math.exp((event.clientY - zoom.y) * 0.008),
                  zoom.anchor,
                ),
                true,
              );
            else
              animateTo(
                zoom.view.scale > 1.5
                  ? REST
                  : zoomAt(zoom.view, 3, zoom.anchor),
              );
            return;
          }
          const candidate = panTap.current;
          lastTap.current =
            candidate &&
            !candidate.moved &&
            Date.now() - candidate.time < 300 &&
            Math.hypot(
              event.clientX - candidate.x,
              event.clientY - candidate.y,
            ) <= 6
              ? { time: Date.now(), x: event.clientX, y: event.clientY }
              : null;
          panTap.current = null;
          const tap = measureTap.current;
          const wasSingle = pointers.current.size === 1;
          const pipeCandidate = pipeTap.current;
          const pipePoint =
            pipeMode &&
            !calibrating &&
            wasSingle &&
            pipeCandidate?.pointerId === event.pointerId &&
            !pipeCandidate.moved &&
            Math.hypot(
              event.clientX - pipeCandidate.x,
              event.clientY - pipeCandidate.y,
            ) <= MEASURE_TAP_SLOP_PX
              ? pointFromClient(event.clientX, event.clientY)
              : null;
          pipeTap.current = null;
          const linkCandidate = pdfLinkTap.current;
          pdfLinkTap.current = null;
          const activatedLink =
            pdfLinksEnabled &&
            wasSingle &&
            linkCandidate?.pointerId === event.pointerId &&
            Math.hypot(
              event.clientX - linkCandidate.x,
              event.clientY - linkCandidate.y,
            ) <= 6 &&
            pdfLinkAt(pointFromClient(event.clientX, event.clientY)) ===
              linkCandidate.link
              ? linkCandidate.link
              : null;
          const edited =
            !measuring &&
            !pipeMode &&
            wasSingle &&
            editor.up(pointFromClient(event.clientX, event.clientY));
          pointers.current.delete(event.pointerId);
          measureTap.current = null;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = null;
          setLoupe(null);
          startGesture();
          if (pointers.current.size > 0) return;
          if (activatedLink) {
            lastTap.current = null;
            move(live.current, true);
            onPdfLink?.(activatedLink);
            return;
          }
          if (pipePoint && fit) {
            pipe.select(
              pipePoint,
              SNAP_PX / Math.max(1, fit.width * live.current.scale),
            );
            move(live.current, true);
            return;
          }
          if (edited) {
            move(live.current, true);
            return;
          }
          if (measuring && tap && !tap.moved && wasSingle) {
            if (gapMode && !calibrating && fit) {
              const point = pointFromClient(event.clientX, event.clientY);
              const selected = point && gapHit(point);
              if (selected) {
                if (selected.source) {
                  setMeasureSource(selected.source);
                  setMeasurementLayer(selected.source.data.layer ?? "General");
                  setRunScaleOverride(null);
                  setMeasureColor(selected.source.data.stroke);
                  setUnit(
                    selected.source.data.unit === "cm"
                      ? "m"
                      : (selected.source.data.unit ?? sheetScale?.unit ?? "ft"),
                  );
                  dispatchRun({ type: "load", nodes: selected.nodes });
                }
                dispatchRun({ type: "branch", hit: selected.hit });
                setGapMode(false);
                setGapMessage(
                  "Branch starts here. Tap the next point to continue.",
                );
              } else
                setGapMessage(
                  "Tap an existing measured segment to start the branch.",
                );
              clearAim();
              move(live.current, true);
              return;
            }
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
          pdfLinkTap.current = null;
          quickZoom.current = null;
          panTap.current = null;
          lastTap.current = null;
          pipeTap.current = null;
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
          move(
            zoomAt(
              live.current,
              Math.exp(-event.deltaY * 0.0015),
              fromCentre(event.clientX, event.clientY),
            ),
          );
          if (wheelSettleTimer.current) clearTimeout(wheelSettleTimer.current);
          wheelSettleTimer.current = setTimeout(() => {
            wheelSettleTimer.current = null;
            move(live.current, true);
          }, 80);
        }}
      >
        <div
          ref={layer}
          data-drawing-sheet-layer="true"
          className="absolute top-1/2 left-1/2 origin-center will-change-transform"
          style={{
            width: fit?.width,
            height: fit?.height,
            visibility: fit ? "visible" : "hidden",
          }}
        >
          {appearanceMatrix && (
            <DrawingAppearanceFilter
              id={appearanceId}
              matrix={appearanceMatrix}
            />
          )}
          <div
            data-drawing-image-layer="true"
            className="absolute inset-0"
            style={{ filter: appearanceFilter, backgroundColor: "#fff" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={image}
              src={src}
              alt={alt}
              draggable={false}
              className="absolute inset-0 h-full w-full"
              style={{ opacity: usesInkComparison ? 0 : undefined }}
            />
            <DrawingTileLayer
              key={tiles ?? src}
              requests={usesInkComparison ? [] : tileRequests}
              resolveAssetUrl={resolveAssetUrl}
            />
            {pdf && fit && comparison && (
              <DrawingPdfLayer
                pdf={pdf}
                fit={fit}
                frameSize={frameSize}
                view={view}
                dpr={dpr}
                enabled={needsPdf && !usesInkComparison}
                moving={moving}
              />
            )}
          </div>
          {comparison && fit && !usesInkComparison && (
            <DrawingComparisonLayer
              appearance={appearance}
              appearanceFilter={appearanceFilter}
              primary={{ src, pdf }}
              comparison={comparison}
              fit={fit}
              frameSize={frameSize}
              view={view}
              dpr={dpr}
            />
          )}
          {fit && pdfLinksEnabled && (
            <DrawingPdfLinkLayer
              links={importedLinks}
              aspect={fit.aspect}
              onActivate={(link) => onPdfLink?.(link)}
            />
          )}
        </div>
        {comparison && fit && usesInkComparison && (
          <DrawingComparisonLayer
            screenSpace
            paintRef={overlayPaint}
            appearance={appearance}
            primary={{ src, pdf }}
            comparison={comparison}
            fit={fit}
            frameSize={frameSize}
            view={view}
            dpr={dpr}
          />
        )}
        {pdf && fit && !comparison && (
          <DrawingPdfLayer
            pdf={pdf}
            fit={fit}
            frameSize={frameSize}
            view={view}
            dpr={dpr}
            enabled={needsPdf}
            moving={moving}
            screenSpace
            onReady={onPdfReady}
            onError={onPdfError}
            paintRef={pdfPaint}
            appearanceFilter={appearanceFilter}
          />
        )}
        {/* Vector overlays fill the viewport rather than the CSS-scaled sheet.
          Their camera follows every gesture frame without rebuilding ink. */}
        {fit && (
          <DrawingAnnotationLayer
            viewportRef={annotationViewport}
            viewBox={drawingVectorViewBox(fit, frameSize, view) ?? undefined}
            annotations={visibleAnnotations}
            aspect={fit.aspect}
            selectedId={pipeMode ? null : editorProps.selectedId}
            heldId={pipeMode ? null : editor.heldId}
            draft={measuring || pipeMode ? null : editor.draft}
            editing={editor.editing}
            hidden={editorProps.hideAnnotations}
            sharedScale={sheetScale}
            onSelect={pipeMode ? undefined : editorProps.onSelect}
            onActivate={
              !measuring && !pipeMode && annotationTool === "pan"
                ? editorProps.onActivate
                : undefined
            }
            screenPixelSize={1000 / (fit.width * view.scale)}
            sheetPixelSize={1000 / fit.width}
            showResizeHandles={
              !measuring &&
              !pipeMode &&
              annotationTool === "select" &&
              editorProps.selectionMode !== "move" &&
              Boolean(editorProps.onUpdate)
            }
            showMoveArea={
              !measuring &&
              !pipeMode &&
              annotationTool === "select" &&
              Boolean(editorProps.onUpdate)
            }
            canEditAnnotation={editorProps.canEditAnnotation}
          />
        )}
        {fit && textEditing && textEditing.data.points[0] && (
          <InlineTextEditor
            key={textEditing.id ?? "new"}
            editing={textEditing}
            x={left + textEditing.data.points[0].x * shownWidth}
            y={top + textEditing.data.points[0].y * shownHeight}
            pxPerUnit={shownWidth / 1000}
            frameWidth={frameSize.width}
          />
        )}
        {fit && pipeHighlight && (
          <svg
            ref={pipeViewport}
            aria-label="Selected pipe system"
            role="img"
            data-pipe-segment-count={pipe.selection!.segments.length}
            className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
            viewBox={
              drawingVectorViewBox(fit, frameSize, view) ??
              `0 0 1000 ${fit.aspect * 1000}`
            }
          >
            <path
              ref={pipeHalo}
              d={pipeHighlight}
              fill="none"
              stroke="white"
              strokeOpacity={0.8}
              strokeWidth={7000 / (fit.width * view.scale)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              ref={pipeStroke}
              d={pipeHighlight}
              fill="none"
              stroke="#0891b2"
              strokeWidth={4000 / (fit.width * view.scale)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {fit && (marked.length > 0 || snapLine) && (
          <svg
            ref={marks}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[4] h-full w-full overflow-hidden"
            viewBox={
              drawingVectorViewBox(fit, frameSize, view, fit.width) ??
              `0 0 ${fit.width} ${fit.height}`
            }
          >
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
                    <rect
                      x={-fit.width}
                      y={-fit.height}
                      width={fit.width * 3}
                      height={fit.height * 3}
                      fill="#ffffff"
                    />
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
                  <MeasureShape
                    {...measureShape}
                    fill="none"
                    stroke={measureHalo}
                    strokeOpacity={0.85}
                    strokeWidth={markStroke * 2.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <MeasureShape
                    {...measureShape}
                    fill="none"
                    data-measure-path="true"
                    data-angle-locked={lockedAngle ? "true" : "false"}
                    stroke={measureColor}
                    strokeWidth={lockedAngle ? markStroke * 1.6 : markStroke}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
                {dimensionLabels.map(({ index, label, rotation, x, y }) => {
                  const fontSize = measureStyle.font;
                  return (
                    <g
                      key={index}
                      transform={`translate(${x} ${y}) rotate(${rotation})`}
                    >
                      <text
                        data-measure-length={index}
                        aria-label={`Segment ${index + 1}: ${label}`}
                        y={measureStyle.labelOffset}
                        textAnchor="middle"
                        fontSize={fontSize}
                        fontWeight={measureStyle.fontWeight}
                        fill={measureColor}
                        stroke={measureHalo}
                        strokeWidth={measureStyle.labelHalo}
                        strokeLinejoin="round"
                        paintOrder="stroke"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                {angleArcs.map((arc) => (
                  <g
                    key={arc.index}
                    data-measure-angle={arc.index}
                    data-active-angle={arc.active ? "true" : "false"}
                  >
                    {arc.referenceEnd && (
                      <line
                        x1={arc.vertex.x}
                        y1={arc.vertex.y}
                        x2={arc.referenceEnd.x}
                        y2={arc.referenceEnd.y}
                        stroke={measureColor}
                        strokeWidth={markStroke}
                        strokeDasharray={`${3 / view.scale} ${3 / view.scale}`}
                      />
                    )}
                    <path
                      d={arc.path}
                      fill="none"
                      stroke={measureHalo}
                      strokeWidth={markStroke * 3}
                    />
                    <path
                      data-angle-arc="true"
                      d={arc.path}
                      fill="none"
                      stroke={measureColor}
                      strokeWidth={markStroke * 1.4}
                    />
                    <text
                      x={arc.label.x}
                      y={arc.label.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={measureStyle.angleFont}
                      fontWeight={700}
                      fill={measureColor}
                      stroke={measureHalo}
                      strokeWidth={measureStyle.angleHalo}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      {arc.text}
                    </text>
                  </g>
                ))}
              </>
            )}
            {/* Straight arms leave a transparent gap around the node coordinate. */}
            {marked.map((point, index) => {
              const cx = point.x * fit.width;
              const cy = point.y * fit.height;
              const arm = markArm;
              return (
                <g
                  key={index}
                  data-measure-node={index < drawn.length ? index : undefined}
                  data-measure-active={
                    !calibrating && run.active === index ? "true" : undefined
                  }
                  opacity={dragIndex === index ? 1 : 0.6}
                >
                  {measuring && !calibrating && run.active === index && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={markArm * 1.7}
                      fill="none"
                      stroke={measureColor}
                      strokeWidth={markStroke}
                    />
                  )}
                  <DrawingMeasureNode
                    x={cx}
                    y={cy}
                    arm={arm}
                    stroke={markStroke}
                    color={measureColor}
                    halo={measureHalo}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {!measuring && (
          <DrawingDraftToolbar
            tool={annotationTool}
            count={editor.pointCount}
            canFinish={editor.canFinish}
            onUndo={editor.undo}
            onCancel={editor.clear}
            onFinish={editor.finish}
          />
        )}
        {loupe &&
          fit &&
          frame.current &&
          (() => {
            const box = frame.current.getBoundingClientRect();
            const half = LOUPE_PX / 2;
            // Above the thumb; below it when there is no room at the top.
            const above = loupe.y - box.top - LOUPE_GAP_PX - half;
            const top =
              above - half >= 8
                ? above
                : loupe.y - box.top + LOUPE_GAP_PX + half;
            const left = Math.min(
              Math.max(loupe.x - box.left, half + 8),
              box.width - half - 8,
            );
            return (
              <canvas
                ref={loupeCanvas}
                aria-hidden="true"
                className="pointer-events-none absolute z-30 rounded-full border-2 border-white bg-white shadow-[0_4px_16px_rgba(0,0,0,0.45)] ring-1 ring-black/30"
                style={{
                  width: LOUPE_PX,
                  height: LOUPE_PX,
                  left: left - half,
                  top: top - half,
                }}
              />
            );
          })()}
      </div>
      <SheetMeasureBar
        measurementLayer={measurementLayer}
        measurementLayers={editorProps.measurementLayers ?? []}
        onMeasurementLayer={setMeasurementLayer}
        hideIdle={Boolean(toolControls)}
        pipeControl={
          <Button
            type="button"
            variant={pipeMode ? "default" : "outline"}
            aria-pressed={pipeMode}
            className="shadow-md"
            onClick={togglePipe}
          >
            <NetworkIcon className="h-4 w-4" />
            Pipe system
          </Button>
        }
        pipePanel={
          pipeMode ? (
            <PipeSystemPanel
              reading={pipe.reading}
              selecting={pipe.selecting}
              error={pipe.error}
              hasPdf={pipe.hasPdf}
              hasLines={pipe.hasLines}
              ready={pipe.ready}
              codes={pipe.codes}
              system={pipe.system}
              selectedSystem={pipe.selection?.system}
              wholeSystem={pipe.selection?.source === "layer"}
              hasLayerSystems={pipe.layerCodes.length > 0}
              total={pipeTotal}
              selected={pipeSelected}
              partial={pipe.selection?.truncated ?? false}
              warnings={pipe.selection?.warnings ?? []}
              unit={unit}
              scaleSet={sheetScale !== null}
              canSetScale={
                !controlledScale || Boolean(editorProps.onScaleChange)
              }
              onSystem={pipe.setSystem}
              onClear={pipe.clear}
              onRetry={pipe.retry}
              onScale={() => {
                pipeCalibration.current = true;
                setMeasuring(true);
                beginLengthScale();
              }}
              onUnit={changeUnit}
            />
          ) : null
        }
        measuring={measuring}
        calibrating={calibrating}
        pointCount={path.length}
        gap={gapMode}
        canGap={
          (trace.length >= 2 && trace.length < MAX_MEASURE_NODES) ||
          (trace.length === 0 && savedRuns.length > 0)
        }
        gapMessage={gapMessage}
        onGap={() => {
          cancelNodeDrag();
          clearAim();
          setGapMode((on) => !on);
          setGapMessage(null);
        }}
        calibrationCount={calPoints.length}
        total={total}
        unit={unit}
        scaleSet={runScale !== null}
        snapping={Boolean(snapIndex && snapIndex.segments.length > 0)}
        draft={draft}
        error={scaleError}
        reading={readingScale}
        saving={savingScale}
        canSetScale={!controlledScale || Boolean(editorProps.onScaleChange)}
        scaleLabel={sheetScale?.label}
        readError={scaleReadError}
        onToggle={toggleMeasuring}
        onUndo={undoPoint}
        onRedo={redoPoint}
        canRedo={calibrating ? calFuture.length > 0 : run.future.length > 0}
        onClear={() => {
          cancelNodeDrag();
          dispatchRun({ type: "clear" });
          setMeasureSource(null);
          setRunScaleOverride(null);
          setGapMode(false);
          setGapMessage(null);
        }}
        onStartScale={beginLengthScale}
        onReadPrinted={pdfUrl && pdfPage != null ? readPrintedScale : undefined}
        onCancelScale={() => {
          clearAim();
          setCalibrating(false);
          setCalNodes([]);
          setDraft("");
          setScaleError(null);
          if (pipeCalibration.current) {
            pipeCalibration.current = false;
            setMeasuring(false);
          }
        }}
        onDraft={(value) => {
          setDraft(value);
          setScaleError(null);
        }}
        onUnit={changeUnit}
        onApply={applyScale}
        color={measureColor}
        onColor={changeMeasureColor}
      />
    </div>
  );
}
