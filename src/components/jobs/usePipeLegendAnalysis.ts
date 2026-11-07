"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  PipeLegendReferences,
  PipeSymbolTemplate,
} from "~/lib/pipe-components-types";
import type { PipeSystemSelection } from "~/lib/pipe-system";

// Cover a short deployment/network interruption without requiring another tap.
const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** Selection/revision changes cancel the entire reference-load → analysis chain. */
export function usePipeLegendAnalysis(options: {
  active: boolean;
  source: string;
  sourceSheetId?: string;
  selection: PipeSystemSelection | null;
  templates: PipeSymbolTemplate[];
  load?: () => Promise<PipeLegendReferences>;
  analyze: (templates: PipeSymbolTemplate[]) => Promise<void>;
}) {
  const current = useRef(options);
  useLayoutEffect(() => {
    current.current = options;
  });
  const [attempt, recheck] = useState(0);
  const [status, setStatus] = useState<{
    source: string;
    selection: PipeSystemSelection | null;
    loading: boolean;
    warnings: string[];
    count: number;
    error?: string;
  } | null>(null);
  const templateKey = JSON.stringify(options.templates);
  useEffect(() => {
    if (
      !options.active ||
      !options.selection?.segments.length ||
      !current.current.load
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let waiting = false;
    const { load, analyze, templates, sourceSheetId, source, selection } =
      current.current;
    const run = async () => {
      waiting = false;
      setStatus({ source, selection, loading: true, warnings: [], count: 0 });
      try {
        const refs = await load();
        if (cancelled) return;
        await analyze([
          ...templates,
          ...refs.templates.map((t) => ({
            ...t,
            excludeFromTarget: t.reference?.sourceSheetId === sourceSheetId,
          })),
        ]);
        if (!cancelled)
          setStatus({
            source,
            selection,
            loading: false,
            warnings: refs.warnings,
            count: new Set(
              refs.templates.map((t) => t.reference?.legendId ?? t.id),
            ).size,
          });
      } catch (error) {
        if (!cancelled) {
          const status = (error as { data?: { httpStatus?: number } } | null)
            ?.data?.httpStatus;
          const retryable =
            !status || status >= 500 || status === 408 || status === 429;
          const delay = retryable ? RETRY_DELAYS[retries++] : undefined;
          waiting = retryable;
          setStatus({
            source,
            selection,
            loading: false,
            warnings: [],
            error:
              delay !== undefined
                ? "Fitting detection is waiting for Legend Items. Retrying automatically…"
                : "Saved Legend Items could not be loaded. Retry fitting detection while connected.",
            count: 0,
          });
          if (delay !== undefined) timer = setTimeout(() => void run(), delay);
        }
      }
    };
    const resume = () => {
      if (!waiting || cancelled) return;
      clearTimeout(timer);
      void run();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    };
  }, [options.active, options.source, options.selection, templateKey, attempt]);
  const visible =
    status?.source === options.source && status.selection === options.selection
      ? status
      : null;
  return {
    loading: visible?.loading ?? false,
    warnings: visible?.warnings ?? [],
    count: visible?.count ?? 0,
    error: visible?.error ?? null,
    recheck: () => {
      if (current.current.load) recheck((n) => n + 1);
      else void current.current.analyze(current.current.templates);
    },
  };
}
