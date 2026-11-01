"use client";

import { useLayoutEffect } from "react";

const holders = new Map<string, number>();

/**
 * Sets an attribute on <html> while any mounted caller wants it. Page-wide CSS
 * keys off it instead of html:has(...), which makes the browser recheck the
 * whole page's style on every DOM change, such as each tile a zoom adds.
 */
export function useRootFlag(name: string, on = true) {
  useLayoutEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    holders.set(name, (holders.get(name) ?? 0) + 1);
    root.setAttribute(name, "");
    return () => {
      const left = (holders.get(name) ?? 1) - 1;
      if (left > 0) return void holders.set(name, left);
      holders.delete(name);
      root.removeAttribute(name);
    };
  }, [name, on]);
}
