"use client";
import { useEffect, useRef } from "react";

/** Ephemeral UI debounce only. The caller preserves its existing flush/cancel
 * removal policy. Nothing is persisted or replayed after reconnect; bulk
 * controls share the intent lifetime through the request handoff. */
export function useQueuedReceiptIntent(
  onPendingChange?: (pending: boolean) => void,
  cleanup: "flush" | "cancel" = "flush",
) {
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    send: () => void;
    release: () => void;
  } | null>(null);
  const flush = () => {
    const intent = pending.current;
    if (!intent) return;
    pending.current = null;
    clearTimeout(intent.timer);
    try {
      intent.send();
    } finally {
      queueMicrotask(intent.release);
    }
  };
  const cancel = () => {
    const intent = pending.current;
    if (!intent) return;
    pending.current = null;
    clearTimeout(intent.timer);
    queueMicrotask(intent.release);
  };
  useEffect(() => (cleanup === "flush" ? flush : cancel), [cleanup]);
  return {
    hasPending: () => pending.current !== null,
    cancel,
    schedule: (send: () => void, delay: number) => {
      // Release belongs to this exact intent. Rescheduling is balanced even when
      // the parent tracks multiple controls for one order line.
      cancel();
      onPendingChange?.(true);
      const intent = {
        send,
        release: () => onPendingChange?.(false),
        timer: setTimeout(flush, delay),
      };
      pending.current = intent;
      if (!delay) flush();
    },
  };
}
