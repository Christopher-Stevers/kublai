"use client";

import { useEffect, useRef, useState } from "react";
import { loadPipeLinework } from "~/lib/pdf-pipe-lines";
import { createPipeGeometrySession, type PipeGeometrySession } from "~/lib/drawing-geometry-client";
import type { PipeSystemSelection } from "~/lib/pipe-system";
import type { SheetPoint } from "~/lib/sheet-measure";

export function usePipeSystemSelection({ active, url, page, sheetKey }: {
  active: boolean; url?: string; page?: number; sheetKey?: string;
}) {
  const [loaded, setLoaded] = useState<{ key: string; session?: PipeGeometrySession; error?: string } | null>(null);
  const [selected, setSelected] = useState<{ key: string; value?: PipeSystemSelection; error: string | null } | null>(null);
  const [filter, setFilter] = useState<{ key: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const owner = useRef<PipeGeometrySession | null>(null);
  const request = useRef(0);
  const key = `${sheetKey ?? ""}:${url ?? ""}:${page ?? ""}`;
  const result = loaded?.key === key ? loaded : null;
  const session = result?.session;
  const selection = selected?.key === key ? selected.value ?? null : null;
  const system = filter?.key === key ? filter.value : "";
  const error = result?.error ?? (selected?.key === key ? selected.error : null);
  const hasPdf = Boolean(url && page != null);

  // One source owns one worker and its graph. Terminate it on revision changes
  // and unmount; responses from old taps/filters can never select a new sheet.
  useEffect(() => () => {
    request.current++;
    owner.current?.dispose();
    owner.current = null;
  }, [key]);
  useEffect(() => {
    if (!active || !url || page == null || result) return;
    const controller = new AbortController();
    void loadPipeLinework({ url, page, signal: controller.signal })
      .then(linework => createPipeGeometrySession(linework, controller.signal))
      .then(session => {
        if (controller.signal.aborted) { session.dispose(); return; }
        owner.current?.dispose();
        owner.current = session;
        setLoaded({ key, session });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key, error: "The pipe lines could not be read. Try again while connected." });
      });
    return () => controller.abort();
  }, [active, url, page, key, result, attempt]);
  return {
    selection, reading: active && hasPdf && !result,
    selecting: busy === key, error, codes: session?.codes ?? [], system, hasPdf,
    layerCodes: session?.layerCodes ?? [],
    ready: Boolean(session), hasLines: session?.hasLines ?? false,
    select: (point: SheetPoint | null, tolerance: number) => {
      if (!point || !session) return;
      const sequence = ++request.current;
      setBusy(key);
      void session.select(point, tolerance, system || undefined).then(value => {
        if (sequence !== request.current) return;
        setSelected({ key, value, error: value.segments.length ? null : "No connected pipe was found here. Tap a pipe line or its system label." });
        setBusy(null);
      }).catch(() => {
        if (sequence !== request.current) return;
        setSelected({ key, error: "The pipe selection could not be read. Try again." });
        setBusy(null);
      });
    },
    setSystem: (value: string) => {
      request.current++; setBusy(null); setFilter({ key, value }); setSelected(null);
      if (!session?.layerCodes.includes(value)) return;
      const sequence = request.current;
      setBusy(key);
      void session.selectLayer(value).then(selection => {
        if (sequence !== request.current) return;
        setSelected({ key, value: selection, error: null });
        setBusy(null);
      }).catch(() => {
        if (sequence !== request.current) return;
        setSelected({ key, error: "The system could not be highlighted. Try again." });
        setBusy(null);
      });
    },
    clear: () => { request.current++; setBusy(null); setSelected(null); setFilter(null); },
    retry: () => {
      request.current++; setBusy(null); owner.current?.dispose(); owner.current = null;
      setLoaded(null); setAttempt(value => value + 1);
    },
  };
}
