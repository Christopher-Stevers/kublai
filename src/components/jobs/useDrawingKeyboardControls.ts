"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  activeShortcutDialog,
  keyboardShortcutBlocked,
  shortcutElementAvailable,
} from "~/lib/keyboard-shortcuts";

type DrawingKey = "w" | "a" | "s" | "d" | "q" | "e";
const keys = new Set<string>(["w", "a", "s", "d", "q", "e"]);
const surfaces = new Set<HTMLElement>();
let preferred: HTMLElement | null = null;

/** Only the visible, most recently used sheet owns drawing keyboard controls. */
export function useDrawingKeyboardControls(
  frame: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onKey: (key: DrawingKey) => void,
) {
  const handler = useRef(onKey);
  useLayoutEffect(() => {
    handler.current = onKey;
  });
  useEffect(() => {
    const element = frame.current;
    if (!element || !enabled) return;
    surfaces.add(element);
    const activate = () => {
      preferred = element;
    };
    const keydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!keys.has(key) || keyboardShortcutBlocked(event)) return;
      const dialog = activeShortcutDialog();
      const available = [...surfaces].filter((surface) => {
        if (
          !surface.isConnected ||
          !shortcutElementAvailable(surface) ||
          (dialog && !dialog.contains(surface))
        )
          return false;
        const rect = surface.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < innerHeight &&
          rect.left < innerWidth
        );
      });
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-drawing-keyboard-surface]")
          : null;
      const active =
        target && available.includes(target)
          ? target
          : preferred && available.includes(preferred)
            ? preferred
            : available.at(-1);
      if (active !== element) return;
      event.preventDefault();
      handler.current(key as DrawingKey);
    };
    element.addEventListener("pointerdown", activate, true);
    element.addEventListener("focusin", activate);
    window.addEventListener("keydown", keydown);
    return () => {
      surfaces.delete(element);
      if (preferred === element) preferred = null;
      element.removeEventListener("pointerdown", activate, true);
      element.removeEventListener("focusin", activate);
      window.removeEventListener("keydown", keydown);
    };
  }, [frame, enabled]);
}
