"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type HTMLAttributes,
} from "react";

export type PressMode = "release" | "fixed" | "scroll";
export type PressPreparation = (signal: AbortSignal) => void;
const MOVE_TOLERANCE = 10;
function ordinary(event: {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}
function ownsTarget(event: {
  target: EventTarget;
  currentTarget: EventTarget;
}) {
  const target = event.target;
  if (!(target instanceof Element) || !(event.currentTarget instanceof Element))
    return false;
  if (!event.currentTarget.contains(target)) return false;
  const interactive = target.closest(
    'a,button,input,select,textarea,[role="button"],[role="menuitem"],[data-press-ignore]',
  );
  return !interactive || interactive === event.currentTarget;
}
// A fixed press can replace/unmount its own control before the browser's click.
// Suppress that pointer's compatibility click at capture, even on a new target.
// A fresh pointerdown or keyboard/assistive click is never consumed.
function guardCompatibilityClick(pointerId: number) {
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => {
    document.removeEventListener("click", click, true);
    document.removeEventListener("pointerdown", clear, true);
    window.removeEventListener("pointerup", released, true);
    window.removeEventListener("pointercancel", released, true);
    clearTimeout(timer);
  };
  const click = (event: globalThis.MouseEvent) => {
    if (event.detail === 0) return;
    if (
      "pointerId" in event &&
      event.pointerId !== pointerId &&
      event.pointerId !== -1
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clear();
  };
  const released = (event: globalThis.PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    clearTimeout(timer);
    timer = setTimeout(clear, 800);
  };
  document.addEventListener("click", click, true);
  document.addEventListener("pointerdown", clear, true);
  window.addEventListener("pointerup", released, true);
  window.addEventListener("pointercancel", released, true);
  // Bound a lost pointer; ordinary long holds retain the guard through release.
  timer = setTimeout(clear, 30_000);
}

/** Only reviewed fixed controls opt into down activation. Scroll rows prepare on
 * down and retain the native click/release path. No write is queued here. */
export function usePress<T extends HTMLElement>({
  press = "release",
  disabled = false,
  onClick,
  prepare,
}: {
  press?: PressMode;
  disabled?: boolean;
  onClick?: (event: MouseEvent<T>) => void;
  prepare?: PressPreparation;
}) {
  const [pressed, setPressed] = useState(false);
  const state = useRef<{
    pointerId: number;
    x: number;
    y: number;
    cancelled: boolean;
    handled: boolean;
    controller: AbortController;
  } | null>(null);
  const detach = useRef<() => void>(() => undefined);
  const handlers = useRef({ onClick, prepare, disabled, press });
  handlers.current = { onClick, prepare, disabled, press };
  useEffect(
    () => () => {
      detach.current();
      state.current?.controller.abort();
    },
    [],
  );
  useEffect(() => {
    if (!disabled) return;
    detach.current();
    state.current?.controller.abort();
    state.current = null;
    setPressed(false);
  }, [disabled]);

  const cancel = () => {
    if (state.current) {
      state.current.cancelled = true;
      state.current.controller.abort();
    }
    setPressed(false);
  };
  const onPointerDown = (event: ReactPointerEvent<T>) => {
    if (
      event.defaultPrevented ||
      handlers.current.disabled ||
      !ordinary(event) ||
      event.isPrimary === false ||
      !ownsTarget(event)
    )
      return;
    detach.current();
    state.current?.controller.abort();
    const element = event.currentTarget;
    const active = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cancelled: false,
      handled: false,
      controller: new AbortController(),
    };
    state.current = active;
    setPressed(true);
    const move = (next: globalThis.PointerEvent) => {
      if (
        next.pointerId === active.pointerId &&
        Math.hypot(next.clientX - active.x, next.clientY - active.y) >
          MOVE_TOLERANCE
      )
        cancel();
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== active.pointerId) return;
      const bounds = element.getBoundingClientRect();
      const outsideTarget =
        next.target instanceof Node && !element.contains(next.target);
      const outsideBounds =
        bounds.width > 0 &&
        bounds.height > 0 &&
        (next.clientX < bounds.left ||
          next.clientX > bounds.right ||
          next.clientY < bounds.top ||
          next.clientY > bounds.bottom);
      if (outsideTarget || outsideBounds) cancel();
      if (
        next.type === "pointercancel" ||
        Math.hypot(next.clientX - active.x, next.clientY - active.y) >
          MOVE_TOLERANCE
      )
        cancel();
      setPressed(false);
      detach.current();
    };
    const scroll = () => cancel();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("scroll", scroll, true);
    detach.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("scroll", scroll, true);
    };
    if (handlers.current.press === "scroll") {
      try {
        handlers.current.prepare?.(active.controller.signal);
      } catch {
        /* Preparation never blocks activation. */
      }
    }
    if (handlers.current.press === "fixed" && handlers.current.onClick) {
      active.handled = true;
      guardCompatibilityClick(active.pointerId);
      // Match native focus before the action mounts an autofocus field/dialog;
      // then prevent the later pointer default from stealing its new focus.
      event.currentTarget.focus({ preventScroll: true });
      handlers.current.onClick(event);
      event.preventDefault();
    }
  };
  const click = (event: MouseEvent<T>) => {
    if (disabled || event.defaultPrevented || !ownsTarget(event)) return;
    const active = state.current;
    const pointerClick = event.detail > 0;
    if (pointerClick && !ordinary(event)) return;
    if (pointerClick && active && (active.cancelled || active.handled)) {
      event.preventDefault();
      event.stopPropagation();
      state.current = null;
      return;
    }
    detach.current();
    state.current = null;
    setPressed(false);
    onClick?.(event);
  };
  return {
    pressed,
    pressProps: {
      onPointerDown,
      onClick: click,
      onKeyDown: (event) => {
        if (!disabled && (event.key === " " || event.key === "Enter"))
          setPressed(true);
      },
      onKeyUp: () => setPressed(false),
      onBlur: cancel,
      "data-pressed": pressed ? "true" : undefined,
    } satisfies HTMLAttributes<T> & { "data-pressed"?: string },
  };
}
