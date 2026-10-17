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
// phone's back button/gesture does the same. Android uses native close requests
// so cold launches do not depend on skippable synthetic history. Other browsers
// retain a sentinel history entry while an override is active.
const backOverrides: Array<{
  current: () => void;
  guard: boolean;
  priority: number;
}> = [];
const GUARD_KEY = "foremenhqBackGuard";
let guardOnTop = false;
let listening = false;
let syncQueued = false;
type NativeBackWatcher = EventTarget & { destroy: () => void };
type NativeBackConstructor = new () => NativeBackWatcher;
let nativeBackWatcher: NativeBackWatcher | null = null;

function androidCloseWatcher() {
  // Android can skip synthetic history entries created before interaction, and
  // again after a traversal. Its close-request API handles the actual system
  // Back even on a freshly launched deep link, without fake user activation.
  if (!/Android/i.test(navigator.userAgent)) return undefined;
  return (window as Window & { CloseWatcher?: NativeBackConstructor })
    .CloseWatcher;
}

function clearGuardMarker() {
  guardOnTop = false;
  if (!isGuard(window.history.state)) return;
  const state = { ...(window.history.state as Record<string, unknown> | null) };
  delete state[GUARD_KEY];
  window.history.replaceState(state, "");
}

function isGuard(state: unknown) {
  return Boolean((state as Record<string, unknown> | null)?.[GUARD_KEY]);
}

/** One native watcher for the entire hierarchy: one close request = one level. */
function syncGuard() {
  syncQueued = false;
  const wantGuard = backOverrides.some((entry) => entry.guard);
  const Watcher = androidCloseWatcher();
  if (wantGuard && Watcher) {
    if (!nativeBackWatcher) {
      try {
        const watcher = new Watcher();
        nativeBackWatcher = watcher;
        watcher.addEventListener("close", () => {
          if (nativeBackWatcher !== watcher) return;
          nativeBackWatcher = null; // Native close has already disposed it.
          topOverride()?.current();
          // Let React apply the parent before rearming. At the Jobs root there
          // are no parent overrides, so normal platform close is available.
          queueSync();
        });
      } catch {
        /* Older/embedded browsers can retain the history fallback. */
      }
    }
    if (nativeBackWatcher) {
      clearGuardMarker();
      return;
    }
  }
  nativeBackWatcher?.destroy();
  nativeBackWatcher = null;
  if (wantGuard && (!guardOnTop || !isGuard(window.history.state))) {
    // A restored marker belongs to a previous document, not a valid sentinel
    // for this JS instance. Keep routing/workspace state and clear that marker.
    if (!guardOnTop) clearGuardMarker();
    window.history.pushState(
      { ...window.history.state, [GUARD_KEY]: true },
      "",
    );
    guardOnTop = true;
  } else if (!wantGuard && guardOnTop) {
    clearGuardMarker();
  }
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  // After React has applied the override's effects (a handler may close the
  // screen, which removes its override).
  window.setTimeout(syncGuard, 0);
}

function topOverride() {
  return backOverrides.reduce<(typeof backOverrides)[number] | undefined>(
    (top, entry) => (!top || entry.priority >= top.priority ? entry : top),
    undefined,
  );
}

function onPopState(event: PopStateEvent) {
  if (!guardOnTop || isGuard(window.history.state)) return;
  // Claim the traversal before Next or a workspace restores a visited screen.
  event.stopImmediatePropagation();
  guardOnTop = false;
  topOverride()?.current();
  queueSync();
}

/** Runs the most recent back override. Returns false when there is none. */
export function runHeaderBackOverride() {
  const top = topOverride();
  if (!top) return false;
  top.current();
  return true;
}

/**
 * While `handler` is non-null, the app bar's back arrow and the phone's back
 * button/gesture call it instead of leaving the screen.
 */
export function useHeaderBackOverride(
  handler: (() => void) | null,
  /** historyGuard: false for screens that keep their own history entries. */
  {
    historyGuard = true,
    priority = 0,
    scope,
  }: { historyGuard?: boolean; priority?: number; scope?: string } = {},
) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    if (!listening) {
      listening = true;
      window.addEventListener("popstate", onPopState, true);
    }
    const entry = {
      current: () => latest.current?.(),
      guard: historyGuard,
      priority,
    };
    backOverrides.push(entry);
    queueSync();
    return () => {
      const index = backOverrides.indexOf(entry);
      if (index >= 0) backOverrides.splice(index, 1);
      queueSync();
    };
  }, [active, historyGuard, priority, scope]);
}
