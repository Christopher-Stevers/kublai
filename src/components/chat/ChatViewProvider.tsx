"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";
type ChatViewMemory = {
  get: <T>(key: string) => T | undefined;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
  ready: boolean;
};
const Context = createContext<ChatViewMemory | null>(null);
const persistedValue = z.union([
  z.string().max(200),
  z.boolean(),
  z.number().finite().nonnegative(),
  z.object({ kind: z.enum(["job", "conversation"]), id: z.string().max(255) }),
  z.object({
    top: z.number().finite().nonnegative(),
    bottom: z.boolean(),
    anchor: z.string().max(255).optional(),
    offset: z.number().finite().optional(),
  }),
  z.null(),
]);
const persistedKey = (key: string) =>
  ["destination", "search", "switcher", "navigation:scroll"].includes(key) ||
  key.startsWith("scroll:") ||
  key.startsWith("members:") ||
  key.startsWith("range:");

/** Retains browsing metadata in the tab; private messages and drafts stay in memory. */
export function ChatViewProvider({
  children,
  scope,
}: {
  children: React.ReactNode;
  scope?: string;
}) {
  const [values] = useState(() => new Map<string, unknown>());
  const [ready, setReady] = useState(!scope);
  const storageKey = scope ? `foremanhq-chat-view:${scope}` : null;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey) ?? "{}";
      if (raw.length > 200_000) throw new Error("Invalid saved chat view");
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(saved)) {
        const parsed = persistedValue.safeParse(value);
        if (persistedKey(key) && parsed.success) values.set(key, parsed.data);
      }
    } catch {
      /* Chat remains usable if tab storage is disabled. */
    }
    setReady(true);
    const clear = () => {
      values.clear();
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage disabled. */
      }
    };
    window.addEventListener("foremanhq-drawing-account-invalidated", clear);
    return () =>
      window.removeEventListener(
        "foremanhq-drawing-account-invalidated",
        clear,
      );
  }, [storageKey, values]);
  const memory = useMemo<ChatViewMemory>(() => {
    const persist = () => {
      if (!storageKey || !ready) return;
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify(
            Object.fromEntries(
              [...values].filter(([key]) => persistedKey(key)),
            ),
          ),
        );
      } catch {
        /* Keep the in-memory view. */
      }
    };
    return {
      ready,
      get: <T,>(key: string) => values.get(key) as T | undefined,
      set: (key, value) => {
        values.set(key, value);
        if (persistedKey(key)) persist();
      },
      remove: (key) => {
        values.delete(key);
        persist();
      },
    };
  }, [values, ready, storageKey]);
  return <Context.Provider value={memory}>{children}</Context.Provider>;
}
export const useChatViewMemory = () => useContext(Context);
export function useChatViewState<T>(key: string, initial: T | (() => T)) {
  const memory = useChatViewMemory();
  const [value, setValue] = useState<T>(
    () =>
      memory?.get<T>(key) ??
      (typeof initial === "function" ? (initial as () => T)() : initial),
  );
  useEffect(() => {
    memory?.set(key, value);
  }, [memory, key, value]);
  const update = useCallback(
    (next: T | ((previous: T) => T)) => setValue(next),
    [],
  );
  return [value, update] as const;
}
