import { useEffect, useRef } from "react";
import type * as React from "react";

export type DragPoint = { x: number; y: number };
export type LongPressDragHandlers = {
  /** The press held still long enough; the drag starts at this point. */
  onLift: (at: DragPoint) => void;
  onMove: (at: DragPoint) => void;
  onDrop: (at: DragPoint) => void;
  onCancel: () => void;
};

export const LONG_PRESS_MS = 450;
// Movement before the hold completes is a scroll, not a drag.
const SLOP = 10;

/**
 * Long press, then drag. Touch listens on the window with a non-passive
 * touchmove, so the page holds still once the drag starts; mouse and pen use
 * pointer events. The click that ends a drag is swallowed.
 */
export function useLongPressDrag() {
  const stop = useRef<(() => void) | null>(null);
  const swallow = useRef(false);
  useEffect(() => () => stop.current?.(), []);

  const begin = (
    start: DragPoint,
    handlers: LongPressDragHandlers,
    listen: (move: (at: DragPoint, event: Event) => void) => () => void,
  ) => {
    stop.current?.();
    swallow.current = false;
    let lifted = false,
      last = start;
    const timer = setTimeout(() => {
      lifted = true;
      swallow.current = true;
      handlers.onLift(last);
    }, LONG_PRESS_MS);
    const finish = () => {
      clearTimeout(timer);
      unlisten();
      window.removeEventListener("keydown", key);
      stop.current = null;
      if (lifted) setTimeout(() => (swallow.current = false), 400);
    };
    const move = (at: DragPoint, event: Event) => {
      last = at;
      if (lifted) {
        if (event.cancelable) event.preventDefault();
        handlers.onMove(at);
      } else if (Math.hypot(at.x - start.x, at.y - start.y) > SLOP) finish();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !lifted) return;
      finish();
      handlers.onCancel();
    };
    const unlisten = listen(move);
    window.addEventListener("keydown", key);
    stop.current = () => {
      finish();
      if (lifted) handlers.onCancel();
    };
    return {
      end: (event: Event) => {
        if (lifted && event.cancelable) event.preventDefault();
        const dropped = lifted;
        finish();
        if (dropped) handlers.onDrop(last);
      },
      cancel: () => stop.current?.(),
    };
  };

  return (handlers: LongPressDragHandlers | null) =>
    handlers
      ? {
          onTouchStart: (event: React.TouchEvent) => {
            const touch = event.touches[0];
            if (!touch || event.touches.length > 1) return stop.current?.();
            const press = begin(
              { x: touch.clientX, y: touch.clientY },
              handlers,
              (move) => {
                const onMove = (e: TouchEvent) => {
                  const t = e.touches[0];
                  if (t) move({ x: t.clientX, y: t.clientY }, e);
                };
                const onEnd = (e: TouchEvent) => press.end(e);
                const onCancel = () => press.cancel();
                window.addEventListener("touchmove", onMove, {
                  passive: false,
                });
                window.addEventListener("touchend", onEnd, { passive: false });
                window.addEventListener("touchcancel", onCancel);
                return () => {
                  window.removeEventListener("touchmove", onMove);
                  window.removeEventListener("touchend", onEnd);
                  window.removeEventListener("touchcancel", onCancel);
                };
              },
            );
          },
          onPointerDown: (event: React.PointerEvent) => {
            // Touch runs through the touch events above.
            if (event.pointerType === "touch") return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const id = event.pointerId;
            const press = begin(
              { x: event.clientX, y: event.clientY },
              handlers,
              (move) => {
                const onMove = (e: PointerEvent) => {
                  if (e.pointerId === id)
                    move({ x: e.clientX, y: e.clientY }, e);
                };
                const onUp = (e: PointerEvent) => {
                  if (e.pointerId === id) press.end(e);
                };
                const onCancel = (e: PointerEvent) => {
                  if (e.pointerId === id) press.cancel();
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
                window.addEventListener("pointercancel", onCancel);
                return () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                  window.removeEventListener("pointercancel", onCancel);
                };
              },
            );
          },
          onClickCapture: (event: React.MouseEvent) => {
            if (!swallow.current) return;
            swallow.current = false;
            event.preventDefault();
            event.stopPropagation();
          },
          // A long press on a phone would otherwise open the system menu.
          onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
        }
      : {};
}
