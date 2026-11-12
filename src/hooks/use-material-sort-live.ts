"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { subscribeLiveEvents } from "~/lib/live-client";
import { isAppPageActive } from "~/lib/app-page-activity";

/** Read invalidations and separate topic health; neither grants permissions. */
export function useMaterialSortLive(
  online: boolean,
  expectedAccount: string,
  refresh: () => Promise<unknown>,
) {
  const [health, setHealth] = useState<{
    account: string;
    binding: object;
    ready: boolean;
  } | null>(null);
  const binding = useMemo(
    () => ({ expectedAccount, online }),
    [expectedAccount, online],
  );
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!online || typeof EventSource === "undefined") return;
    let active = true,
      connected = false,
      topicReady = false,
      epoch = 0,
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
        const startedEpoch = epoch;
        const ownsRefresh = () =>
          active &&
          connected &&
          epoch === startedEpoch &&
          isAppPageActive();
        // The refresh may reject or throw before returning a promise. Either
        // failure must restore fallback polling and release the busy latch.
        void Promise.resolve()
          .then(() => {
            if (ownsRefresh()) return callback.current();
          })
          .then((result) => {
            const success =
              !!result &&
              typeof result === "object" &&
              "isSuccess" in result &&
              result.isSuccess === true;
            if (ownsRefresh() && topicReady)
              setHealth({ account: expectedAccount, binding, ready: success });
          })
          .catch(() => {
            if (ownsRefresh())
              setHealth({ account: expectedAccount, binding, ready: false });
          })
          .finally(() => {
            busy = false;
            if (pending) schedule();
          });
      }, 100);
    };
    const unsubscribe = subscribeLiveEvents(
      { preferences: true, expectedAccount },
      {
        preferencesReady: (value) => {
          if (!active) return;
          if (topicReady !== value) epoch++;
          topicReady = value;
          setHealth({ account: expectedAccount, binding, ready: false });
          if (value) schedule();
        },
        status: (value) => {
          connected = value;
          if (!value) {
            epoch++;
            topicReady = false;
            setHealth({ account: expectedAccount, binding, ready: false });
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
  }, [online, expectedAccount, binding]);
  return (
    online &&
    health?.account === expectedAccount &&
    health.binding === binding &&
    health.ready
  );
}
