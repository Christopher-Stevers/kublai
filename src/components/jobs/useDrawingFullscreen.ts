"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { deviceIsLandscape } from "~/components/app/LandscapeNavigation";

type Orientation = "portrait" | "landscape";
const preferenceKey = (orientation: Orientation) => `foremanhq:drawing-fullscreen:${orientation}`;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Native fullscreen when available, with the same drawing-only view as a fallback. */
export function useDrawingFullscreen(active: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  const enterButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const wanted = useRef(false);
  const native = useRef(false);
  const nativeTarget = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const orientation = useRef<Orientation>("portrait");
  const sessionPreferences = useRef<Partial<Record<Orientation, boolean>>>({});
  const remember = useCallback((value: boolean) => {
    sessionPreferences.current[orientation.current] = value;
    try { localStorage.setItem(preferenceKey(orientation.current), String(value)); } catch {
      // Keep the choice for this session when browser storage is unavailable.
    }
  }, []);

  // Navigation and rotation must not turn an automatic exit into a saved choice.
  const close = useCallback(() => {
    native.current = false;
    wanted.current = false;
    setFullscreen(false);
    if (
      nativeTarget.current &&
      document.fullscreenElement === nativeTarget.current
    ) {
      void document.exitFullscreen().catch(() => {
        // Keep the exit control accessible if the browser has not actually exited.
        if (document.fullscreenElement === nativeTarget.current) {
          native.current = true;
          wanted.current = true;
          setFullscreen(true);
        }
      });
    }
  }, []);

  const exit = useCallback(() => {
    remember(false);
    close();
  }, [close, remember]);

  const enter = useCallback(() => {
    const target = surface.current;
    if (!target) return;
    remember(true);
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
  }, [remember]);

  useEffect(() => {
    const changed = () => {
      if (
        nativeTarget.current &&
        document.fullscreenElement === nativeTarget.current
      ) {
        native.current = wanted.current;
        if (!wanted.current) {
          void document.exitFullscreen().catch(() => undefined);
        }
      } else if (native.current) {
        // App switching, locking the phone, and browser UI can end native
        // fullscreen without an Exit action. Keep the drawing-only fallback
        // and the saved orientation choice; Exit/Escape explicitly clear them.
        native.current = false;
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

  useClientLayoutEffect(() => {
    if (!active) return;
    let previous: Orientation | undefined;
    const restore = () => {
      const next: Orientation = deviceIsLandscape() ? "landscape" : "portrait";
      if (next === previous) return;
      previous = next;
      orientation.current = next;
      let preference = sessionPreferences.current[next];
      if (preference === undefined) {
        try {
          const saved = localStorage.getItem(preferenceKey(next));
          if (saved === "true" || saved === "false") preference = saved === "true";
        } catch { /* Use the orientation default when storage is unavailable. */ }
      }
      if (preference ?? next === "landscape") {
        // Browsers require a user gesture for native fullscreen. Restore the
        // same drawing-only layout without requesting browser fullscreen.
        wanted.current = true;
        setFullscreen(true);
      } else close();
    };
    restore();
    const media = window.matchMedia?.("(orientation: landscape)");
    media?.addEventListener?.("change", restore);
    window.screen.orientation?.addEventListener?.("change", restore);
    window.addEventListener("orientationchange", restore);
    window.addEventListener("resize", restore);
    return () => {
      media?.removeEventListener?.("change", restore);
      window.screen.orientation?.removeEventListener?.("change", restore);
      window.removeEventListener("orientationchange", restore);
      window.removeEventListener("resize", restore);
      close();
    };
  }, [active, close]);

  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (fullscreen) exitButton.current?.focus({ preventScroll: true });
    else if (wasFullscreen.current)
      enterButton.current?.focus({ preventScroll: true });
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);

  return { fullscreen, surface, enterButton, exitButton, enter, exit };
}
