"use client";
import { useLayoutEffect } from "react";

const positions = new Map<string, number>();
const prefix = "foremanhq.scroll:";

/** Remember a view across route changes and in-place dashboard navigation. */
export function useRememberedScroll(key: string | null, ready = true) {
  useLayoutEffect(() => {
    if (!key || !ready) return;
    let target = positions.get(key) ?? 0;
    try {
      const saved = window.sessionStorage.getItem(prefix + key);
      if (saved !== null && Number.isFinite(Number(saved)) && Number(saved) >= 0)
        target = Number(saved);
    } catch { /* The session fallback still works when storage is unavailable. */ }
    let lastY = target;
    let restoring = true;
    let frame = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 5000;
    const persist = () => {
      positions.set(key, lastY);
      try { window.sessionStorage.setItem(prefix + key, String(lastY)); } catch {}
    };
    const save = () => {
      if (restoring) return;
      lastY = Math.max(0, window.scrollY);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; persist(); });
    };
    const stopRestoring = () => {
      restoring = false;
      observer?.disconnect();
      clearTimeout(retry);
    };
    const restore = () => {
      if (!restoring) return;
      const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      if (height - window.innerHeight >= target || Date.now() >= deadline) {
        window.scrollTo({ top: target, behavior: "instant" });
        stopRestoring();
      } else {
        clearTimeout(retry);
        retry = setTimeout(restore, 100);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) stopRestoring();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restore);
    observer?.observe(document.body);
    // Run after the router's own scroll reset, rather than fighting it on mount.
    const initialFrame = requestAnimationFrame(restore);
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("wheel", stopRestoring, { passive: true });
    window.addEventListener("touchstart", stopRestoring, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(frame);
      clearTimeout(retry);
      observer?.disconnect();
      window.removeEventListener("scroll", save);
      window.removeEventListener("wheel", stopRestoring);
      window.removeEventListener("touchstart", stopRestoring);
      window.removeEventListener("keydown", onKey);
      // Use the last scroll event, not a destination page's newly clamped offset.
      if (!restoring) persist();
    };
  }, [key, ready]);
}
