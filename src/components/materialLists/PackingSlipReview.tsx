"use client";
import { setPageInterval as setInterval, clearPageInterval as clearInterval } from "~/lib/app-page-activity";

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  EraserIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
import {
  roundQty,
  slipAmounts,
  slipItemStates,
  unmatchedLines,
} from "~/lib/slip-draft";

const fmt = (n: number, unit: string) => `${roundQty(n)} ${unit}`;

type Props = {
  analysis?: SlipAnalysis;
  versionId: string | null;
  onAction: (action: "analyze" | "clear") => Promise<void>;
  busy: boolean;
  canManage?: boolean;
  /** Close this window and check the read slip on the parts themselves. */
  onShowList?: () => void;
};

export function PackingSlipReview(props: Props) {
  const { analysis, busy, onAction, canManage = true } = props;
  const startOver = async (action: "analyze" | "clear") => {
    await onAction(action);
  };
  return (
    <div className="space-y-3">
      <SlipStatus {...props} />
      {analysis && canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy || analysis.status === "processing"}
            onClick={() => void startOver("analyze")}
          >
            <RotateCcwIcon className="size-4" /> Rerun detection
          </Button>
          {(analysis.status !== "cleared" || analysis.applied) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy}
              onClick={() => void startOver("clear")}
            >
              <EraserIcon className="size-4" /> Clear detection
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SlipStatus({
  analysis,
  versionId,
  onAction,
  busy,
  canManage = true,
  onShowList,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  if (analysis?.applied) return <Applied analysis={analysis} />;
  if (analysis?.status === "cleared")
    return (
      <p
        role="status"
        className="bg-muted/40 text-muted-foreground rounded-lg p-3 text-sm"
      >
        Detection cleared. Rerun it to read the slip again.
      </p>
    );
  if (!analysis || analysis.status === "failed")
    return (
      <div className="bg-muted/40 space-y-2 rounded-lg p-3 text-sm">
        <p>{analysis?.error ?? "Read the slip to fill in what arrived."}</p>
        {!analysis && canManage && (
          <Button
            disabled={busy}
            size="sm"
            variant="outline"
            onClick={() => void onAction("analyze")}
          >
            Run detection
          </Button>
        )}
      </div>
    );
  if (analysis.status === "processing")
    return (
      <div className="bg-muted/40 space-y-3 rounded-lg p-3 text-sm">
        <p role="status" className="flex items-center gap-2">
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
          Reading the packing slip. The parts on the list fill in when it is
          done, so you can close this window.
        </p>
        {now - Date.parse(analysis.startedAt) > 15 * 60_000 && canManage && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void onAction("analyze")}
          >
            Retry interrupted analysis
          </Button>
        )}
      </div>
    );
  if (analysis.versionId !== versionId)
    return canManage ? (
      <Button disabled={busy} onClick={() => void onAction("analyze")}>
        Analyze updated slip
      </Button>
    ) : null;

  const states = Object.values(slipItemStates(analysis, {}));
  const filled = states.filter((s) => s.slip !== undefined).length;
  const checks = states.filter((s) => s.check).length;
  const unmatched = unmatchedLines(analysis, {}).length;
  return (
    <div
      role="status"
      className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/40"
    >
      <div className="space-y-0.5">
        <p className="font-medium text-blue-950 dark:text-blue-100">
          Read and filled in on the list
        </p>
        <p className="text-muted-foreground text-xs">
          {filled} {filled === 1 ? "part" : "parts"} from the slip
          {checks ? ` · ${checks} to check` : ""}
          {unmatched
            ? ` · ${unmatched} slip ${unmatched === 1 ? "line" : "lines"} not matched`
            : ""}
        </p>
      </div>
      {checks > 0 && (
        <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          Parts marked Check could not be read with confidence.
        </p>
      )}
      {onShowList && (
        <Button className="h-10 w-full sm:w-auto" onClick={onShowList}>
          Check parts on the list <ArrowRightIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

function Applied({ analysis }: { analysis: SlipAnalysis }) {
  const applied = analysis.applied!;
  const proposed = analysis.confirmedItems
    ? {}
    : slipAmounts(
        analysis,
        Object.fromEntries(
          Object.entries(applied.links ?? {}).map(([i, id]) => [Number(i), id]),
        ),
      );
  const linked = Object.keys(applied.links ?? {}).length;
  const items = (analysis.confirmedItems ?? analysis.items).filter(
    (item) => applied.quantities[item.id] !== undefined,
  );
  return (
    <details className="group rounded-lg border border-emerald-200 bg-emerald-50/60 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <summary
        role="status"
        className="flex cursor-pointer list-none items-center gap-2 p-3 text-emerald-900 dark:text-emerald-200"
      >
        <CheckCircle2Icon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Receipt confirmed</span>
          <span className="block text-xs opacity-80">
            {new Date(applied.at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            · {items.length} {items.length === 1 ? "item" : "items"} received
            {linked
              ? ` · ${linked} ${linked === 1 ? "line" : "lines"} matched by hand`
              : ""}
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 opacity-70 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-emerald-200/70 border-t border-emerald-200/70 dark:divide-emerald-900 dark:border-emerald-900">
        {items.map((item) => {
          const confirmed = applied.quantities[item.id]!;
          const slip = proposed[item.id];
          const differs =
            slip !== undefined && Math.abs(confirmed - slip) > 1e-6;
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2"
            >
              <span className="min-w-0 flex-1">{item.description}</span>
              <span className="font-medium tabular-nums">
                {fmt(confirmed, item.unit)}
              </span>
              {differs && (
                <span className="flex w-full items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangleIcon className="size-3 shrink-0" />
                  Slip said {fmt(slip, item.unit)}.
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
