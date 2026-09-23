"use client";

import { useCallback, useEffect, useState } from "react";
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
      } satisfies WorkspaceHistory,
    },
    "",
  );
}

export function useJobWorkspaceNavigation() {
  const [location, setLocation] = useState<JobWorkspaceLocation | null>(null);

  const restore = useCallback((next: JobWorkspaceLocation | null) => {
    setLocation(next);
    if (next) setLastJobWorkspaceLocation(next);
    else clearLastJobWorkspaceLocation();
  }, []);

  useEffect(() => {
    let entry = readHistory();
    if (!entry) {
      const last = getLastJobWorkspaceLocation();
      writeHistory("replaceState", null);
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
  }, [restore]);

  const navigate = useCallback(
    (next: JobWorkspaceLocation) => {
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
    [restore],
  );

  const back = useCallback(() => window.history.back(), []);
  return { location, navigate, back };
}
