"use client";

import { useEffect } from "react";

/** Safari gesture fallback: custom viewers keep receiving their pointer events. */
export function AppTouchGestures() {
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
