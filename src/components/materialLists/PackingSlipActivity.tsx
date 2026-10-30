"use client";
import { useEffect, useRef, useState } from "react";
import type { SlipAnalysis } from "~/lib/packing-slip-review";

export type ProcessingJob = {
  status: string;
  updatedAt: string;
  leaseUntil: string | null;
};
export function PackingSlipActivity({
  analysis,
  job,
  online,
  receivedAt,
}: {
  analysis?: SlipAnalysis;
  job?: ProcessingJob | null;
  online: boolean;
  receivedAt: number;
}) {
  const log = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (following.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [analysis?.activity]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const processing = analysis?.status === "processing";
  const disconnected = !online || (processing && now - receivedAt > 15000);
  const active =
    processing &&
    job?.status === "running" &&
    !!job.leaseUntil &&
    Date.parse(job.leaseUntil) > now;
  const status =
    !analysis || analysis.status === "cleared"
      ? "Not Started"
      : analysis.status === "ready"
        ? "Completed"
        : analysis.status === "failed" || job?.status === "failed"
          ? "Failed"
          : disconnected
            ? "Live Updates Interrupted"
            : job?.status === "queued"
              ? "Queued"
              : active
                ? "Running"
                : "Waiting for Worker Confirmation";
  const events = analysis?.activity?.length
    ? analysis.activity
    : analysis?.progress
      ? [
          {
            at: analysis.startedAt,
            message: analysis.progress.message,
            completed: analysis.progress.completed,
            total: analysis.progress.total,
          },
        ]
      : [];
  const last = events.at(-1);
  const age = (time: string) =>
    `${Math.max(0, Math.floor((now - Date.parse(time)) / 1000))}s ago`;
  const elapsed = analysis
    ? Math.max(
        0,
        Math.floor(
          ((analysis.completedAt ? Date.parse(analysis.completedAt) : now) -
            Date.parse(analysis.startedAt)) /
            1000,
        ),
      )
    : 0;
  return (
    <section
      aria-label="Processing activity"
      className="bg-card mb-5 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">Processing Activity</h2>
        <span
          role="status"
          className="bg-muted inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ${active && !disconnected ? "bg-emerald-500 motion-safe:animate-pulse" : status === "Failed" ? "bg-red-500" : "bg-muted-foreground"}`}
          />
          {status}
        </span>
      </div>
      <div className="text-muted-foreground space-y-1 px-4 py-3 text-xs">
        {analysis && (
          <p>
            Elapsed: {Math.floor(elapsed / 60)}m {elapsed % 60}s
            {last && ` · Last activity ${age(last.at)}`}
          </p>
        )}
        {processing && (
          <p>
            {disconnected
              ? "Cannot confirm current progress. Reconnecting automatically…"
              : active
                ? `Worker heartbeat ${age(job.updatedAt)}. Checking for updates every 4 seconds.`
                : job?.status === "queued"
                  ? "Waiting for an available processing slot."
                  : "No current worker heartbeat. Processing may be interrupted."}
          </p>
        )}
        {analysis?.status === "ready" && (
          <p>
            Processing has finished. Any unresolved matches need review below.
          </p>
        )}
        {!analysis && <p>No analysis has been started for this document.</p>}
      </div>
      <ol
        ref={log}
        onScroll={() => {
          const el = log.current;
          if (el)
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
        role="log"
        aria-live="polite"
        aria-label="Processing log"
        className="max-h-56 space-y-2 overflow-y-auto border-t px-4 py-3 text-sm"
      >
        {analysis && (
          <li className="flex gap-3">
            <time className="text-muted-foreground shrink-0 font-mono text-xs">
              {new Date(analysis.startedAt).toLocaleTimeString()}
            </time>
            <span>Analysis requested.</span>
          </li>
        )}
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className="flex gap-3">
            <time className="text-muted-foreground shrink-0 font-mono text-xs">
              {new Date(event.at).toLocaleTimeString()}
            </time>
            <span>
              {event.message}
              {event.total !== undefined &&
                event.completed !== undefined &&
                ` (${event.completed}/${event.total})`}
            </span>
          </li>
        ))}
      </ol>
      {analysis?.error && (
        <p
          role="alert"
          className="border-t px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {analysis.error}
        </p>
      )}
    </section>
  );
}
