"use client";
import { useEffect, useRef, useState } from "react";
import { subscribeLiveEvents } from "~/lib/live-client";

export type ConversationUpdate = {
  changes: { conversationId: string; messageIds: string[] | null }[];
  removed: string[];
} | null;

/** Uses the account document's shared stream. Reconnect always reads a fresh authorized snapshot. */
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
    const unsubscribe = subscribeLiveEvents(
      { conversations: true },
      {
        status: setConnected,
        catchUp: () => callback.current(null),
        hint: (hint) => {
          if (hint.topic === "conversations") callback.current(null);
        },
      },
    );
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [online, visible]);
  return { connected: connected && online && visible, visible };
}
