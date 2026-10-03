import { useEffect, useLayoutEffect, useRef } from "react";

export const HEADER_BACK_STATE_EVENT = "foremenhq:header-back-state";
export const HEADER_BACK_REQUEST_EVENT = "foremenhq:header-back-request";

export type HeaderBackStateDetail = {
  visible: boolean;
};

export function setHeaderBackVisible(visible: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HeaderBackStateDetail>(HEADER_BACK_STATE_EVENT, {
      detail: { visible },
    }),
  );
}

export function requestHeaderBack() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HEADER_BACK_REQUEST_EVENT));
}

// Screens nested inside a page (e.g. a floor plan inside Rooms) can take over
// the app bar's back arrow so it steps back within the screen first.
const backOverrides: Array<{ current: () => void }> = [];

/** Runs the most recent back override. Returns false when there is none. */
export function runHeaderBackOverride() {
  const top = backOverrides.at(-1);
  if (!top) return false;
  top.current();
  return true;
}

/** While `handler` is non-null, the app bar's back arrow calls it instead. */
export function useHeaderBackOverride(handler: (() => void) | null) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => latest.current?.() };
    backOverrides.push(entry);
    return () => {
      const index = backOverrides.indexOf(entry);
      if (index >= 0) backOverrides.splice(index, 1);
    };
  }, [active]);
}
