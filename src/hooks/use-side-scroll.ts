"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const FADE = 18;

function scrollAlong(node: HTMLElement, shift: number, smooth: boolean) {
  if (typeof node.scrollBy === "function")
    node.scrollBy({ left: shift, behavior: smooth ? "smooth" : "auto" });
  else node.scrollLeft = Math.max(0, node.scrollLeft + shift);
}

/**
 * Lets a mouse wheel move a sideways list, fades whichever edge hides more and
 * keeps `selector` in view. Returns a callback ref and the list's style.
 */
export function useSideScroll<T extends HTMLElement>(
  selector?: string,
  key?: unknown,
) {
  const [node, setNode] = useState<T | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const ref = useCallback((element: T | null) => setNode(element), []);
  const settle = useRef(false);

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      const start = node.scrollLeft > 1;
      const end = max > 1 && node.scrollLeft < max - 1;
      setEdges((old) =>
        old.start === start && old.end === end ? old : { start, end },
      );
    };
    const wheel = (event: WheelEvent) => {
      const max = node.scrollWidth - node.clientWidth;
      if (max <= 1 || event.ctrlKey) return;
      const delta =
        Math.abs(event.deltaY) > Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      const next = Math.min(max, Math.max(0, node.scrollLeft + delta));
      // At an end, let the page scroll on instead of trapping the wheel.
      if (next === node.scrollLeft) return;
      event.preventDefault();
      node.scrollLeft = next;
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    node.addEventListener("wheel", wheel, { passive: false });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      node.removeEventListener("wheel", wheel);
      observer?.disconnect();
    };
  }, [node]);

  useEffect(() => {
    if (!node || !selector) return;
    const target = node.querySelector<HTMLElement>(selector);
    if (!target) return;
    const box = node.getBoundingClientRect();
    const item = target.getBoundingClientRect();
    const before = item.left - box.left - FADE;
    const after = item.right - box.right + FADE;
    const shift = before < 0 ? before : after > 0 ? after : 0;
    // Jump on first show; glide when the choice changes afterwards.
    const smooth = settle.current;
    settle.current = true;
    if (shift === 0) return;
    scrollAlong(node, shift, smooth);
  }, [node, selector, key]);

  const fade = (on: boolean) => (on ? "transparent" : "#000");
  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${fade(edges.start)}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${fade(edges.end)})`
      : undefined;
  const style: CSSProperties = {
    maskImage: mask,
    WebkitMaskImage: mask,
    overscrollBehaviorX: "contain",
  };
  return [ref, style] as const;
}
