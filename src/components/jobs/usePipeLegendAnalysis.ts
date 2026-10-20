"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  PipeLegendReferences,
  PipeSymbolTemplate,
} from "~/lib/pipe-components-types";
import type { PipeSystemSelection } from "~/lib/pipe-system";

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
    const { load, analyze, templates, sourceSheetId, source, selection } =
      current.current;
    setStatus({ source, selection, loading: true, warnings: [], count: 0 });
    void (async () => {
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
      } catch {
        if (!cancelled)
          setStatus({
            source,
            selection,
            loading: false,
            warnings: [],
            error:
              "Saved Legend Items could not be loaded. Try Recheck while connected.",
            count: 0,
          });
      }
    })();
    return () => {
      cancelled = true;
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
