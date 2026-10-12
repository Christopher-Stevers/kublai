"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const updateSchema = z.object({
  changes: z.array(
    z.object({
      conversationId: z.string(),
      messageIds: z.array(z.string()).nullable(),
    }),
  ),
  removed: z.array(z.string()),
});
export type ConversationUpdate = z.infer<typeof updateSchema> | null;

/** One stream per chat workspace. Hidden/offline tabs sleep; reconnect always resyncs. */
export function useConversationEvents(
  online: boolean,
  onUpdate: (update: ConversationUpdate) => void,
) {
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const callback = useRef(onUpdate);
  useEffect(() => {
    callback.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!online || !visible || typeof EventSource === "undefined") return;
    let disposed = false,
      delay = 1000;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (disposed) return;
      source = new EventSource("/api/conversations/events");
      source.addEventListener("connected", () => {
        if (disposed) return;
        delay = 1000;
        setConnected(true);
        callback.current(null);
      });
      source.addEventListener("conversations-updated", (event) => {
        if (disposed) return;
        try {
          const parsed = updateSchema.safeParse(
            JSON.parse((event as MessageEvent<string>).data),
          );
          if (parsed.success) callback.current(parsed.data);
        } catch {
          /* Ignore malformed frames; reconnect/fallback resyncs. */
        }
      });
      source.onerror = () => {
        source?.close();
        if (disposed) return;
        setConnected(false);
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    open();
    return () => {
      disposed = true;
      source?.close();
      clearTimeout(retry);
      setConnected(false);
    };
  }, [online, visible]);
  return { connected: connected && online && visible, visible };
}
