"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { currentSnapshotState } from "~/lib/snapshot-source";
import {
  clearLastJobWorkspaceLocation,
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
  type JobWorkspaceLocation,
} from "~/lib/job-workspace-last-option";

import { navigationPaint, setLocalNavigationScreen, type PaintTicket } from "~/lib/navigation-paint";
import { useHeaderBackOverride } from "~/lib/header-back-events";

const RESTORE_EVENT = "foremenhq:workspace-restore";
const RESET_EVENT = "foremenhq:workspace-root";
const HISTORY_KEY = "foremenhqWorkspace";
type WorkspaceHistory = {
  version: 1;
  pathname: string;
  location: JobWorkspaceLocation | null;
  sourceHash?: string;
};

function readHistory() {
  const state = window.history.state as
    | Record<string, WorkspaceHistory | undefined>
    | null;
  const entry = state?.[HISTORY_KEY];
  return entry?.version === 1 && entry.pathname === window.location.pathname
    ? entry
    : undefined;
}

function writeHistory(
  method: "pushState" | "replaceState",
  location: JobWorkspaceLocation | null,
  sourceHash?: string,
) {
  // Keep Next's routing metadata so a browser back never triggers a reload.
  // The URL stays on the Jobs: these screens also work entirely offline.
  window.history[method](
    {
      ...window.history.state,
      [HISTORY_KEY]: {
        version: 1,
        pathname: window.location.pathname,
        location,
        sourceHash: sourceHash ?? readHistory()?.sourceHash,
      } satisfies WorkspaceHistory,
    },
    "",
  );
}

/** Start a fresh Jobs screen without discarding Next's browser history metadata. */
export function resetJobWorkspaceNavigation() {
  clearLastJobWorkspaceLocation();
  writeHistory("replaceState", null);
  window.dispatchEvent(new Event(RESET_EVENT));
}

/** Restore a saved logo destination without reloading active downloads. */
export function restoreJobWorkspaceNavigationFromSnapshot() {
  const saved = currentSnapshotState()?.workspace ?? null;
  writeHistory("replaceState", saved, window.location.hash);
  window.dispatchEvent(new Event(RESTORE_EVENT));
}

export function useJobWorkspaceNavigation() {
  const sandbox = useTutorialSandbox();
  const [location, setLocation] = useState<JobWorkspaceLocation | null>(null);
  useSnapshotSource("workspace", () => location);
  const pendingPaint = useRef<{next: JobWorkspaceLocation | null; ticket: PaintTicket} | null>(null);
  const screen = (next: JobWorkspaceLocation | null): Parameters<typeof setLocalNavigationScreen>[0] => !next ? "jobs" : next.materialListId || next.view === "material-lists" || next.view === "tool-requests" ? "materials" : next.view === "drawings" ? "drawing" : next.view === "chat" ? "chat" : "job";
  useLayoutEffect(() => {
    if (sandbox) return;
    setLocalNavigationScreen(screen(location));
    const pending = pendingPaint.current;
    if (pending && (pending.next === location || pending.next?.jobId === location?.jobId && pending.next?.materialListId === location?.materialListId && (pending.next?.view === "tool-requests" ? "material-lists" : pending.next?.view) === location?.view)) {pending.ticket.commit(); pendingPaint.current = null;}
    return () => pending?.ticket.cancel();
  }, [location, sandbox]);
  useLayoutEffect(() => () => {
    pendingPaint.current?.ticket.cancel();
    pendingPaint.current = null;
    if (!sandbox) setLocalNavigationScreen(null);
  }, [sandbox]);
  const preparePaint = useCallback((next: JobWorkspaceLocation | null) => {
    pendingPaint.current?.ticket.cancel();
    const ticket = navigationPaint.claimLocal();
    pendingPaint.current = ticket ? {next, ticket} : null;
  }, []);


  const restore = useCallback((next: JobWorkspaceLocation | null) => {
    if (next?.view === "tool-requests") next = { ...next, view: "material-lists" };
    setLocation(next);
    if (sandbox) return;
    if (next) setLastJobWorkspaceLocation(next);
    else clearLastJobWorkspaceLocation();
  }, [sandbox]);

  useEffect(() => {
    if (sandbox) return;
    let entry = readHistory();
    const saved = currentSnapshotState()?.workspace;
    const sourceHash = saved !== undefined ? window.location.hash : undefined;
    if (!entry || (sourceHash && entry.sourceHash !== sourceHash)) {
      const last = saved !== undefined ? saved : getLastJobWorkspaceLocation();
      writeHistory("replaceState", last ? {
        ...last, view: last.materialListId ? "material-lists" : last.view,
      } : null, sourceHash);
      entry = readHistory();
    }
    // An existing Jobs history entry (including the jobs screen) wins
    // over localStorage, which may describe a later screen in the stack.
    restore(entry?.location ?? null);
    const reset = () => restore(null);
    const restoreSaved = () => restore(readHistory()?.location ?? null);
    window.addEventListener(RESET_EVENT, reset);
    window.addEventListener(RESTORE_EVENT, restoreSaved);
    return () => {
      window.removeEventListener(RESET_EVENT, reset);
      window.removeEventListener(RESTORE_EVENT, restoreSaved);
    };
  }, [restore, sandbox]);

  const navigate = useCallback(
    (next: JobWorkspaceLocation) => {
      if (sandbox) {
        restore(next);
        return;
      }
      const current = readHistory()?.location;
      if (
        current?.jobId === next.jobId &&
        current.view === next.view &&
        current.materialListId === next.materialListId
      ) {
        return;
      }
      preparePaint(next);
      writeHistory("replaceState", next);
      restore(next);
    },
    [restore, sandbox, preparePaint],
  );

  const back = useCallback(() => {
    const parent: JobWorkspaceLocation | null = !location ? null
      : location.materialListId ? { ...location, view: "material-lists", materialListId: null }
      : location.view !== "options" ? { ...location, view: "options", materialListId: null }
      : null;
    if (!sandbox && location) preparePaint(parent);
    if (!sandbox) writeHistory("replaceState", parent);
    restore(parent);
  }, [location, sandbox, restore, preparePaint]);
  useHeaderBackOverride(location ? back : null, { priority: -50 });
  return { location, navigate, back };
}
