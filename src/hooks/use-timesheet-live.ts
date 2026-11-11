"use client";
import { useEffect, useRef } from "react";
import { subscribeLiveEvents } from "~/lib/live-client";
import { isAppPageActive } from "~/lib/app-page-activity";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
/** Hints invalidate authorized reads; the existing broad context poll remains.
 * No timer grants access, queues writes, or produces a separate connection. */
export function useTimesheetLive(options: {
  online: boolean;
  expectedAccount: string;
  authorityScope: string;
  refresh: () => Promise<unknown>;
}) {
  const callback = useRef(options.refresh);
  useEffect(() => {
    callback.current = options.refresh;
  }, [options.refresh]);
  useEffect(() => {
    if (
      !options.online ||
      !options.expectedAccount ||
      typeof EventSource === "undefined"
    )
      return;
    const authority = captureDeviceReadAuthority();
    if (!authority) return;
    let active = true,
      connected = false,
      busy = false,
      pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const owns = () =>
      active &&
      connected &&
      navigator.onLine &&
      isAppPageActive() &&
      authority === captureDeviceReadAuthority();
    const schedule = () => {
      if (!owns()) return;
      pending = true;
      if (timer || busy) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!owns()) return;
        busy = true;
        pending = false;
        void Promise.resolve()
          .then(() => {
            if (owns()) return callback.current();
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
            if (pending) schedule();
          });
      }, 100);
    };
    const stop = subscribeLiveEvents(
      { timesheets: true, expectedAccount: options.expectedAccount },
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
          if (hint.topic === "timesheets") schedule();
        },
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
    };
  }, [options.online, options.expectedAccount, options.authorityScope]);
}
