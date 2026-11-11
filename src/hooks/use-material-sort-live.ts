"use client";
import { useEffect, useRef } from "react";
import { subscribeLiveEvents } from "~/lib/live-client";
import { isAppPageActive } from "~/lib/app-page-activity";

/** Extra best-effort invalidations only. HTTP's 60-second authority poll stays. */
export function useMaterialSortLive(
  online: boolean,
  expectedAccount: string,
  refresh: () => Promise<unknown>,
) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!online || typeof EventSource === "undefined") return;
    let active = true,
      connected = false,
      busy = false,
      pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!active || !connected || !isAppPageActive()) return;
      pending = true;
      if (timer || busy) return;
      // Coalesce duplicate source copies and a connect+resync burst. A query
      // already in flight gets at most one trailing refresh for newer hints.
      timer = setTimeout(() => {
        timer = undefined;
        if (!active || !connected || !isAppPageActive()) return;
        pending = false;
        busy = true;
        void callback
          .current()
          .catch(() => undefined)
          .finally(() => {
            busy = false;
            if (pending) schedule();
          });
      }, 100);
    };
    const unsubscribe = subscribeLiveEvents(
      { preferences: true, expectedAccount },
      {
        status: (value) => {
          connected = value;
          if (!value) {
            clearTimeout(timer);
            timer = undefined;
            pending = false;
          }
        },
        catchUp: schedule,
        hint: (hint) => {
          if (hint.topic === "preferences") schedule();
        },
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [online, expectedAccount]);
}
