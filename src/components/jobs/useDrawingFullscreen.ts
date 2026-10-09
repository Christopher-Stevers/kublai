"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Native fullscreen when available, with the same drawing-only view as a fallback. */
export function useDrawingFullscreen(active: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  const enterButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const wanted = useRef(false);
  const native = useRef(false);
  const nativeTarget = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const exit = useCallback(() => {
    wanted.current = false;
    setFullscreen(false);
    if (
      nativeTarget.current &&
      document.fullscreenElement === nativeTarget.current
    ) {
      void document.exitFullscreen().catch(() => {
        // Keep the exit control accessible if the browser has not actually exited.
        if (document.fullscreenElement === nativeTarget.current) {
          wanted.current = true;
          setFullscreen(true);
        }
      });
    }
  }, []);

  const enter = useCallback(() => {
    const target = surface.current;
    if (!target) return;
    wanted.current = true;
    nativeTarget.current = target;
    setFullscreen(true);
    try {
      void target
        .requestFullscreen?.({ navigationUI: "hide" })
        .then(() => {
          // A slow request must not reopen fullscreen after Exit or navigation.
          if (
            (!wanted.current || nativeTarget.current !== target) &&
            document.fullscreenElement === target
          ) {
            void document.exitFullscreen().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    } catch {
      // Some browsers expose the method but cannot use it; retain expanded viewing.
    }
  }, []);

  useEffect(() => {
    const changed = () => {
      if (
        nativeTarget.current &&
        document.fullscreenElement === nativeTarget.current
      ) {
        native.current = true;
        if (!wanted.current) {
          void document.exitFullscreen().catch(() => undefined);
        }
      } else if (native.current) {
        native.current = false;
        wanted.current = false;
        setFullscreen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !wanted.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exit();
    };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", key, true);
      wanted.current = false;
      if (
        nativeTarget.current &&
        document.fullscreenElement === nativeTarget.current
      ) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [exit]);

  useEffect(() => {
    if (!active) return;
    return exit;
  }, [active, exit]);

  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (fullscreen) exitButton.current?.focus({ preventScroll: true });
    else if (wasFullscreen.current)
      enterButton.current?.focus({ preventScroll: true });
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);

  return { fullscreen, surface, enterButton, exitButton, enter, exit };
}
