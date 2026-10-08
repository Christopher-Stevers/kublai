"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPipeLinework } from "~/lib/pdf-pipe-lines";
import { buildPipeSystemIndex, selectPipeSystem } from "~/lib/pipe-system";
import type { SheetPoint } from "~/lib/sheet-measure";

type Index = ReturnType<typeof buildPipeSystemIndex>;
type Selection = ReturnType<typeof selectPipeSystem>;

export function usePipeSystemSelection({
  active,
  url,
  page,
  sheetKey,
}: {
  active: boolean;
  url?: string;
  page?: number;
  sheetKey?: string;
}) {
  // Results belong to one source revision. A sheet switch never shows the
  // previous sheet's geometry, filter, or asynchronous failure.
  const [loaded, setLoaded] = useState<{
    key: string;
    index?: Index;
    error?: string;
  } | null>(null);
  const [selected, setSelected] = useState<{
    key: string;
    value: Selection;
    error: string | null;
  } | null>(null);
  const [filter, setFilter] = useState<{ key: string; value: string } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const key = `${sheetKey ?? ""}:${url ?? ""}:${page ?? ""}`;
  const result = loaded?.key === key ? loaded : null;
  const index = result?.index;
  const selection = selected?.key === key ? selected.value : null;
  const system = filter?.key === key ? filter.value : "";
  const error =
    result?.error ?? (selected?.key === key ? selected.error : null);
  const hasPdf = Boolean(url && page != null);

  useEffect(() => {
    if (!active || !url || page == null || result) return;
    let cancelled = false;
    void loadPipeLinework({ url, page })
      .then((linework) => {
        if (!cancelled)
          setLoaded({ key, index: buildPipeSystemIndex(linework) });
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({
            key,
            error:
              "The pipe lines could not be read. Try again while connected.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [active, url, page, key, result, attempt]);
  const codes = useMemo(
    () =>
      index
        ? [
            ...new Set(index.linework.labels.map((label) => label.system)),
          ].sort()
        : [],
    [index],
  );
  return {
    selection,
    reading: active && hasPdf && !result,
    error,
    codes,
    system,
    hasPdf,
    ready: Boolean(index),
    hasLines: Boolean(index?.linework.segments.length),
    select: (point: SheetPoint | null, tolerance: number) => {
      if (!point || !index) return;
      const value = selectPipeSystem(
        index,
        point,
        tolerance,
        system || undefined,
      );
      setSelected({
        key,
        value,
        error: value.segments.length
          ? null
          : "No connected pipe was found here. Tap a pipe line or its system label.",
      });
    },
    setSystem: (value: string) => {
      setFilter({ key, value });
      setSelected(null);
    },
    clear: () => {
      setSelected(null);
    },
    retry: () => {
      setLoaded(null);
      setAttempt((value) => value + 1);
    },
  };
}
