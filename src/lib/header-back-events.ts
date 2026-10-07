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
// the app bar's back arrow so it steps back within the screen first. The
// phone's back button/gesture does the same: while any override is active a
// "guard" history entry sits on top, so system back lands here instead of
// skipping past the screen (or closing the installed app on Android).
const backOverrides: Array<{ current: () => void }> = [];
const GUARD_KEY = "foremenhqBackGuard";
let guardOnTop = false;
let ignoreNextPop = false;
let listening = false;
let syncQueued = false;

function isGuard(state: unknown) {
  return Boolean((state as Record<string, unknown> | null)?.[GUARD_KEY]);
}

/** Adds or removes the guard entry to match whether any override is active. */
function syncGuard() {
  syncQueued = false;
  if (backOverrides.length > 0 && !guardOnTop) {
    // Copy the current state (Next's routing data and the workspace location)
    // so leaving the guard restores exactly the same screen.
    window.history.pushState({ ...window.history.state, [GUARD_KEY]: true }, "");
    guardOnTop = true;
  } else if (backOverrides.length === 0 && guardOnTop) {
    guardOnTop = false;
    // Closed from the app (e.g. the back arrow): drop the unused guard.
    if (isGuard(window.history.state)) {
      ignoreNextPop = true;
      window.history.back();
    }
  }
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  // After React has applied the override's effects (a handler may close the
  // screen, which removes its override).
  window.setTimeout(syncGuard, 0);
}

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  if (!guardOnTop) return;
  guardOnTop = false;
  backOverrides.at(-1)?.current();
  queueSync();
}

/** Runs the most recent back override. Returns false when there is none. */
export function runHeaderBackOverride() {
  const top = backOverrides.at(-1);
  if (!top) return false;
  top.current();
  return true;
}

/**
 * While `handler` is non-null, the app bar's back arrow and the phone's back
 * button/gesture call it instead of leaving the screen.
 */
export function useHeaderBackOverride(handler: (() => void) | null) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    if (!listening) {
      listening = true;
      window.addEventListener("popstate", onPopState);
    }
    const entry = { current: () => latest.current?.() };
    backOverrides.push(entry);
    queueSync();
    return () => {
      const index = backOverrides.indexOf(entry);
      if (index >= 0) backOverrides.splice(index, 1);
      queueSync();
    };
  }, [active]);
}
