"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingEntity, DrawingMarkup, DrawingPoint, DrawingStyle, DrawingTool } from "~/lib/drawing-workspace";
import type { SheetScale } from "~/lib/sheet-measure";
import { isPathTool, isStrokeTool, minimumDrawingPoints, resizeDrawingMarkup, simplifyDrawingStroke, translateDrawingPoints, type DrawingResizeHandle } from "~/lib/drawing-annotation-geometry";

export type DrawingEditorProps = {
  annotations?: DrawingEntity[];
  measurementLayers?: string[];
  sourceSheetId?: string;
  tool?: DrawingTool;
  style?: DrawingStyle;
  selectedId?: string | null;
  selectionMode?: "move" | "resize";
  canEditAnnotation?: (entityId: string) => boolean;
  hideAnnotations?: boolean;
  onCreate?: (data: DrawingMarkup) => void;
  onSelect?: (id: string | null) => void;
  onPoint?: (type: "issue" | "rfi", point: DrawingPoint) => void;
  onUpdate?: (id: string, data: DrawingMarkup) => void;
  onDelete?: (id: string) => void;
  onActivate?: (data: DrawingMarkup) => void;
  sharedScale?: SheetScale | null;
  onScaleChange?: (scale: SheetScale) => boolean | void | Promise<boolean | void>;
};
type Gesture = {
  start: DrawingPoint; points: DrawingPoint[]; moved: boolean; entity?: DrawingEntity; handle?: number | DrawingResizeHandle;
  activate?: boolean; edited?: DrawingMarkup; latest?: DrawingPoint;
  /** A markup is only picked up after a short hold, so a drag that starts on one still pans. */
  armed?: boolean; holdTimer?: ReturnType<typeof setTimeout>;
  /** Moved before the hold completed: the drag pans the drawing instead. */
  panning?: boolean;
};
/** How long to hold still on a markup before it is picked up. */
export const MARKUP_HOLD_MS = 350;
const holdsToSelect = (entity: DrawingEntity) => entity.kind === "markup" && entity.data.type !== "link";

