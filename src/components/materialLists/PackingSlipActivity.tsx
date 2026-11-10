"use client";
import { setPageInterval as setInterval, clearPageInterval as clearInterval } from "~/lib/app-page-activity";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { SlipAnalysis } from "~/lib/packing-slip-review";

export type ProcessingJob = {
  status: string;
  updatedAt: string;
  leaseUntil: string | null;
};
type ScanState = "idle" | "running" | "waiting" | "done" | "failed";
const SCAN_LINES = [12, 9, 12, 7, 10];
/** A slip being read: a light sweeps down it and each line inks in as it passes. */
function SlipScan({
  state,
  className,
}: {
  state: ScanState;
  className: string;
}) {
  return (
    <svg
      viewBox="0 0 24 30"
      aria-hidden
      data-state={state}
      className={`slip-scan size-6 shrink-0 overflow-visible ${className}`}
    >
      <rect
        x="3"
        y="1.5"
        width="18"
        height="27"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      {SCAN_LINES.map((width, i) => (
        <rect
          key={i}
          className="slip-scan-ink"
          x="6.5"
          y={6.5 + i * 4}
          width={width}
          height="1.6"
          rx="0.8"
          fill="currentColor"
          opacity={state === "idle" ? 0.3 : state === "waiting" ? 0.45 : 0.85}
          style={{ animationDelay: `${0.18 + i * 0.26}s` }}
        />
      ))}
      <rect
        className="slip-scan-beam"
        x="1"
        y="3"
        width="22"
        height="1.8"
        rx="0.9"
        fill="currentColor"
        style={{ filter: "drop-shadow(0 0 2px currentColor)" }}
      />
      {state === "done" && (
        <g className="save-check text-emerald-500">
          <circle cx="19.5" cy="25" r="5" fill="currentColor" />
          <path
            className="save-check-tick"
            d="M17.3 25.1l1.5 1.5 3-3.1"
            fill="none"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />
        </g>
      )}
    </svg>
  );
}
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
  const [open, setOpen] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (following.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [analysis?.activity, open]);
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
  const scan: ScanState =
    status === "Completed"
      ? "done"
      : status === "Failed"
        ? "failed"
        : status === "Running"
          ? "running"
          : status === "Not Started"
            ? "idle"
            : "waiting";
  const tone =
    scan === "running"
      ? "text-emerald-500"
      : scan === "failed"
        ? "text-red-500"
        : disconnected && processing
          ? "text-amber-500"
          : "text-muted-foreground";
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
  const toggle = (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`Processing activity: ${status}`}
      onClick={() => setOpen(!open)}
      className={
        open
          ? "flex w-full items-center gap-3 border-b px-4 py-3 text-left"
          : "bg-card inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-3 pl-2.5 text-sm font-medium shadow-sm"
      }
    >
      <SlipScan state={scan} className={tone} />
      {open && <h2 className="flex-1 font-semibold">Processing Activity</h2>}
      <span role="status">{status}</span>
      <ChevronDownIcon
        aria-hidden
        className={`text-muted-foreground size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
  if (!open)
    return (
      <section aria-label="Processing activity" className="mb-5">
        {toggle}
      </section>
    );
  return (
    <section
      aria-label="Processing activity"
      className="bg-card mb-5 overflow-hidden rounded-2xl border shadow-sm"
    >
      {toggle}
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
