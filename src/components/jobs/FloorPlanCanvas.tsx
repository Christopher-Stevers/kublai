"use client";

import { useEffect, useRef, useState } from "react";
import { getRoomColor } from "~/lib/room-colors";
import {
  insertPointAtClick,
  movePolygonPoint,
  polygonPointsAttr,
  removePolygonPoint,
  shapeBBox,
  toPolygon,
  type RoomPolygonShape,
  type RoomShape,
} from "~/lib/room-shape";

export type FloorRoomShape = RoomShape;

export type FloorRoom = {
  id: string;
  name: string;
  confirmed: boolean;
  shape: FloorRoomShape;
};

type Point = { x: number; y: number };

const MIN_SCALE = 1;
const MAX_SCALE = 24;
const LONG_PRESS_MS = 550;
const PAN_SLOP_PX = 12;
const DETECT_TAP_SLOP_PX = 32;

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function roomLabelFontSize(name: string, box: { w: number; h: number }) {
  const byHeight = box.h * 0.28;
  const byWidth = box.w / Math.max(name.length * 0.62, 2);
  return Math.max(0.0035, Math.min(byHeight, byWidth, 0.022));
}

export function FloorPlanCanvas({
  imageUrl,
  rooms,
  selectedRoomId,
  editingRoomId,
  detectingRoomId,
  createMode = false,
  detectMode = false,
  vertexMode = null,
  canEdit,
  onSelectRoom,
  onStartEdit,
  onCreateRoom,
  onUpdateShape,
  onDetectRoom,
  onDetectAtPoint,
}: {
  imageUrl: string;
  rooms: FloorRoom[];
  selectedRoomId?: string | null;
  editingRoomId?: string | null;
  detectingRoomId?: string | null;
  createMode?: boolean;
  detectMode?: boolean;
  vertexMode?: "add" | "delete" | null;
  canEdit: boolean;
  onSelectRoom: (roomId: string) => void;
  onStartEdit?: (roomId: string) => void;
  onCreateRoom?: (shape: RoomPolygonShape) => void;
  onUpdateShape?: (roomId: string, shape: RoomPolygonShape) => void;
  onDetectRoom?: (roomId: string) => void;
  onDetectAtPoint?: (point: Point) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{
    dist: number;
    mid: Point;
    scale: number;
    tx: number;
    ty: number;
  } | null>(null);
  const dragOrigin = useRef<Point | null>(null);
  const panStart = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  const didPan = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressHandled = useRef(false);
  const draggingVertex = useRef<{ roomId: string; index: number } | null>(
    null,
  );
  const pendingDetectRoomId = useRef<string | null>(null);
  const pendingDetectPoint = useRef<Point | null>(null);
  const detectFired = useRef(false);
  const detectModeRef = useRef(detectMode);
  detectModeRef.current = detectMode;
  const [draft, setDraft] = useState<RoomPolygonShape | null>(null);
  const [editShape, setEditShape] = useState<RoomPolygonShape | null>(null);
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  const editingRoom = rooms.find((room) => room.id === editingRoomId) ?? null;
  const visibleEditShape =
    editShape ?? (editingRoom ? toPolygon(editingRoom.shape) : null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const toPlanNorm = (clientX: number, clientY: number): Point | null => {
    const plan = planRef.current?.getBoundingClientRect();
    if (!plan || plan.width === 0 || plan.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - plan.left) / plan.width)),
      y: Math.min(1, Math.max(0, (clientY - plan.top) / plan.height)),
    };
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
    };
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => viewport.removeEventListener("touchmove", onTouchMove);
  }, []);

  useEffect(() => {
    if (!editingRoomId) {
      setEditShape(null);
      return;
    }
    const room = roomsRef.current.find((item) => item.id === editingRoomId);
    setEditShape(room ? toPolygon(room.shape) : null);
  }, [editingRoomId]);

  const applyPinch = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size < 2 || !pinch.current) return;
    const points = [...pointers.current.values()];
    const a = points[0];
    const b = points[1];
    if (!a || !b) return;
    const dist = Math.max(distance(a, b), 1);
    const mid = midpoint(a, b);
    const p = pinch.current;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, p.scale * (dist / p.dist)),
    );
    setTransform({
      scale: nextScale,
      tx: mid.x - (p.mid.x - p.tx) * (nextScale / p.scale),
      ty: mid.y - (p.mid.y - p.ty) * (nextScale / p.scale),
    });
  };

  const commitEdit = (shape: RoomPolygonShape) => {
    if (!editingRoomId || !onUpdateShape) return;
    onUpdateShape(editingRoomId, shape);
  };

  const firePendingDetect = () => {
    if (
      detectFired.current ||
      !detectModeRef.current ||
      editingRoomId ||
      createMode ||
      longPressHandled.current
    ) {
      return false;
    }
    if (pendingDetectRoomId.current && onDetectRoom) {
      detectFired.current = true;
      onDetectRoom(pendingDetectRoomId.current);
      return true;
    }
    if (pendingDetectPoint.current && onDetectAtPoint) {
      detectFired.current = true;
      onDetectAtPoint(pendingDetectPoint.current);
      return true;
    }
    return false;
  };

  return (
    <div
      ref={viewportRef}
      className={`relative h-full min-h-0 w-full touch-none overflow-hidden rounded-lg bg-gray-100 ${detectMode ? "cursor-crosshair" : ""}`}
      onPointerDown={(event) => {
        if (!detectMode) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        longPressHandled.current = false;
        didPan.current = false;
        detectFired.current = false;
        panStart.current = null;
        if (pointers.current.size === 2) {
          clearLongPress();
          dragOrigin.current = null;
          draggingVertex.current = null;
          panStart.current = null;
          pendingDetectRoomId.current = null;
          pendingDetectPoint.current = null;
          setDraft(null);
          const points = [...pointers.current.values()];
          const a = points[0];
          const b = points[1];
          if (!a || !b) return;
          pinch.current = {
            dist: Math.max(distance(a, b), 1),
            mid: midpoint(a, b),
            scale: transformRef.current.scale,
            tx: transformRef.current.tx,
            ty: transformRef.current.ty,
          };
          return;
        }

        const target = event.target as HTMLElement;
        const vertexIndex = target.dataset.vertexIndex;
        if (editingRoomId && vertexIndex != null && visibleEditShape) {
          const index = Number(vertexIndex);
          if (vertexMode === "delete") {
            const next = removePolygonPoint(visibleEditShape, index);
            setEditShape(next);
            commitEdit(next);
            return;
          }
          draggingVertex.current = {
            roomId: editingRoomId,
            index,
          };
          return;
        }

        const roomId = target.dataset.roomId;
        pendingDetectRoomId.current = roomId ?? null;
        pendingDetectPoint.current = toPlanNorm(event.clientX, event.clientY);
        if (
          roomId &&
          canEdit &&
          onStartEdit &&
          !editingRoomId &&
          !detectMode
        ) {
          longPressTimer.current = setTimeout(() => {
            longPressHandled.current = true;
            onStartEdit(roomId);
          }, LONG_PRESS_MS);
        }

        if (editingRoomId && visibleEditShape && vertexMode === "add") {
          const point = toPlanNorm(event.clientX, event.clientY);
          if (point) {
            const next = insertPointAtClick(visibleEditShape, point);
            setEditShape(next);
            commitEdit(next);
          }
          return;
        }

        if (createMode && canEdit && onCreateRoom && !roomId) {
          const point = toPlanNorm(event.clientX, event.clientY);
          if (!point) return;
          dragOrigin.current = point;
          setDraft(
            toPolygon({
              type: "bbox",
              x: point.x,
              y: point.y,
              w: 0.01,
              h: 0.01,
            }),
          );
          return;
        }

        panStart.current = {
          x: event.clientX,
          y: event.clientY,
          tx: transformRef.current.tx,
          ty: transformRef.current.ty,
        };
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        if (pointers.current.size >= 2) {
          clearLongPress();
          applyPinch(event);
          return;
        }
        const point = toPlanNorm(event.clientX, event.clientY);
        if (draggingVertex.current && point && visibleEditShape) {
          const next = movePolygonPoint(
            visibleEditShape,
            draggingVertex.current.index,
            point,
          );
          setEditShape(next);
          return;
        }
        if (dragOrigin.current && point) {
          clearLongPress();
          const origin = dragOrigin.current;
          setDraft(
            toPolygon({
              type: "bbox",
              x: Math.min(origin.x, point.x),
              y: Math.min(origin.y, point.y),
              w: Math.max(0.01, Math.abs(point.x - origin.x)),
              h: Math.max(0.01, Math.abs(point.y - origin.y)),
            }),
          );
          return;
        }
        if (panStart.current) {
          const dx = event.clientX - panStart.current.x;
          const dy = event.clientY - panStart.current.y;
          const slop = detectMode ? DETECT_TAP_SLOP_PX : PAN_SLOP_PX;
          if (Math.hypot(dx, dy) > slop) {
            if (!didPan.current && detectMode) {
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            didPan.current = true;
            clearLongPress();
            setTransform({
              scale: transformRef.current.scale,
              tx: panStart.current.tx + dx,
              ty: panStart.current.ty + dy,
            });
          }
        }
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        clearLongPress();
        if (draggingVertex.current && visibleEditShape) {
          commitEdit(visibleEditShape);
          draggingVertex.current = null;
        }
        if (draft && onCreateRoom) {
          const xs = draft.points.map((p) => p.x);
          const ys = draft.points.map((p) => p.y);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          if (w > 0.02 && h > 0.02) onCreateRoom(draft);
        }
        if (detectMode && pointers.current.size === 0 && !didPan.current) {
          firePendingDetect();
        }
        pendingDetectRoomId.current = null;
        pendingDetectPoint.current = null;
        dragOrigin.current = null;
        panStart.current = null;
        setDraft(null);
      }}
      onPointerCancel={() => {
        if (detectMode && !didPan.current) {
          firePendingDetect();
        }
        pointers.current.clear();
        pinch.current = null;
        draggingVertex.current = null;
        dragOrigin.current = null;
        panStart.current = null;
        pendingDetectRoomId.current = null;
        pendingDetectPoint.current = null;
        clearLongPress();
        setDraft(null);
      }}
      onClick={(event) => {
        if (!detectMode || didPan.current || detectFired.current) return;
        const target = event.target as HTMLElement;
        pendingDetectRoomId.current =
          target.dataset.roomId ?? pendingDetectRoomId.current;
        pendingDetectPoint.current =
          toPlanNorm(event.clientX, event.clientY) ??
          pendingDetectPoint.current;
        firePendingDetect();
      }}
      onTouchEnd={(event) => {
        if (!detectMode || didPan.current || detectFired.current) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        pendingDetectPoint.current =
          toPlanNorm(touch.clientX, touch.clientY) ??
          pendingDetectPoint.current;
        firePendingDetect();
      }}
      onWheel={(event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        const current = transformRef.current;
        const nextScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, current.scale * factor),
        );
        const p = { x: event.clientX, y: event.clientY };
        setTransform({
          scale: nextScale,
          tx: p.x - (p.x - current.tx) * (nextScale / current.scale),
          ty: p.y - (p.y - current.ty) * (nextScale / current.scale),
        });
      }}
    >
      <div
        className="origin-top-left"
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
        }}
      >
        <div ref={planRef} className="relative inline-block bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Floor plan"
            className="block max-h-[78dvh] w-auto max-w-[92vw] select-none"
            draggable={false}
          />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            {rooms.map((room, index) => {
              const selected =
                room.id === selectedRoomId ||
                room.id === editingRoomId ||
                room.id === detectingRoomId;
              const color = getRoomColor(index);
              const polygon =
                room.id === editingRoomId && visibleEditShape
                  ? visibleEditShape
                  : toPolygon(room.shape);
              return (
                <polygon
                  key={room.id}
                  data-room-id={room.id}
                  points={polygonPointsAttr(polygon)}
                  fill={color.fill}
                  stroke={color.border}
                  strokeWidth={
                    (selected ? 0.006 : 0.003) / transform.scale
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (
                      detectMode ||
                      didPan.current ||
                      longPressHandled.current ||
                      editingRoomId
                    ) {
                      return;
                    }
                    onSelectRoom(room.id);
                  }}
                />
              );
            })}
            {draft ? (
              <polygon
                points={polygonPointsAttr(draft)}
                fill="rgba(37, 99, 235, 0.18)"
                stroke="#2563eb"
                strokeWidth={0.004 / transform.scale}
                strokeDasharray={`${0.01 / transform.scale} ${0.01 / transform.scale}`}
              />
            ) : null}
            {rooms.map((room, index) => {
              const polygon =
                room.id === editingRoomId && visibleEditShape
                  ? visibleEditShape
                  : toPolygon(room.shape);
              const color = getRoomColor(index);
              const box = shapeBBox(polygon);
              const fontSize = roomLabelFontSize(room.name, box);
              return (
                <text
                  key={`${room.id}-label`}
                  x={box.x + box.w / 2}
                  y={box.y + box.h / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={color.text}
                  fontWeight="700"
                  fontSize={fontSize}
                  style={{ pointerEvents: "none" }}
                >
                  {room.name}
                </text>
              );
            })}
          </svg>
          {detectMode ? (
            <button
              type="button"
              className="absolute inset-0 z-10 border-0 bg-transparent p-0"
              aria-label="Trace unit at this point"
              onClick={(event) => {
                event.stopPropagation();
                if (detectFired.current) return;
                const point = toPlanNorm(event.clientX, event.clientY);
                if (!point || !onDetectAtPoint) return;
                detectFired.current = true;
                onDetectAtPoint(point);
              }}
            />
          ) : null}
          {detectMode
            ? rooms.map((room) => {
                const box = shapeBBox(
                  room.id === editingRoomId && visibleEditShape
                    ? visibleEditShape
                    : room.shape,
                );
                return (
                  <button
                    key={`detect-${room.id}`}
                    type="button"
                    className="absolute z-20 border-0 bg-transparent p-0"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                    }}
                    aria-label={`Trace ${room.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!onDetectRoom) return;
                      detectFired.current = true;
                      onDetectRoom(room.id);
                    }}
                  />
                );
              })
            : null}
          {editingRoomId && visibleEditShape
            ? visibleEditShape.points.map((point, index) => (
                <button
                  key={`${editingRoomId}-v-${index}`}
                  type="button"
                  data-vertex-index={index}
                  className="absolute h-7 w-7 rounded-full border-2 border-white bg-blue-600 shadow"
                  style={{
                    left: `${point.x * 100}%`,
                    top: `${point.y * 100}%`,
                    transform: `translate(-50%, -50%) scale(${1 / transform.scale})`,
                    transformOrigin: "center center",
                  }}
                  aria-label={`Move corner ${index + 1}`}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