export function useDrawingEditor(props: DrawingEditorProps, aspect: number, screenWidth: number) {
  const tool = props.tool ?? "pan";
  const [points, setPoints] = useState<DrawingPoint[]>([]);
  const [preview, setPreview] = useState<DrawingPoint[]>([]);
  const [editing, setEditing] = useState<{ id: string; data: DrawingMarkup } | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const committed = useRef(points);
  committed.current = points;
  const { annotations, canEditAnnotation } = props;
  const previewFrame = useRef<number | null>(null);
  const publishRef = useRef<(show?: boolean) => void>(() => undefined);
  const cancelPreview = useCallback(() => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
  }, []);
  useEffect(() => cancelPreview, [cancelPreview]);
  const schedulePreview = () => {
    if (previewFrame.current !== null) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null;
      // Use current permissions and callbacks, even if the workspace changed
      // between a pointer sample and the next display frame.
      publishRef.current();
    });
  };
  const stopHold = (active: Gesture | null) => { if (active?.holdTimer) clearTimeout(active.holdTimer); setHeldId(null); };
  /** After a short hold, select the markup and let the drag move it. */
  const startHold = (active: Gesture) => {
    active.holdTimer = setTimeout(() => {
      active.holdTimer = undefined;
      if (gesture.current !== active || active.moved || !active.entity) return;
      active.armed = true;
      try { navigator.vibrate?.(12); } catch { /* Haptics are optional. */ }
      // From here the gesture edits the markup rather than panning.
      if (active.activate) { active.activate = false; active.start = active.latest ?? active.start; }
      // Show it is held now; selecting waits for release because selection can
      // change the viewer layout under the finger.
      setHeldId(active.entity.id);
    }, MARKUP_HOLD_MS);
  };
  const clear = () => { cancelPreview(); stopHold(gesture.current); gesture.current = null; committed.current = []; setPoints([]); setPreview([]); setEditing(null); };
  useEffect(clear, [tool, props.sourceSheetId, props.selectionMode, props.hideAnnotations, cancelPreview]);
  const canEdit = useCallback((entity: DrawingEntity) => entity.kind === "markup" && entity.visibility !== "archived"
    && annotations?.some(current => current.id === entity.id && current.revision === entity.revision && current.visibility !== "archived")
    && (canEditAnnotation?.(entity.id) ?? true), [annotations, canEditAnnotation]);

  const dataFor = (next: DrawingPoint[]): DrawingMarkup | null => {
    if (tool === "pan" || tool === "select" || tool === "issue" || tool === "rfi") return null;
    return {
      sourceSheetId: props.sourceSheetId ?? "", type: tool, points: next,
      stroke: props.style?.stroke ?? "#ef4444", width: props.style?.width ?? 2,
      ...(props.style?.fill ? { fill: props.style.fill } : {}),
      ...(props.style?.opacity !== undefined ? { opacity: props.style.opacity } : {}),
      ...((tool === "dimension" || tool === "area") && props.sharedScale
        ? { scale: props.sharedScale.unitsPerSheetWidth, unit: props.sharedScale.unit } : {}),
    };
  };
  const finish = (next = committed.current) => {
    if (next.length < minimumDrawingPoints(tool)) return;
    if (next.length > 1 && !next.some(point => Math.hypot(point.x - next[0]!.x, point.y - next[0]!.y) > 0.000001)) return;
    const data = dataFor(next);
    if (data && props.onCreate) { props.onCreate(data); clear(); }
  };
  const undo = () => { cancelPreview(); const next = committed.current.slice(0, -1); committed.current = next; setPoints(next); setPreview([]); };
  const cancelGesture = () => { cancelPreview(); stopHold(gesture.current); gesture.current = null; setPreview([]); setEditing(null); };
  useEffect(() => {
    const active = gesture.current;
    if (active?.entity?.kind === "markup" && !active.activate && (!props.onUpdate || !canEdit(active.entity))) {
      active.edited = undefined;
      setEditing(null);
    }
  }, [props.onUpdate, canEdit]);
  const distance = (a: DrawingPoint, b: DrawingPoint) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
  const down = (point: DrawingPoint | null, target: EventTarget | null) => {
    if (!point) return false;
    const element = target instanceof Element ? target.closest<SVGElement>("[data-annotation-id]") : null;
    const entity = props.hideAnnotations ? undefined : props.annotations?.find(item => item.id === element?.dataset.annotationId);
    if (tool === "pan") {
      if (!entity || (entity.kind !== "issue" && entity.kind !== "markup")) return false;
      const active: Gesture = { start: point, points: [point], moved: false, entity, activate: true };
      gesture.current = active;
      if (holdsToSelect(entity)) startHold(active);
      return true;
    }
    if (tool === "select") {
      if (!entity) { props.onSelect?.(null); return false; }
      // Selecting can show a toolbar and change the sheet's fitted size. Keep
      // that layout change after the gesture uses its final coordinates.
      const handleElement = target instanceof Element ? target.closest<SVGElement>("[data-annotation-handle]") : null;
      const handleName = handleElement?.dataset.annotationHandle;
      const corner = handleName && ["nw", "ne", "sw", "se"].includes(handleName) ? handleName as DrawingResizeHandle : undefined;
      const vertex = handleName !== undefined ? Number(handleName) : undefined;
      const handle = props.selectionMode === "move" ? undefined : corner ??
        (vertex !== undefined && Number.isInteger(vertex) && vertex >= 0 && entity.kind === "markup" && vertex < entity.data.points.length ? vertex : undefined);
      // Handles on an already selected markup respond at once; the body needs a hold.
      const active: Gesture = { start: point, points: [point], moved: false, entity, handle, armed: handle !== undefined || !holdsToSelect(entity) };
      gesture.current = active;
      if (!active.armed) startHold(active);
      return true;
    }
    if (!props.onCreate && !props.onPoint) return false;
    gesture.current = { start: point, points: [point], moved: false };
    if (isStrokeTool(tool)) setPreview([point]);
    return true;
  };
  const publishPreview = (show = true) => {
    const active = gesture.current;
    const point = active?.latest;
    if (!active || !point || active.activate) return;
    if (active.entity?.kind === "markup") {
      if (!props.onUpdate || !canEdit(active.entity)) {
        active.edited = undefined;
        if (show) setEditing(null);
        return;
      }
      if (!active.moved) return;
      const original = active.entity.data;
      active.edited = typeof active.handle === "string"
        ? resizeDrawingMarkup(original, active.handle, point, aspect)
        : { ...original, points: active.handle !== undefined
          ? original.points.map((p, index) => index === active.handle ? point : p)
          : translateDrawingPoints(original.points, { x: point.x - active.start.x, y: point.y - active.start.y }) };
      if (show) setEditing({ id: active.entity.id, data: active.edited });
    } else if (show && isStrokeTool(tool)) {
      setPreview([...active.points]);
    } else if (show && tool !== "select" && tool !== "issue" && tool !== "rfi" && tool !== "text") {
      setPreview(isPathTool(tool) ? [...committed.current, point] : [committed.current[0] ?? active.start, point]);
    }
  };
  publishRef.current = publishPreview;
  const move = (point: DrawingPoint | null) => {
    const active = gesture.current;
    if (!active) return false;
    if (!point) {
      if (active.activate) { active.moved = true; return false; }
      return true;
    }
    if (active.panning) return false;
    active.moved ||= distance(point, active.start) * screenWidth > 6;
    if (active.activate) {
      if (active.moved) stopHold(active);
      else active.latest = point;
      return !active.moved;
    }
    if (active.entity && !active.armed) {
      if (!active.moved) return true;
      // Dragged before the hold completed: this is a pan, not a move.
      stopHold(active); active.panning = true; active.moved = false;
      return false;
    }
    active.latest = point;
    if (active.entity?.kind === "markup") {
      if (!active.moved) return true;
    } else if (isStrokeTool(tool)) {
      // Retain input samples independently of display rate. Rendering once per
      // frame must not throw away a pen corner or change the final saved path.
      if (distance(point, active.points.at(-1)!) * screenWidth < 1 || active.points.length >= 3900) return true;
      active.points.push(point);
    }
    schedulePreview();
    return true;
  };
  const up = (point: DrawingPoint | null) => {
    const active = gesture.current;
    if (!active) return false;
    stopHold(active);
    if (active.panning) { gesture.current = null; return false; }
    if (point) move(point);
    cancelPreview();
    // Release can happen before the scheduled frame. Commit the final geometry
    // synchronously so a fast drag never saves an earlier pointer position.
    publishPreview(false);
    gesture.current = null;
    setPreview([]);
    if (!point) { setEditing(null); return true; }
    if (active.entity) {
      // Links and issue pins still respond to a tap; markups need a hold to be selected.
      if (active.activate && !active.moved) {
        if (active.entity.kind === "markup" && active.entity.data.type === "link") props.onActivate?.(active.entity.data);
        else if (!holdsToSelect(active.entity)) props.onSelect?.(active.entity.id);
      }
      if (active.edited && active.moved && props.onUpdate && canEdit(active.entity)) props.onUpdate(active.entity.id, active.edited);
      if (!active.activate && active.armed) props.onSelect?.(active.entity.id);
      setEditing(null);
      return !active.activate || !active.moved;
    }
    if (tool === "issue" || tool === "rfi") { if (!active.moved) props.onPoint?.(tool, point); return true; }
    if (tool === "text") { if (!active.moved) finish([point]); return true; }
    if (isStrokeTool(tool)) {
      const next = simplifyDrawingStroke([...active.points, point], 0.7 / Math.max(1, screenWidth), aspect);
      if (next.length >= 2) finish(next);
    } else if (isPathTool(tool)) {
      if (active.moved) return true;
      const next = [...committed.current, point].slice(0, 1000);
      committed.current = next; setPoints(next);
      if (tool === "angle" && next.length === 3) finish(next);
    } else if (active.moved || committed.current.length) finish([committed.current[0] ?? active.start, point]);
    else { committed.current = [point]; setPoints([point]); }
    return true;
  };
  useEffect(() => {
    if (tool === "pan" && !props.selectedId && !gesture.current) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "Escape" && (tool !== "pan" || gesture.current)) { event.preventDefault(); clear(); }
      if (tool !== "pan" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      if (tool !== "pan" && event.key === "Enter" && committed.current.length >= minimumDrawingPoints(tool)) { event.preventDefault(); finish(); }
      const selected = props.annotations?.find(entity => entity.id === props.selectedId);
      if ((event.key === "Delete" || event.key === "Backspace") && (tool === "select" || tool === "pan") && selected && props.onDelete && canEdit(selected)) {
        event.preventDefault(); props.onDelete(selected.id);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return {
    down, move, up, cancelGesture, clear, undo, finish: () => finish(), editing, heldId,
    draft: dataFor(preview.length ? preview : points),
    pointCount: points.length, canFinish: points.length >= minimumDrawingPoints(tool),
    active: () => gesture.current !== null,
  };
}
