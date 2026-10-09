"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { SnapshotState, SnapshotStateKey } from "~/lib/snapshot-source";
export type SnapshotSourceRegistry = {
  register: <K extends SnapshotStateKey>(
    key: K,
    read: () => SnapshotState[K],
  ) => () => void;
};
export const SnapshotSourceContext =
  createContext<SnapshotSourceRegistry | null>(null);
export function useSnapshotSource<K extends SnapshotStateKey>(
  key: K,
  read: () => SnapshotState[K],
) {
  const registry = useContext(SnapshotSourceContext),
    latest = useRef(read);
  useLayoutEffect(() => {
    latest.current = read;
  }, [read]);
  useEffect(
    () => registry?.register(key, () => latest.current()),
    [registry, key],
  );
}
