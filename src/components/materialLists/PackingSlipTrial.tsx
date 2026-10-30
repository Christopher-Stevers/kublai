"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, FlaskConicalIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { SlipLineImage } from "./SlipLineImage";
import {
  alignTrialLines,
  trialDisagreements,
  trialReaders,
  readerLabels,
  readersInTrial,
  type TrialReader,
  type TrialResults,
  type TrialScore,
  type TrialLine,
} from "~/lib/packing-slip-trial";

export type TrialSummary = {
  runId: string;
  updatedAt: string;
  counts: Record<
    TrialReader,
    { complete: number; failed: number; total: number }
  >;
  cases: Array<{
    documentId: string;
    readers?: Partial<Record<TrialReader, "pending" | "complete" | "failed">>;
  }>;
};
type Comparison = {
  runId: string;
  stale: boolean;
  entry: {
    versionId: string;
    pages: number;
    readers?: Partial<Record<TrialReader, string>>;
  };
  results: TrialResults;
  sourceUrl: string;
};
function useTrial<T>(
  jobId: string,
  documentId: string | undefined,
  online: boolean,
) {
  const [trial, setTrial] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setTrial(null);
    setError("");
    if (!online) return;
    let stopped = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/job-documents/packing-slips/trials?${new URLSearchParams({ jobId, ...(documentId ? { documentId } : {}) })}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await response.json()) as {
          trial?: T | null;
          error?: string;
        };
        if (!response.ok)
          throw Error(data.error ?? "Could not load the reader comparison.");
        if (!stopped) {
          setTrial(data.trial ?? null);
          setError("");
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Could not load the comparison.",
          );
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId, documentId, online]);
  return { trial, error };
}
export function PackingSlipTrialSummary({
  jobId,
  online,
  onUpdate,
}: {
  jobId: string;
  online: boolean;
  onUpdate?: (summary: TrialSummary | null) => void;
}) {
  const { trial, error } = useTrial<TrialSummary>(jobId, undefined, online);
  useEffect(() => {
    onUpdate?.(trial);
  }, [trial, onUpdate]);
  if (!trial)
    return error ? (
      <p className="text-muted-foreground mb-3 text-sm">
        Reader comparison: {error}
      </p>
    ) : null;
  return (
    <section
      aria-label="Packing-slip trial progress"
      className="mb-5 border-y py-4"
    >
      <h2 className="flex items-center gap-2 font-medium">
        <FlaskConicalIcon className="h-4 w-4" /> Reader comparison
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Every slip is read again, including previously approved slips. Open one
        to compare each part and its confidence. Your verification supplies the
        answer key.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {trialReaders
          .filter((r) => trial.counts[r]?.total > 0)
          .map((reader) => {
            const c = trial.counts[reader];
            return (
              <div key={reader} className="min-w-0">
                <span className="text-sm font-medium">
                  {readerLabels[reader]}
                </span>
                <p className="text-muted-foreground text-sm tabular-nums">
                  {c.complete} / {c.total} slips
                  {c.failed ? ` · ${c.failed} failed` : ""}
                </p>
                <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
                  <div
                    className="bg-foreground/60 h-full"
                    style={{
                      width: `${c.total ? (c.complete / c.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}
function Score({ label, score }: { label: string; score: TrialScore }) {
  return (
    <span
      title={`${score.basis}: ${score.reason}`}
      className="flex justify-between gap-3 text-xs"
    >
      <span className="text-muted-foreground">{label}</span>
      <strong className="tabular-nums">{Math.round(score.value * 100)}%</strong>
    </span>
  );
}
export function PackingSlipTrialComparison({
  jobId,
  documentId,
  online,
  busy,
  selectedReader,
  onUse,
  onTrial,
}: {
  jobId: string;
  documentId: string;
  online: boolean;
  busy: boolean;
  selectedReader?: TrialReader;
  onUse: (reader: TrialReader, runId: string) => Promise<void>;
  /** Receives the current readings, or null when there are none. */
  onTrial?: (results: TrialResults | null) => void;
}) {
  const { trial, error } = useTrial<Comparison>(jobId, documentId, online);
  useEffect(() => {
    onTrial?.(trial && !trial.stale ? trial.results : null);
  }, [trial, onTrial]);
  const [open, setOpen] = useState(false),
    [differencesOnly, setDifferencesOnly] = useState(false),
    [showCrops, setShowCrops] = useState(false);
  const rows = useMemo(() => alignTrialLines(trial?.results ?? {}), [trial]);
  if (!trial)
    return error ? (
      <p className="text-muted-foreground text-sm">
        Reader comparison: {error}
      </p>
    ) : null;
  const readers = readersInTrial(trial.entry.readers);
  const ready = readers.filter(
    (r) => trial.results[r]?.status === "complete",
  ).length;
  const display = differencesOnly
    ? rows.filter((r) => trialDisagreements(r, trial.results).length)
    : rows;
  return (
    <section
      className="mb-5 overflow-hidden rounded-lg border"
      aria-label="Independent reader comparison"
    >
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>
          <span className="font-medium">Compare {readers.length} readers</span>
          <span className="text-muted-foreground ml-2 text-sm">
            {ready}/{readers.length} ready
            {selectedReader
              ? ` · reviewing ${readerLabels[selectedReader]}`
              : ""}
          </span>
        </span>
        {open ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t">
          <div className="space-y-2 px-4 py-3 text-sm">
            <p>
              Scores are estimates, not measured accuracy. OCR quality, Jev’s
              scores and model self-assessments are kept separate. Your
              corrections remain separate from these original predictions.
            </p>
            <p className="text-muted-foreground">
              Choose a reading to prepare the review below. Saved human
              decisions are preserved. Received quantities change only when you
              approve the review.
            </p>
            {trial.stale && (
              <p role="alert" className="text-amber-700 dark:text-amber-300">
                The source file has changed. This comparison is for the older
                version and cannot replace the current draft.
              </p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={differencesOnly}
                  onChange={(e) => setDifferencesOnly(e.target.checked)}
                />{" "}
                Differences only
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showCrops}
                  onChange={(e) => setShowCrops(e.target.checked)}
                />{" "}
                Show source rows
              </label>
              <a
                className="underline"
                href={trial.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open source PDF
              </a>
            </div>
            <p className="text-muted-foreground text-xs lg:hidden">
              Swipe the table sideways to compare all readers.
            </p>
          </div>
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Side-by-side reader results; scroll horizontally on small screens"
          >
            <table
              className="w-full table-fixed border-collapse text-left text-sm"
              style={{ minWidth: readers.length * 225 }}
            >
              <thead>
                <tr>
                  {readers.map((reader) => {
                    const result = trial.results[reader];
                    return (
                      <th
                        key={reader}
                        className="bg-muted/40 border-t border-r px-3 py-3 align-top font-normal last:border-r-0"
                      >
                        <strong className="block">
                          {readerLabels[reader]}
                        </strong>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {!result
                            ? "Waiting for run"
                            : result.status === "failed"
                              ? "Failed — retry needed"
                              : `${result.lines.length} detected lines · ${result.pagesRead?.length ?? 0}/${trial.entry.pages} pages`}
                        </span>
                        {result?.status === "complete" && (
                          <>
                            <p className="mt-2 text-xs">
                              {result.orderLabel ??
                                (result.orderId
                                  ? "Candidate order"
                                  : "Order unresolved")}
                              {result.orderId
                                ? ` · ${Math.round((result.orderConfidence?.value ?? 0) * 100)}%`
                                : ""}
                            </p>
                            <Button
                              className="mt-2 h-auto min-h-9 w-full px-2 py-2 text-xs whitespace-normal"
                              variant="outline"
                              disabled={!online || busy || trial.stale}
                              onClick={() => void onUse(reader, trial.runId)}
                            >
                              Use {readerLabels[reader]} for review
                            </Button>
                          </>
                        )}
                        {result?.error && (
                          <p className="mt-2 text-xs">{result.error}</p>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {display.map((row) => {
                  const flags = trialDisagreements(row, trial.results);
                  const anchor =
                    Object.values(row.lines).find((l) => l.box) ??
                    Object.values(row.lines)[0]!;
                  return (
                    <TrialComparisonRow
                      key={row.id}
                      row={row}
                      flags={flags}
                      anchor={anchor}
                      trial={trial}
                      readers={readers}
                      showCrops={showCrops}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          {!display.length && (
            <p className="px-4 py-5 text-sm">
              {rows.length
                ? "No differences in aligned detections. This does not prove the readings are correct."
                : "No line results are available yet."}
            </p>
          )}
          <div className="space-y-2 border-t px-4 py-3">
            {readers.map((reader) => {
              const warnings = trial.results[reader]?.warnings;
              return warnings?.length ? (
                <details key={reader} className="text-sm">
                  <summary className="cursor-pointer">
                    {readerLabels[reader]} · {warnings.length} notes
                  </summary>
                  <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              ) : null;
            })}
          </div>
        </div>
      )}
    </section>
  );
}
function TrialComparisonRow({
  row,
  flags,
  anchor,
  trial,
  readers,
  showCrops,
}: {
  row: ReturnType<typeof alignTrialLines>[number];
  flags: string[];
  anchor: TrialLine;
  trial: Comparison;
  readers: TrialReader[];
  showCrops: boolean;
}) {
  return (
    <>
      <tr>
        <td colSpan={readers.length} className="bg-muted/20 border-t px-3 py-2">
          <p className="font-medium">
            Page {row.page} ·{" "}
            {anchor.description || anchor.evidence || "Unidentified part"}
          </p>
          {flags.length > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {flags.join(" · ")}
            </p>
          )}
          {showCrops && anchor.box && (
            <div className="mt-2 max-w-3xl">
              <SlipLineImage
                url={trial.sourceUrl}
                page={anchor.page}
                box={anchor.box}
                label="Printed product row"
              />
            </div>
          )}
        </td>
      </tr>
      <tr>
        {readers.map((reader) => {
          const line = row.lines[reader];
          return (
            <td
              key={reader}
              className="border-t border-r px-3 py-3 align-top last:border-r-0"
            >
              {line ? (
                <>
                  <p className="text-xs break-words">{line.description}</p>
                  {line.sku && (
                    <p className="text-muted-foreground mt-1 text-xs break-words">
                      {line.sku}
                    </p>
                  )}
                  <p className="mt-2 font-semibold tabular-nums">
                    {line.shipped ?? "Unread"} {line.unit ?? "unit unknown"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Ordered {line.ordered ?? "—"} · B/O{" "}
                    {line.backordered ?? "—"}
                  </p>
                  <p className="mt-1 text-xs">
                    {line.orderItemId
                      ? `Matched to: ${line.matchedDescription ?? "candidate order item"}`
                      : "No order item matched"}
                  </p>
                  <div className="mt-3 space-y-1 border-t pt-2">
                    <Score label="Part identity" score={line.confidence.part} />
                    <Score label="Quantity" score={line.confidence.quantity} />
                    <Score label="Order match" score={line.confidence.match} />
                    <Score label="Overall" score={line.confidence.overall} />
                  </div>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer underline">
                      Evidence & uncertainty
                    </summary>
                    <p className="mt-2 whitespace-pre-line">{line.evidence}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {Object.entries(line.confidence).map(([key, s]) => (
                        <li key={key}>
                          {key}: {s.reason} ({s.basis})
                        </li>
                      ))}
                      {line.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {trial.results[reader]?.status === "complete"
                    ? "Not detected or not confidently aligned with this row. Check the source."
                    : "No result yet"}
                </p>
              )}
            </td>
          );
        })}
      </tr>
    </>
  );
}
