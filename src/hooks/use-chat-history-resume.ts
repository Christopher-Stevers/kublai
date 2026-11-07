"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatViewMemory } from "~/components/chat/ChatViewProvider";

/** Only sequence numbers persist in the tab; message contents are fetched again. */
export function useChatHistoryResume<T extends { sequence: number }>(
  key: string,
  cached: boolean,
  latest: { messages: T[]; nextBeforeSequence: number | null } | undefined,
  enabled: boolean,
  fetchPage: (
    cursor: number,
  ) => Promise<{ messages: T[]; nextBeforeSequence: number | null }>,
  onLoaded: (messages: T[], cursor: number | null) => void,
  onError: (error: unknown) => void,
) {
  const memory = useChatViewMemory();
  const [target] = useState(() => memory?.get<number>(`range:${key}`));
  const [restoring, setRestoring] = useState(!cached && target !== undefined);
  const callbacks = useRef({ fetchPage, onLoaded, onError });
  useLayoutEffect(() => {
    callbacks.current = { fetchPage, onLoaded, onError };
  }, [fetchPage, onLoaded, onError]);
  useEffect(() => {
    if (!restoring || !latest || !enabled) return;
    let active = true;
    void (async () => {
      let oldest = latest.messages[0]?.sequence ?? 0;
      let cursor = latest.nextBeforeSequence;
      const earlier: T[] = [];
      while (cursor !== null && oldest > target!) {
        const page = await callbacks.current.fetchPage(cursor);
        if (!active) return;
        earlier.push(...page.messages);
        oldest = page.messages[0]?.sequence ?? 0;
        const next = page.nextBeforeSequence;
        if (next !== null && next >= cursor)
          throw new Error(
            "Could not restore earlier messages. Try loading them again.",
          );
        cursor = next;
      }
      if (active) {
        callbacks.current.onLoaded(earlier, cursor);
        setRestoring(false);
      }
    })().catch((error) => {
      if (active) {
        callbacks.current.onError(error);
        setRestoring(false);
      }
    });
    return () => {
      active = false;
    };
  }, [restoring, latest, enabled, target]);
  return restoring;
}
