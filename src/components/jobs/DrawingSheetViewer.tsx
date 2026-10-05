"use client";

import { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
type Point = { x: number; y: number };
type View = { scale: number; x: number; y: number };

/**
 * Pan-and-zoom for one drawing sheet: pinch, drag, mouse wheel and double
 * tap/click. The sheet starts fitted and centred; zoom is relative to that fit.
 * Give it a `key` per sheet so each sheet opens unzoomed.
 */
export function DrawingSheetViewer({ src, alt }: { src: string; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; points: Point[] } | null>(null);
  const lastTap = useRef(0);

  // Fit the sheet inside the frame whenever the image or frame size changes.
  useEffect(() => {
    const el = frame.current;
    const img = image.current;
    if (!el || !img) return;
    const measure = () => {
      if (!img.naturalWidth || !el.clientWidth || !el.clientHeight) return;
      const ratio = Math.min(
        el.clientWidth / img.naturalWidth,
        el.clientHeight / img.naturalHeight,
      );
      setFit({ width: img.naturalWidth * ratio, height: img.naturalHeight * ratio });
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

  /** Keeps the sheet from being dragged entirely out of view. */
  const clamp = (next: View): View => {
    const el = frame.current;
    if (!el || !fit) return next;
    const maxX = Math.max(0, (fit.width * next.scale - el.clientWidth) / 2 + el.clientWidth * 0.4);
    const maxY = Math.max(0, (fit.height * next.scale - el.clientHeight) / 2 + el.clientHeight * 0.4);
    return {
      scale: next.scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  };
  /** Zooms by `factor` keeping the point under `at` (frame centre-relative) still. */
  const zoomAt = (base: View, factor: number, at: Point): View => {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.scale * factor));
    const ratio = scale / base.scale;
    return clamp({
      scale,
      x: at.x - (at.x - base.x) * ratio,
      y: at.y - (at.y - base.y) * ratio,
    });
  };
  const fromCentre = (clientX: number, clientY: number): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
  };
  const startGesture = () => {
    gesture.current = { view, points: [...pointers.current.values()] };
  };

  return (
    <div
      ref={frame}
      className="relative h-full w-full touch-none overflow-hidden bg-muted select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        startGesture();
        if (pointers.current.size === 1) {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            // Double tap: zoom in around the point, or back out when zoomed.
            setView(
              view.scale > 1.5
                ? { scale: 1, x: 0, y: 0 }
                : zoomAt(view, 3, fromCentre(event.clientX, event.clientY)),
            );
            lastTap.current = 0;
          } else lastTap.current = now;
        }
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const now = [...pointers.current.values()];
        const before = gesture.current.points;
        const base = gesture.current.view;
        if (now.length >= 2 && before.length >= 2) {
          const a = now[0]!, b = now[1]!;
          const a0 = before[0]!, b0 = before[1]!;
          const factor =
            Math.hypot(a.x - b.x, a.y - b.y) /
            Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
          const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
          const mid0 = fromCentre((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
          const zoomed = zoomAt(base, factor, mid0);
          setView(clamp({ ...zoomed, x: zoomed.x + mid.x - mid0.x, y: zoomed.y + mid.y - mid0.y }));
        } else if (now.length === 1 && before[0]) {
          const p = now[0]!;
          setView(clamp({ ...base, x: base.x + p.x - before[0].x, y: base.y + p.y - before[0].y }));
        }
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        startGesture();
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        startGesture();
      }}
      onWheel={(event) => {
        setView(
          zoomAt(view, event.deltaY < 0 ? 1.15 : 1 / 1.15, fromCentre(event.clientX, event.clientY)),
        );
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={src}
        alt={alt}
        draggable={false}
        className="absolute top-1/2 left-1/2 max-w-none"
        style={{
          width: fit?.width,
          height: fit?.height,
          visibility: fit ? "visible" : "hidden",
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      />
    </div>
  );
}
