"use client";

import { useCallback, useEffect, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { currentSnapshotState } from "~/lib/snapshot-source";
import {
  clearLastJobWorkspaceLocation,
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
  type JobWorkspaceLocation,
} from "~/lib/job-workspace-last-option";

import { useHeaderBackOverride } from "~/lib/header-back-events";

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
  // The URL stays on the dashboard: these screens also work entirely offline.
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

export function useJobWorkspaceNavigation() {
  const sandbox = useTutorialSandbox();
  const [location, setLocation] = useState<JobWorkspaceLocation | null>(null);
  useSnapshotSource("workspace", () => location);

  const restore = useCallback((next: JobWorkspaceLocation | null) => {
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
    // An existing dashboard history entry (including the jobs screen) wins
    // over localStorage, which may describe a later screen in the stack.
    restore(entry?.location ?? null);
    const reset = () => restore(null);
    window.addEventListener(RESET_EVENT, reset);
    return () => window.removeEventListener(RESET_EVENT, reset);
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
      writeHistory("replaceState", next);
      restore(next);
    },
    [restore, sandbox],
  );

  const back = useCallback(() => {
    const parent: JobWorkspaceLocation | null = !location ? null
      : location.materialListId ? { ...location, view: "material-lists", materialListId: null }
      : location.view !== "options" ? { ...location, view: "options", materialListId: null }
      : null;
    if (!sandbox) writeHistory("replaceState", parent);
    restore(parent);
  }, [location, sandbox, restore]);
  useHeaderBackOverride(location ? back : null, { priority: -50 });
  return { location, navigate, back };
}
