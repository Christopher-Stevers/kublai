"use client";

import { useEffect } from "react";
import { useRootFlag } from "~/hooks/use-root-flag";

/** Safari gesture fallback: custom viewers keep receiving their pointer events. */
export function AppTouchGestures() {
  // Extends the app's pinch guard to <html>, <body> and portalled dialogs.
  useRootFlag("data-app-touch");
  useEffect(() => {
    const preventPagePinch = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener("gesturestart", preventPagePinch, { passive: false });
    document.addEventListener("gesturechange", preventPagePinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventPagePinch);
      document.removeEventListener("gesturechange", preventPagePinch);
    };
  }, []);
  return null;
}
