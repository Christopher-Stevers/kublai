"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { currentSnapshotState } from "~/lib/snapshot-source";
import {
  clearLastJobWorkspaceLocation,
  getLastJobWorkspaceLocation,
  setLastJobWorkspaceLocation,
  type JobWorkspaceLocation,
} from "~/lib/job-workspace-last-option";

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
}

export function useJobWorkspaceNavigation() {
  const sandbox = useTutorialSandbox();
  const practiceHistory = useRef<Array<JobWorkspaceLocation | null>>([null]);
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
      writeHistory("replaceState", null, sourceHash);
      // Reopening a saved list still needs its parents in browser history.
      if (last) {
        const job: JobWorkspaceLocation = {
          jobId: last.jobId,
          view: "options",
          materialListId: null,
        };
        writeHistory("pushState", job);
        if (last.view !== "options" || last.materialListId) {
          writeHistory("pushState", {
            ...job,
            view: last.materialListId ? "material-lists" : last.view,
          });
        }
        if (last.materialListId) {
          writeHistory("pushState", { ...last, view: "material-lists" });
        }
      }
      entry = readHistory();
    }
    // An existing dashboard history entry (including the jobs screen) wins
    // over localStorage, which may describe a later screen in the stack.
    restore(entry?.location ?? null);

    const onPopState = () => {
      const current = readHistory();
      if (current) restore(current.location);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restore, sandbox]);

  const navigate = useCallback(
    (next: JobWorkspaceLocation) => {
      if (sandbox) {
        practiceHistory.current.push(next);
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
      writeHistory("pushState", next);
      restore(next);
    },
    [restore, sandbox],
  );

  const back = useCallback(() => {
    if (sandbox) {
      if (practiceHistory.current.length > 1) practiceHistory.current.pop();
      restore(practiceHistory.current.at(-1) ?? null);
    } else window.history.back();
  }, [sandbox, restore]);
  return { location, navigate, back };
}
