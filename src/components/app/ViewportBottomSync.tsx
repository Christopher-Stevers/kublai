"use client";

import { useEffect } from "react";
import { bindViewportBottom } from "~/lib/viewport-bottom";

/** Keeps `.pin-viewport-bottom` bars on the screen's bottom edge on iPad. */
export function ViewportBottomSync() {
  useEffect(() => bindViewportBottom(), []);
  return null;
}
