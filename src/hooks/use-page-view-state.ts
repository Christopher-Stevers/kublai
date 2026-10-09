"use client";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import {
  currentSnapshotState,
  pageViewValueSchema,
  type PageViewValue,
} from "~/lib/snapshot-source";
type ViewCodec<T> = {
  encode: (value: T) => PageViewValue;
  decode: (saved: PageViewValue) => T | undefined;
};

/** Persist browsing state in destination links, without copying editable records. */
export function usePageViewState<T>(
  key: string,
  initial: T,
  allowed?: readonly T[],
  codec?: ViewCodec<T>,
) {
  const registry = useContext(SnapshotSourceContext);
  const read = () => {
    const saved = currentSnapshotState()?.pages?.[key];
    if (saved === undefined) return initial;
    if (codec) return codec.decode(saved) ?? initial;
    const compatible =
      initial === null
        ? saved === null || typeof saved === "string"
        : Array.isArray(initial)
          ? Array.isArray(saved)
          : typeof saved === typeof initial;
    return compatible && (!allowed || allowed.includes(saved as T))
      ? (saved as T)
      : initial;
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  if (state.key !== key) setState({ key, value });
  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      setState((previous) => ({
        key,
        value:
          typeof next === "function"
            ? (next as (previous: T) => T)(previous.value)
            : next,
      }));
    },
    [key],
  );
  const latest = useRef(value);
  const encoder = useRef(codec?.encode);
  useLayoutEffect(() => {
    latest.current = value;
    encoder.current = codec?.encode;
  }, [value, codec]);
  useEffect(
    () =>
      registry?.registerPage(key, () =>
        pageViewValueSchema.parse(
          encoder.current ? encoder.current(latest.current) : latest.current,
        ),
      ),
    [registry, key],
  );
  return [value, setValue] as const;
}
