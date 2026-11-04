"use client";
import PartImage from "~/components/catalogue/PartImage";
import { OrderMatchCandidates } from "./OrderMatchCandidates";
import { OrderMatchPreview } from "./OrderMatchPreview";
import { PackingSlipActivity, type ProcessingJob } from "./PackingSlipActivity";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  FileTextIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  AlertTriangleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ReceivingItemPreview } from "./ReceivingItemPreview";
import type { SlipBox } from "~/lib/packing-slip-review";
import { SlipLineImage } from "./SlipLineImage";
import { SlipProcessingProgress } from "./SlipProcessingProgress";
import type {
  ReceivingReview,
  ReceivingLine,
  ReceiptKind,
} from "~/lib/receiving-review";
import { receiptDelta, qtyRound, lineKind } from "~/lib/receiving-review";
import {
  lineReadings,
  readSlipQuantity,
  receiptUnit,
  slipReader,
} from "~/lib/packing-slip-review";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import {
  partFit,
  type PartFacts,
  type PartFit,
  type PartUpdate,
} from "~/lib/slip-part-fit";
import type { JobDocument } from "~/server/documents/types";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  PackingSlipTrialComparison,
  useTrialComparison,
} from "./PackingSlipTrial";
import {
  readersInTrial,
  readerLabels,
  type TrialLine,
  type TrialReader,
  type TrialResults,
} from "~/lib/packing-slip-trial";

type Entry = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  order?: JobDocument["packingSlip"];
  status: string;
  pending: number | null;
  approved: number;
  reviewTrialRunId?: string;
  hasSuggestedOrder?: boolean;
};
type Option = { id: string; name: string };
type Part = {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  catalogId: string;
  unit: string | null;
  piecesPerPack: number | null;
  individualUnit: string | null;
};
/** `code`: the slip printed this supplier's code for it. */
type LikelyPart = Part & { score: number; code: boolean };
type Detail = {
  processingJob?: ProcessingJob | null;
  documents: Entry[];
  document: JobDocument;
  review: ReceivingReview;
  items: ReceiptOrderItem[];
  fingerprint: string;
  duplicates: Array<{
    id: string;
    name: string;
    reason: string;
    key: string;
    received: boolean;
  }>;
  suppliers: Option[];
  catalogs: Option[];
  units: Array<{ id: string; code: string }>;
  lists: Option[];
  orders: Array<{
    id: string;
    name: string | null;
    supplierId: string | null;
    listId: string | null;
  }>;
  parts: Part[];
  /** Likely catalogue parts for each slip line not on the linked order. */
  likely?: Record<string, LikelyPart[]>;
  photoSuggestions: Array<{
    id: string;
    displayName: string;
    imageUrl: string | null;
  }>;
  canCreate: boolean;
  /** The catalogue part behind each order item, for suggested part fixes. */
  orderParts?: Record<string, PartFacts>;
  canEditParts?: boolean;
  scannedBy: string;
  sourceUrl: string;
  sourceMimeType?: string;
};
type Action = Record<string, unknown> & { action: string };
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Please try again.";
const field =
  "border-input bg-background h-11 w-full min-w-0 rounded-md border px-3 text-base";
const card = "bg-card rounded-xl border";
const typeLabel = (k: ReceiptKind) =>
  k === "delivery"
    ? "Delivery"
    : k === "return-credit"
      ? "Return for credit"
      : "Return for replacement";
function Label({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </label>
  );
}
function Callout({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
const changed = (l: ReceivingLine, k: ReceiptKind) =>
  l.quantity !== l.approved?.quantity || lineKind(l, k) !== l.approved.kind;
const approvable = (l: ReceivingLine, k: ReceiptKind) =>
  !l.ignored &&
  !!l.orderItemId &&
  l.quantity !== null &&
  (l.quantity > 0 || !!l.approved) &&
  (l.checked === true || l.autoConfirmed === true || !l.issues.length) &&
  changed(l, k);
type LineStatus =
  | "review"
  | "recheck"
  | "correction"
  | "ready"
  | "approved"
  | "excluded";
const lineStatus = (l: ReceivingLine, r: ReceivingReview): LineStatus =>
  l.ignored
    ? "excluded"
    : l.approved
      ? changed(l, r.kind)
        ? "correction"
        : r.sourceTrial && l.checked !== true
          ? "recheck"
          : "approved"
      : approvable(l, r.kind)
        ? "ready"
        : "review";
/** Work first: lines to review, then pending approvals, then finished lines. */
const statusOrder: LineStatus[] = [
  "review",
  "recheck",
  "correction",
  "ready",
  "approved",
  "excluded",
];
const amber = {
  badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  text: "text-amber-700 dark:text-amber-300",
};
const sky = {
  badge: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
  text: "text-sky-700 dark:text-sky-300",
};
const statusStyle: Record<
  LineStatus,
  { label: string; badge: string; text: string }
> = {
  review: { label: "Needs review", ...amber },
  recheck: { label: "Approved · recheck", ...amber },
  correction: { label: "Correction", ...sky },
  ready: { label: "Ready", ...sky },
  approved: {
    label: "Approved",
    badge: "bg-emerald-600 text-white dark:bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  excluded: {
    label: "Excluded",
    badge: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
};
/** The one thing a queue row needs next. */
function slipState(d: Entry) {
  if (d.status === "processing")
    return { label: "Reading…", tone: "text-muted-foreground" };
  if (d.status === "review")
    return d.hasSuggestedOrder
      ? { label: "Confirm order", tone: sky.text }
      : d.pending
        ? { label: `${d.pending} to check`, tone: amber.text }
        : { label: "Needs review", tone: amber.text };
  if (d.status === "complete")
    return {
      label: "Done",
      tone: "text-muted-foreground",
    };
  return {
    label: d.status === "supporting" ? "Supporting file" : "Replaced",
    tone: "text-muted-foreground",
  };
}
export function ReceivingWorkspace({ jobId }: { jobId: string }) {
  const query = useSearchParams(),
    id = query.get("document");
  const online = useOnlineStatus();
  const router = useRouter();
  const comparison = useTrialComparison(jobId, id ?? undefined, online);
  const trialResults =
    comparison.trial && !comparison.trial.stale
      ? comparison.trial.results
      : null;
  // Back from a slip steps up to the queue, not out to the job.
  useHeaderBackOverride(
    id
      ? () => {
          const queue = `/jobs/${jobId}/receiving`;
          if (!online) window.location.href = queue;
          else router.replace(queue);
        }
      : null,
  );
  const [docs, setDocs] = useState<Entry[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showAll, setShowAll] = useState(false),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState(true),
    [preview, setPreview] = useState(false),
    [reason, setReason] = useState(""),
    [over, setOver] = useState(false),
    [accounted, setAccounted] = useState(false),
    [openLine, setOpenLine] = useState<string | null>(null),
    [lab, setLab] = useState(false),
    [changingOrder, setChangingOrder] = useState(false),
    [showLines, setShowLines] = useState(false);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const retry = useRef<Action | null>(null),
    scope = useRef(id),
    // Chained decisions (link, then confirm) need the revision the first one produced.
    revision = useRef(0),
    added = useRef<Set<string> | null>(null);
  scope.current = id;
  const load = useCallback(async () => {
    const selected = id;
    const res = await fetch(
      `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId, ...(id ? { documentId: id } : {}) })}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as Detail & { error?: string };
    if (!res.ok) throw Error(data.error ?? "Could not load receiving.");
    if (scope.current !== selected) return;
    revision.current = data.review?.revision ?? 0;
    setReceivedAt(Date.now());
    setDocs(data.documents);
    setDetail(id ? data : null);
  }, [jobId, id]);
  useEffect(() => {
    setDetail(null);
    setError("");
    setNotice("");
    setOpenLine(null);
    setChangingOrder(false);
    void load().catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => {
      if (!busy) void load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [load, online, busy]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    // Open a line the reviewer just added so it can be filled in straight away.
    const before = added.current,
      fresh = before && detail?.review.lines.find((l) => !before.has(l.id));
    if (!fresh) return;
    added.current = null;
    setOpenLine(fresh.id);
  }, [detail]);
  const run = async (action: Action, exact = false) => {
    if (busy || !online) return false;
    setBusy(true);
    setError("");
    const body = exact
      ? action
      : {
          ...action,
          jobId,
          documentId: id,
          revision: revision.current,
          requestId: crypto.randomUUID(),
        };
    retry.current = body;
    try {
      const res = await fetch("/api/job-documents/packing-slips/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        retry.current = null;
        throw Error(data.error ?? "Could not save this decision.");
      }
      retry.current = null;
      await load();
      setNotice(
        action.action === "approve"
          ? "Approved quantities updated. Unresolved lines remain in the queue."
          : "Decision saved.",
      );
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connection interrupted. Retry the same request.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const detection = async (action: "analyze" | "clear") => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/job-documents/packing-slips/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          jobId,
          documentId: id,
          runId: detail.document.packingSlipAnalysis?.runId,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw Error(data.error);
      await load();
      setNotice(
        action === "clear"
          ? "Detection cleared. Approved receipts and review decisions are preserved."
          : "Reading again in the background. Approved receipts are preserved.",
      );
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const r = detail?.review,
    a = detail?.document.packingSlipAnalysis;
  const ready = r?.lines.filter((l) => approvable(l, r.kind)) ?? [];
  const remaining =
    r?.lines.filter(
      (l) =>
        !l.ignored &&
        (changed(l, r.kind) || (!!r.sourceTrial && l.checked !== true)),
    ).length ?? 0;
  const active = r?.lines.filter((l) => !l.ignored).length ?? 0;
  const sourceChanged =
    !!r && r.versionId !== detail?.document.currentVersionId;
  const supporting = r?.duplicateDecision?.action === "supporting";
  const repeat = !!detail?.duplicates.some(
    (d) => !r?.duplicateChecked?.includes(d.key),
  );
  const blocked =
    sourceChanged || !!r?.retiredBy || supporting || a?.status === "processing";
  // The review runs in three steps: is it a repeat, which order, then lines.
  const orderConfirmed = !!r?.kindConfirmed && !!r.orderConfirmed;
  const orderStep =
    repeat || supporting
      ? "waiting"
      : orderConfirmed && !changingOrder
        ? "done"
        : "active";
  const linesWaiting = !orderConfirmed || repeat || supporting;
  // Once every line is approved or excluded, the list folds like the steps above.
  const linesDone = !linesWaiting && active > 0 && !remaining;
  const canApprove =
    !!r?.kindConfirmed &&
    !!r.orderConfirmed &&
    ready.length > 0 &&
    !blocked &&
    !repeat;
  const hint = !online
    ? "Reconnect to approve"
    : a?.status === "processing"
      ? "Still reading the slip"
      : sourceChanged
        ? "Review the newer file version first"
        : r?.retiredBy
          ? "This slip was replaced"
          : supporting
            ? "Supporting file · nothing to receive"
            : repeat
              ? "Finish the duplicate check first"
              : !r?.kindConfirmed || !r.orderConfirmed
                ? "Confirm the order first"
                : remaining - ready.length > 0
                    ? `${remaining - ready.length} still to review`
                    : ready.length
                      ? "Everything else is done"
                      : "Every line is approved or excluded";
  // Approval preview: running totals per order line, as the server applies them.
  const totals = new Map<string, { received: number; credit: number }>();
  const approvals = r
    ? ready.map((l) => {
        const delta = receiptDelta(
            lineKind(l, r.kind),
            l.quantity!,
            l.approved,
          ),
          item = detail?.items.find((i) => i.id === l.orderItemId),
          sum = totals.get(l.orderItemId!) ?? {
            received: item?.received ?? 0,
            credit: 0,
          },
          before = sum.received;
        sum.received = qtyRound(sum.received + delta.received);
        sum.credit = qtyRound(sum.credit + delta.credit);
        totals.set(l.orderItemId!, sum);
        const due = item ? qtyRound(item.ordered - sum.credit) : null;
        return {
          line: l,
          delta,
          before,
          after: sum.received,
          due,
          over: due !== null && sum.received > due,
        };
      })
    : [];
  const waiting = docs.filter(
    (d) => d.status === "review" || d.status === "processing",
  ).length;
  // Suggested order matches first: confirming one is quick.
  const shown = docs
    .filter(
      (d) =>
        (showAll ||
          d.status === "review" ||
          d.status === "processing") &&
        `${d.name} ${d.order?.orderNumber ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) => Number(!!b.hasSuggestedOrder) - Number(!!a.hasSuggestedOrder),
    );
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 pb-32 sm:px-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {id ? "Review packing slip" : "Receiving queue"}
          </h1>
          {detail && (
            <p className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
              <FileTextIcon className="size-4 shrink-0" />
              <span className="text-foreground max-w-full truncate font-medium">
                {detail.document.name}
              </span>
              <span className="basis-full pl-5.5 sm:basis-auto sm:pl-0">
                <span className="hidden sm:inline">· </span>
                {detail.document.packingSlip?.orderNumber ??
                  "No order linked"}{" "}
                · {detail.scannedBy} ·{" "}
                {new Date(detail.document.createdAt).toLocaleDateString()}
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {detail && a?.status === "processing" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setProgress(!progress)}
            >
              {progress ? "Hide progress" : "Show progress"}
            </Button>
          )}
          {detail && r && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`Slip lab${r.warnings.length ? `, ${r.warnings.length} reading ${r.warnings.length === 1 ? "note" : "notes"}` : ""}`}
              title="Slip lab"
              className="relative"
              onClick={() => setLab(true)}
            >
              <FlaskConicalIcon className="size-4" />
              {!!r.warnings.length && (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-500"
                />
              )}
            </Button>
          )}
          {detail && (
            <Button variant="outline" size="sm" asChild>
              <Link href={slipViewerHref(jobId, detail)}>
                <EyeIcon />
                View source
              </Link>
            </Button>
          )}
        </div>
      </header>
      {detail && <PackingSlipActivity analysis={a} job={detail.processingJob} online={online} receivedAt={receivedAt} />}
      {!online && (
        <p
          role="status"
          className="bg-muted text-muted-foreground mb-4 rounded-xl px-4 py-3 text-sm"
        >
          Reconnect to review and approve receipts.
        </p>
      )}
      {error && !preview && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950 shadow-lg dark:border-red-500/40 dark:bg-red-950 dark:text-red-100"
        >
          <AlertTriangleIcon className="size-4 shrink-0 text-red-600" />
          <p className="min-w-0 flex-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              retry.current
                ? void run(retry.current, true)
                : void load().catch((e: unknown) => setError(errorMessage(e)))
            }
          >
            {retry.current ? "Retry request" : "Reload"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => setError("")}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {notice && !error && (
        <p
          role="status"
          className="bg-foreground text-background fixed bottom-24 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg"
        >
          {notice}
        </p>
      )}
      {!id ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Which slips"
              className="bg-muted inline-flex shrink-0 rounded-lg p-1"
            >
              {(
                [
                  [false, "To review", waiting],
                  [true, "All", null],
                ] as const
              ).map(([all, label, count]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={showAll === all}
                  onClick={() => setShowAll(all)}
                  className="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-md px-3 py-1.5 text-sm font-medium aria-pressed:shadow-sm"
                >
                  {label}
                  {count !== null && (
                    <>
                      {" "}
                      <span className="tabular-nums">{count}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
            <div className="relative min-w-48 flex-1">
              <SearchIcon className="text-muted-foreground absolute top-3.5 left-3 size-4" />
              <input
                aria-label="Search packing slips"
                className={`${field} pl-9`}
                placeholder="Search slips"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="divide-y border-y">
            {shown.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/jobs/${jobId}/receiving?document=${d.id}`}
                  className="hover:bg-muted/50 flex items-center gap-3 py-3.5 transition-colors motion-reduce:transition-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="text-muted-foreground block truncate text-sm">
                      {d.order?.orderNumber ?? "No order yet"} ·{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-right text-sm ${slipState(d).tone}`}
                  >
                    {slipState(d).label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!shown.length && !error && (
            <p className="py-8 text-sm">
              {!docs.length
                ? "No packing slips yet. Scan a slip from Material Lists or upload it in Documents → Packing Slips."
                : search
                  ? "No slips match."
                  : "Nothing to review."}
            </p>
          )}
        </>
      ) : !detail ? (
        <p role="status">Loading review…</p>
      ) : (
        <>
          {progress && a?.status === "processing" && (
            <div className={`${card} mb-4 px-4 py-3`}>
              <SlipProcessingProgress analysis={a} embedded />
            </div>
          )}
          {a?.status === "failed" && (
            <Callout
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() => void detection("analyze")}
                >
                  Read again
                </Button>
              }
            >
              <p>
                This slip could not be read.
                {a.error ? ` ${a.error}` : ""} You can still add its lines
                yourself.
              </p>
            </Callout>
          )}
          {sourceChanged && (
            <Callout
              actions={
                <>
                  <Button
                    size="sm"
                    disabled={busy || a?.status === "processing"}
                    variant="outline"
                    onClick={() => void detection("analyze")}
                  >
                    Read current version
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      a?.status !== "ready" ||
                      a?.versionId !== detail.document.currentVersionId
                    }
                    onClick={() =>
                      void run({ action: "adoptSource", confirmed: true })
                    }
                  >
                    Review current source
                  </Button>
                </>
              }
            >
              <p>
                The file has a newer version. Read it, then compare it with the
                preserved receipt.
              </p>
            </Callout>
          )}
          {supporting && (
            <Callout
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !online}
                  onClick={() =>
                    void run({
                      action: "reopen",
                      reason: "Reviewer reopened supporting document",
                    })
                  }
                >
                  Reopen review
                </Button>
              }
            >
              <p>This is a supporting file; no quantities will be received.</p>
            </Callout>
          )}
          {r?.retiredBy && (
            <Callout
              actions={
                <Button size="sm" variant="outline" asChild>
                  <Link
                    href={`/jobs/${jobId}/receiving?document=${r.retiredBy}`}
                  >
                    Open replacement
                  </Link>
                </Button>
              }
            >
              <p>This slip was replaced.</p>
            </Callout>
          )}
          <div className="grid gap-5">
            <div className="min-w-0 space-y-4">
              <fieldset
                disabled={busy || !online || blocked}
                className="min-w-0 space-y-4 disabled:opacity-70"
              >
                <Step
                  n={1}
                  title="Duplicate check"
                  state={
                    repeat ||
                    (a?.status === "processing" && !detail.duplicates.length)
                      ? "active"
                      : "done"
                  }
                  warn={repeat}
                  meta={
                    repeat
                      ? "This slip may have been scanned before."
                      : r?.replaces
                        ? "Checked. It replaces an earlier scan."
                        : !detail.duplicates.length
                          ? a?.status === "processing"
                            ? "Checking while the slip is read…"
                            : "Not scanned before."
                          : supporting
                            ? "A repeat scan. Kept as a file only."
                            : "Checked. A different delivery."
                  }
                >
                  {repeat && <DuplicateReview detail={detail} run={run} />}
                </Step>
                <Step
                  n={2}
                  title="Match Order"
                  state={orderStep}
                  meta={
                    orderStep === "waiting"
                      ? supporting
                        ? "Not needed for a repeat scan."
                        : "After the duplicate check."
                      : orderStep === "done"
                        ? orderSummary(detail)
                        : undefined
                  }
                  action={
                    orderStep === "done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setChangingOrder(true)}
                      >
                        Change
                      </Button>
                    )
                  }
                >
                  {orderStep === "active" && (
                    <Identity
                      key={`${id}:${r!.revision}`}
                      detail={detail}
                      jobId={jobId}
                      run={run}
                      onCancel={
                        orderConfirmed ? () => setChangingOrder(false) : undefined
                      }
                      onDone={() => setChangingOrder(false)}
                    />
                  )}
                </Step>
                <Step
                  n={3}
                  title="Line By Line Matching"
                  action={
                    linesDone ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={showLines}
                        onClick={() => setShowLines(!showLines)}
                      >
                        {showLines ? "Hide lines" : "Show lines"}
                      </Button>
                    ) : (
                      !linesWaiting && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={slipViewerHref(jobId, detail)}>
                            <FileTextIcon />
                            View slip
                          </Link>
                        </Button>
                      )
                    )
                  }
                  state={
                    linesWaiting ? "waiting" : linesDone ? "done" : "active"
                  }
                  meta={
                    linesWaiting
                      ? supporting
                        ? "Not needed for a repeat scan."
                        : "After the order is confirmed."
                      : [
                      active - remaining && `${active - remaining} approved`,
                      ready.length && `${ready.length} ready`,
                      remaining - ready.length &&
                        `${remaining - ready.length} to review`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No lines yet"
                  }
                >
                  {!linesWaiting && (!linesDone || showLines) && (
                    <>
                      {active > 0 && (
                        <div aria-hidden className="bg-muted flex h-1">
                          <div
                            className="bg-emerald-500 transition-[width] motion-reduce:transition-none"
                            style={{
                              width: `${((active - remaining) / active) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-sky-500 transition-[width] motion-reduce:transition-none"
                            style={{ width: `${(ready.length / active) * 100}%` }}
                          />
                        </div>
                      )}
                      {(detail.items.length > 0 || r.lines.length > 0) && (
                        <OrderComparison
                          detail={detail}
                          jobId={jobId}
                          run={run}
                          openRow={openLine}
                          setOpenRow={setOpenLine}
                          trial={trialResults}
                        />
                      )}
                      {r.lines.length === 0 && (
                        <div className="border-t px-4 py-8 text-center text-sm">
                          <p className="text-muted-foreground">
                            Read this slip to propose lines, or add a line from the
                            source.
                          </p>
                          <Button
                            className="mt-3"
                            variant="outline"
                            size="sm"
                            onClick={() => void run({ action: "prepare" })}
                          >
                            Read slip
                          </Button>
                        </div>
                      )}
                      <div className="border-t px-2 py-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            added.current = new Set(r.lines.map((l) => l.id));
                            if (
                              !(await run({
                                action: "addLine",
                                page: 1,
                                description: "New slip line",
                              }))
                            )
                              added.current = null;
                          }}
                        >
                          <PlusIcon />
                          Add missing line
                        </Button>
                      </div>
                    </>
                  )}
                </Step>
                {!detail.document.packingSlip && detail.canCreate && (
                  <Reconstruct
                    key={`reconstruct:${r!.revision}`}
                    detail={detail}
                    run={run}
                  />
                )}
              </fieldset>
            </div>
          </div>
          <Dialog open={lab} onOpenChange={setLab}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FlaskConicalIcon className="size-5" />
                  Slip lab
                </DialogTitle>
                <DialogDescription>
                  How this slip was read, other readers, and tools to read it
                  again.
                </DialogDescription>
              </DialogHeader>
              <PackingSlipTrialComparison
                comparison={comparison}
                online={online}
                busy={busy}
                selectedReader={r?.sourceTrial?.reader}
                onUse={async (reader, runId) => {
                  setLab(false);
                  await run({ action: "trialDraft", reader, runId });
                }}
              />
                <section aria-label="Slip tools" className="space-y-4 rounded-lg border px-4 py-4 text-sm">
                  <h3 className="font-medium">Slip tools</h3>
                  {!!r!.warnings.length && (
                    <div>
                      <p className="font-medium">Reading notes</p>
                      <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
                        {r!.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {a?.cascade && (
                    <div className="space-y-1">
                      <p className="font-medium">
                        {a.cascade.status === "not-needed"
                          ? "OCR / Jev handled this slip. Terra was not needed."
                          : a.cascade.status === "completed"
                            ? "OCR → Jev → Terra assistance"
                            : `OCR / Jev reading · Terra ${a.cascade.status.replaceAll("-", " ")}`}
                      </p>
                      {!!a.cascade.reasons.length && (
                        <p className="text-muted-foreground">
                          {a.cascade.reasons.join(" · ")}
                        </p>
                      )}
                      {a.cascade.estimatedUsd != null && (
                        <p className="text-muted-foreground">
                          Terra API estimate: US$
                          {a.cascade.estimatedUsd.toFixed(4)}
                        </p>
                      )}
                      {a.cascade.error && <p>{a.cascade.error}</p>}
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">
                      Reading again or erasing detection keeps approved
                      quantities and saved review decisions.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || a?.status === "processing"}
                        onClick={() => void detection("analyze")}
                      >
                        Rerun detection
                      </Button>
                      {a && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void detection("clear")}
                        >
                          Erase detection
                        </Button>
                      )}
                    </div>
                  </div>
                  {r!.sourceText && (
                    <details>
                      <summary className="text-muted-foreground cursor-pointer">
                        Source text
                      </summary>
                      <pre className="bg-muted mt-2 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                        {r!.sourceText}
                      </pre>
                    </details>
                  )}
                </section>
            </DialogContent>
          </Dialog>
          <footer className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 sm:px-2">
              <div className="min-w-0 text-sm">
                <p className="font-semibold tabular-nums">
                  {canApprove
                    ? `${ready.length} ${ready.length === 1 ? "line" : "lines"} ready to approve`
                    : a?.status === "processing"
                      ? "Reading the slip"
                      : !orderConfirmed
                        ? "Order confirmation required"
                        : "Approval not ready"}
                </p>
                <p className="text-muted-foreground truncate">{hint}</p>
              </div>
              <PriorityActionBar className="w-auto min-w-0">
              <Button
                className="shrink-0"
                disabled={busy || !online || !canApprove}
                onClick={() => {
                  setReason("");
                  setOver(false);
                  setAccounted(r?.documentChecked ?? false);
                  setPreview(true);
                }}
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <CheckIcon className="size-4" />
                )}
                Review & approve
              </Button>
              </PriorityActionBar>
            </div>
          </footer>
          <Dialog open={preview} onOpenChange={setPreview}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  Approve {ready.length} {ready.length === 1 ? "line" : "lines"}
                </DialogTitle>
                <DialogDescription>
                  {typeLabel(r!.kind)} for{" "}
                  {detail.document.packingSlip?.orderNumber}. Only these lines
                  will change.
                </DialogDescription>
              </DialogHeader>
              <ul className="divide-y rounded-lg border">
                {approvals.map(
                  ({ line: l, delta, before, after, due, over: above }) => (
                    <li
                      key={l.id}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {l.description}
                        </p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {[
                            lineKind(l, r!.kind) !== r!.kind &&
                              typeLabel(lineKind(l, r!.kind)),
                            l.approved &&
                              `Previously ${l.approved.quantity} → ${l.quantity}`,
                            due !== null &&
                              `Received ${before} → ${after} of ${due}`,
                            delta.credit !== 0 &&
                              `Credit ${signed(delta.credit)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">
                          {signed(delta.received)}{" "}
                          <span className="text-muted-foreground text-xs font-normal">
                            {l.unit}
                          </span>
                        </p>
                        {above && (
                          <p className={`text-xs ${amber.text}`}>
                            {qtyRound(after - due!)} over
                          </p>
                        )}
                      </div>
                    </li>
                  ),
                )}
              </ul>
              {ready.some((l) => l.approved) && (
                <Label name="Reason for correction">
                  <input
                    className={field}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Label>
              )}
              <div className="space-y-2.5">
                {(approvals.some((x) => x.over) ||
                  over ||
                  /quantity due/i.test(error)) && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={over}
                      onChange={(e) => setOver(e.target.checked)}
                    />
                    I approve any quantity above the amount still due.
                  </label>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={accounted}
                    onChange={(e) => setAccounted(e.target.checked)}
                  />
                  I checked every source page; all item lines are represented in
                  this review.
                </label>
              </div>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <Button
                className="w-full"
                disabled={
                  busy ||
                  (ready.some((l) => l.approved) && reason.trim().length < 3)
                }
                onClick={async () => {
                  if (
                    await run({
                      action: "approve",
                      lineIds: ready.map((l) => l.id),
                      fingerprint: detail.fingerprint,
                      reason,
                      allowOverDelivery: over,
                      documentChecked: accounted,
                    })
                  )
                    setPreview(false);
                }}
              >
                Approve ready lines
              </Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
/** One step of the slip review: a numbered card whose body shows while it is
 * the step to work on. */
function Step({
  n,
  title,
  state,
  meta,
  warn = false,
  action,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "active" | "waiting";
  meta?: ReactNode;
  warn?: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={`Step ${n}: ${title}`}
      className={`${card} overflow-hidden ${warn ? "border-amber-300/70 dark:border-amber-500/40" : ""} ${state === "waiting" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            state === "done"
              ? "bg-emerald-600 text-white"
              : state === "waiting"
                ? "bg-muted text-muted-foreground"
                : warn
                  ? "bg-amber-500 text-white"
                  : "bg-primary text-primary-foreground"
          }`}
        >
          {state === "done" ? <CheckIcon className="size-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {meta && (
            <p className="text-muted-foreground truncate text-sm tabular-nums">
              {meta}
            </p>
          )}
        </div>
        {action}
      </div>
      {children && <div className="border-t">{children}</div>}
    </section>
  );
}
const orderSummary = (detail: Detail) => {
  const r = detail.review;
  return [
    detail.document.packingSlip?.orderNumber ?? "No order linked",
    typeLabel(r.kind),
    detail.suppliers.find((s) => s.id === r.supplierId)?.name ??
      r.supplierName,
    r.deliveryNumber && `Slip ${r.deliveryNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");
};
/** Step 2: the order the slip was matched to, confirmed in one tap, or chosen
 * with the slip's details when the match is wrong or missing. */
function Identity({
  detail,
  jobId,
  run,
  onCancel,
  onDone,
}: {
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  /** Leaves an order that was already confirmed as it was. */
  onCancel?: () => void;
  onDone: () => void;
}) {
  const r = detail.review,
    analysis = detail.document.packingSlipAnalysis,
    linked = detail.document.packingSlip?.orderId ?? "",
    match = detail.orders.find(
      (o) => o.id === (linked || analysis?.orderCandidates?.[0]),
    ),
    [form, setForm] = useState(!!onCancel),
    [kind, setKind] = useState(r.kind),
    [supplierChoice, setSupplier] = useState<string | null>(null),
    [delivery, setDelivery] = useState(r.deliveryNumber),
    [orderNum, setOrderNum] = useState(r.supplierOrderNumber),
    [date, setDate] = useState(r.deliveryDate),
    [linkChoice, setLink] = useState<string | null>(null);
  // Background results can arrive after this form mounts. Follow fresh defaults
  // until the reviewer explicitly chooses a value; polling must not erase edits.
  const link = linkChoice ?? (linked || match?.id || "");
  const supplier = supplierChoice ?? r.supplierId ?? match?.supplierId ?? "";
  const readingKey = `${analysis?.runId}:${analysis?.status}:${analysis?.progress?.completed}:${analysis?.completedAt}`;
  const chooseOrder = (id: string) => {
    setLink(id);
    setForm(true);
    const order = detail.orders.find((o) => o.id === id);
    setSupplier(order?.supplierId ?? "");
  };
  const comparison = link ? <OrderMatchPreview
    jobId={jobId} documentId={detail.document.id} orderId={link}
    readingKey={readingKey}
    sourceUrl={detail.sourceUrl}
  /> : null;
  const suggested = (orderId: string) =>
    analysis?.orderCandidates?.includes(orderId) ?? false;
  const confirm = async (orderId = link) => {
    const supplierId =
      orderId === link
        ? supplier
        : (detail.orders.find((o) => o.id === orderId)?.supplierId ?? "");
    // Linking rematches the lines, so it goes first; the details then confirm on top.
    if (
      orderId &&
      orderId !== linked &&
      !(await run({ action: "link", orderId, confirmed: true }))
    )
      return;
    if (
      await run({
        action: "header",
        kind,
        supplierId: supplierId || null,
        supplierName:
          detail.suppliers.find((s) => s.id === supplierId)?.name ??
          r.supplierName,
        deliveryNumber: delivery,
        supplierOrderNumber: orderNum,
        deliveryDate: date,
        confirmed: true,
        // Every page is confirmed when the lines are approved.
        documentChecked: r.documentChecked ?? false,
      })
    )
      onDone();
  };
  // The one order at 90% match confidence is confirmed without asking, unless
  // the reviewer has started choosing. Change on the step reopens it.
  const autoMatched = useRef(false);
  const matchSure = (orderId: string) => {
    if (
      autoMatched.current ||
      r.orderConfirmed ||
      onCancel ||
      form ||
      analysis?.status === "processing"
    )
      return;
    autoMatched.current = true;
    void confirm(orderId);
  };
  const candidates = <OrderMatchCandidates jobId={jobId} documentId={detail.document.id}
    readingKey={readingKey} selectedId={link} onSelect={chooseOrder} onSure={matchSure} />;
  const confirmButton = (
    <Button onClick={() => void confirm()}>
      <CheckIcon />I confirm this is the correct order
    </Button>
  );
  if (!match && analysis?.status === "processing")
    return (
      <p role="status" className="text-muted-foreground p-4 text-sm">
        Finding the order while the slip is read…
      </p>
    );
  if (!form && match)
    return (
      <div className="space-y-3 p-4">
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-sm">
            {linked ? "Matched order" : "Suggested order"}
          </p>
          <p className="font-medium">{match.name ?? "Order"}</p>
          <p className="text-muted-foreground text-sm">
            {[
              detail.lists.find((l) => l.id === match.listId)?.name,
              detail.suppliers.find((s) => s.id === supplier)?.name ??
                r.supplierName,
              typeLabel(kind),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {candidates}
        {comparison}
        <div className="flex flex-wrap gap-2">
          {confirmButton}
          <Button variant="outline" onClick={() => setForm(true)}>
            Choose another order
          </Button>
        </div>
      </div>
    );
  return (
    <div className="p-4" onChange={() => setForm(true)}>
      <div className="mb-4">{candidates}</div>
      {!match && (
        <p className="mb-3 text-sm">No order matched this slip. Choose it here.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Label name="Order in this job">
          <select
            className={field}
            value={link}
            onChange={(e) => chooseOrder(e.target.value)}
          >
            <option value="" disabled={!!linked}>
              Choose order
            </option>
            {[...detail.orders]
              .sort((a, b) => {
                const candidates = detail.document.packingSlipAnalysis?.orderCandidates ?? [];
                const rank = (id: string) => candidates.includes(id) ? candidates.indexOf(id) : Number.MAX_SAFE_INTEGER;
                return rank(a.id) - rank(b.id);
              })
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {detail.lists.find((l) => l.id === o.listId)?.name}
                  {suggested(o.id) ? " · Suggested match" : ""}
                </option>
              ))}
          </select>
        </Label>
        <Label name="Document type">
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as ReceiptKind)}
          >
            <option value="delivery">Delivery</option>
            <option value="return-replacement">
              Return — replacement expected
            </option>
            <option value="return-credit">
              Return — credit, no replacement
            </option>
          </select>
        </Label>
        <Label name="Supplier">
          <select
            className={field}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">Select supplier</option>
            {detail.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Label>
        <Label name="Delivery / packing slip number">
          <input
            className={field}
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          />
        </Label>
        <Label name="Supplier order reference">
          <input
            className={field}
            value={orderNum}
            onChange={(e) => setOrderNum(e.target.value)}
          />
        </Label>
        <Label name="Printed delivery date">
          <input
            className={field}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Label>
      </div>
      <div className="mt-4">{comparison}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {confirmButton}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
const duplicateReasons = {
  supporting: "Marked as a repeat scan.",
  additional: "Marked as a different delivery.",
  replace: "Marked as replacing the earlier scan.",
} as const;
/** Step 1: an earlier scan that looks the same, and what this one is. */
function DuplicateReview({
  detail,
  run,
}: {
  detail: Detail;
  run: (a: Action) => Promise<boolean>;
}) {
  const [other, setOther] = useState("");
  const unresolved = detail.duplicates.filter(
    (d) => !detail.review.duplicateChecked?.includes(d.key),
  );
  const earlier = unresolved.find((d) => d.id === other) ?? unresolved[0];
  if (!earlier) return null;
  const decide = (decision: keyof typeof duplicateReasons) =>
    void run({
      action: "duplicate",
      decision,
      otherDocumentId: earlier.id,
      reason: duplicateReasons[decision],
    });
  return (
    <div className="space-y-3 p-4 text-sm">
      {unresolved.length > 1 && (
        <Label name="Earlier scan">
          <select
            className={field}
            value={earlier.id}
            onChange={(e) => setOther(e.target.value)}
          >
            {unresolved.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Label>
      )}
      <div className="rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
          <Link className="underline" href={`?document=${earlier.id}`}>
            {earlier.name}
          </Link>
        </p>
        <p className="text-muted-foreground mt-1">
          {earlier.reason}
          {earlier.received ? " It has already been received." : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => decide("supporting")}>
          Same slip, don’t receive
        </Button>
        <Button variant="outline" onClick={() => decide("additional")}>
          Different delivery
        </Button>
        <Button variant="ghost" onClick={() => decide("replace")}>
          Replace the earlier scan
        </Button>
      </div>
    </div>
  );
}
const percent = (v: number) => `${Math.round(v * 100)}%`;
/** The analysis row a review line was drafted from, while still current. */
function sourceLine(l: ReceivingLine, detail: Detail) {
  const a = detail.document.packingSlipAnalysis;
  return l.sourceIndex === undefined || detail.review.analysisRunId !== a?.runId
    ? undefined
    : a?.lines[l.sourceIndex];
}
type ModelReading = {
  reader: TrialReader;
  /** The slip's ordered column, when this reader's row is the one kept. */
  ordered: number | null;
  shipped: number | null;
  unit: string | null;
  match: number | null;
  quantity: number | null;
};
/** Each reader that read a slip line, with its part match and quantity confidence. */
function modelReadings(l: ReceivingLine, detail: Detail): ModelReading[] {
  if (l.predictionSource) {
    const c = l.predictionSource.confidence;
    return [
      {
        reader: l.predictionSource.reader,
        ordered: l.ordered,
        shipped: l.humanEdited ? null : l.quantity,
        unit: l.unit,
        match: c.match.value,
        quantity: c.quantity.value,
      },
    ];
  }
  const source = sourceLine(l, detail);
  if (source)
    return lineReadings(source).map((r) => ({
      ...r,
      ordered: r.reader === slipReader(source) ? (source.ordered ?? null) : null,
      shipped: r.shipped === null ? null : Math.abs(r.shipped),
    }));
  if (!l.readingSource) return [];
  const c = l.readingSource.confidence;
  return [
    {
      reader: l.readingSource.reader,
      ordered: l.ordered,
      shipped: l.humanEdited ? null : l.quantity,
      unit: l.unit,
      match: c ? (c.match ?? c.part) : null,
      quantity: c ? c.quantity : null,
    },
  ];
}
function Confidence({ name, value }: { name: string; value: number | null }) {
  return value === null ? null : (
    <span>
      {name}{" "}
      <span
        className={`font-medium tabular-nums ${unsure(value) ? amber.text : "text-foreground"}`}
      >
        {percent(value)}
      </span>
    </span>
  );
}
/** Terra checked this row and did not back the earlier reading. */
function terraCheck(l: ReceivingLine, detail: Detail) {
  if (
    l.ignored ||
    l.approved ||
    l.predictionSource ||
    l.readingSource?.reader === "terra"
  )
    return null;
  const source = sourceLine(l, detail);
  if (source?.readings?.some((r) => r.reader === "terra")) return null;
  if (
    source?.terraFoundNothing ||
    l.issues.some((s) => s.startsWith("Terra found no product"))
  )
    return {
      reader: "found no product here",
      text: "Terra found no product on this row. It may be a carton, total or note line.",
    };
  if (l.issues.some((s) => s.startsWith("Terra could not resolve this row")))
    return {
      reader: "could not confirm it",
      text: "Terra checked this row and could not confirm a product. It may be a carton, total or note line.",
    };
  return null;
}
const unsure = (confidence: number | null) =>
  confidence !== null && confidence < 0.8;
/** The slip lines against one order item, in the order's unit. */
function compareToOrder(item: ReceiptOrderItem, lines: ReceivingLine[]) {
  const due = Math.max(0, qtyRound(item.ordered - item.received)),
    live = lines.filter((l) => !l.ignored),
    pending = live.filter((l) => !l.approved);
  if (!live.length)
    return lines.length
      ? { ok: true, label: "Left out", text: "text-muted-foreground" }
      : null;
  if (!pending.length)
    return {
      ok: true,
      label: "Received",
      text: "text-emerald-700 dark:text-emerald-300",
    };
  if (pending.some((l) => l.quantity === null))
    return { ok: false, label: "Quantity not read", text: amber.text };
  if (
    pending.some(
      (l) => !!l.unit.trim() && l.unit.trim().toLowerCase() !== item.unit.trim().toLowerCase(),
    )
  )
    return {
      ok: false,
      label: `Different unit. The order counts in ${item.unit}.`,
      text: amber.text,
    };
  const got = qtyRound(pending.reduce((n, l) => n + (l.quantity ?? 0), 0));
  return got === due
    ? {
        ok: true,
        label: "Matches the order",
        text: "text-emerald-700 dark:text-emerald-300",
      }
    : got < due
      ? {
          ok: false,
          label: `${qtyRound(due - got)} ${item.unit} short`,
          text: amber.text,
        }
      : {
          ok: false,
          label: `${qtyRound(got - due)} ${item.unit} more than needed`,
          text: amber.text,
        };
}
const copyLabel =
  "text-muted-foreground text-[11px] font-medium tracking-wide uppercase";
const copyText = "mt-0.5 pb-2 text-sm font-medium break-words";
const copyNote = "mt-1.5 text-xs";
/** Ordered over received, in the same type on both sides of a row. */
function QuantityPair({
  ordered,
  received,
  unit,
}: {
  ordered: number | null;
  received: number | null;
  unit: string;
}) {
  // Many dockets have no ordered column, so a blank there is not a misread.
  const shown = (n: number | null, blank: string) =>
    n === null ? (
      <span className="text-muted-foreground font-normal">{blank}</span>
    ) : (
      `${n} ${unit}`.trim()
    );
  return (
    <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-y-0.5 border-t pt-2 text-sm">
      <dt className="text-muted-foreground text-xs">Ordered</dt>
      <dd className="font-semibold tabular-nums">{shown(ordered, "—")}</dd>
      <dt className="text-muted-foreground text-xs">Received</dt>
      <dd className="font-semibold tabular-nums">{shown(received, "Not read")}</dd>
    </dl>
  );
}
type Verdict = { ok: boolean; label: string; text: string };
/** Whether a count, already in the order's unit, covers what is still due. */
function dueVerdict(item: ReceiptOrderItem, got: number): Verdict {
  const due = Math.max(0, qtyRound(item.ordered - item.received));
  got = qtyRound(got);
  return got === due
    ? {
        ok: true,
        label: "Matches the order",
        text: "text-emerald-700 dark:text-emerald-300",
      }
    : got < due
      ? {
          ok: false,
          label: `${qtyRound(due - got)} ${item.unit} short`,
          text: amber.text,
        }
      : {
          ok: false,
          label: `${qtyRound(got - due)} ${item.unit} more than needed`,
          text: amber.text,
        };
}
/** One reader's count against the order, read as packs or pieces as fits. */
function readingVerdict(
  item: ReceiptOrderItem,
  shipped: number | null,
  unit: string | null,
  text: string,
): Verdict {
  if (shipped === null)
    return { ok: false, label: "Quantity not read", text: amber.text };
  const read = readSlipQuantity(shipped, unit || null, item, text);
  if (read === null)
    return {
      ok: false,
      label: `Different unit. The order counts in ${item.unit}.`,
      text: amber.text,
    };
  const verdict = dueVerdict(item, read.amount);
  return read.amount === shipped
    ? verdict
    : { ...verdict, label: `= ${read.amount} ${item.unit} · ${verdict.label}` };
}
type ReaderCopy = {
  key: string;
  label: string;
  score: number | null;
  description: string;
  ordered: number | null;
  shipped: number | null;
  unit: string;
  verdict: Verdict | null;
  missing?: boolean;
};
const meanScore = (...values: Array<number | null | undefined>) => {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};
/**
 * What each reader saw for one order item, a whole comparison apiece, most
 * confident first. A person's edit comes before any reader.
 */
function readerCopies({
  item,
  lines,
  live,
  readings,
  trialReadings,
}: {
  item: ReceiptOrderItem | undefined;
  lines: ReceivingLine[];
  live: ReceivingLine[];
  readings: Array<ModelReading & { line: ReceivingLine }>;
  trialReadings: Array<{ reader: TrialReader; t: TrialLine }>;
}): ReaderCopy[] {
  if (!lines.length)
    return [
      {
        key: "missing",
        label: "Slip",
        score: null,
        description: "",
        ordered: null,
        shipped: null,
        unit: "",
        verdict: null,
        missing: true,
      },
    ];
  const sum = (values: Array<number | null>) =>
    values.some((v) => v === null)
      ? null
      : qtyRound(values.reduce<number>((a, v) => a + (v ?? 0), 0));
  const describe = (texts: string[]) =>
    [...new Set(texts.map((t) => t.trim()).filter(Boolean))].join(" + ");
  const review = (label: string): ReaderCopy => {
    const shown = live.length ? live : lines;
    return {
      key: label,
      label,
      score: null,
      description: describe(shown.map((l) => l.description)),
      ordered: sum(shown.map((l) => l.ordered)),
      shipped: sum(shown.map((l) => l.quantity)),
      unit: shown[0]!.unit,
      verdict: item ? compareToOrder(item, lines) : null,
    };
  };
  const byReader = new Map<string, ReaderCopy & { texts: string[] }>();
  const add = (
    reader: TrialReader,
    ordered: number | null,
    shipped: number | null,
    unit: string | null,
    score: number | null,
    text: string,
  ) => {
    const copy = byReader.get(reader);
    if (copy) {
      copy.ordered =
        copy.ordered === null || ordered === null
          ? null
          : qtyRound(copy.ordered + ordered);
      copy.shipped =
        copy.shipped === null || shipped === null
          ? null
          : qtyRound(copy.shipped + shipped);
      copy.texts.push(text);
      copy.score = meanScore(copy.score, score);
      return;
    }
    byReader.set(reader, {
      key: reader,
      label: readerLabels[reader],
      score,
      description: "",
      ordered,
      shipped,
      unit: unit ?? "",
      verdict: null,
      texts: [text],
    });
  };
  for (const x of readings)
    add(
      x.reader,
      x.ordered,
      x.shipped,
      x.unit,
      meanScore(x.match, x.quantity),
      x.line.description,
    );
  for (const { reader, t } of trialReadings)
    add(
      reader,
      t.ordered,
      t.shipped,
      t.unit,
      meanScore(t.confidence.match.value, t.confidence.quantity.value),
      t.description,
    );
  const ranked: ReaderCopy[] = [...byReader.values()]
    .map(({ texts, ...copy }) => {
      const description = describe(texts);
      return {
        ...copy,
        description,
        verdict: item
          ? readingVerdict(item, copy.shipped, copy.unit, description)
          : null,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (!live.length || !ranked.length) return [review("Slip"), ...ranked];
  if (live.some((l) => l.humanEdited)) return [review("Edited"), ...ranked];
  // Once received, the top copy says so rather than re-judging the count.
  if (live.every((l) => l.approved) && item)
    ranked[0] = { ...ranked[0]!, verdict: compareToOrder(item, lines) };
  return ranked;
}
/** Step 3: every order item beside what the slip says arrived for it. */
function OrderComparison({
  detail,
  jobId,
  run,
  openRow,
  setOpenRow,
  trial,
}: {
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  openRow: string | null;
  setOpenRow: (row: string | null) => void;
  trial: TrialResults | null;
}) {
  // One toggle for every row: opening the other readers on one opens them all.
  const [showOthers, setShowOthers] = useState(false);
  const [preview, setPreview] = useState<
    | { kind: "item"; item: ReceiptOrderItem }
    | {
        kind: "slip";
        title: string;
        sources: Array<{ page: number; box?: SlipBox }>;
      }
    | null
  >(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const showPreview = (value: NonNullable<typeof preview>) => {
    previewTrigger.current = document.activeElement as HTMLElement | null;
    setPreview(value);
  };
  const r = detail.review,
    slip = r.lines.map((line, index) => ({ line, index }));
  const known = new Set(detail.items.map((i) => i.id));
  const rows = [
    ...detail.items.map((item, n) => ({
      key: `item:${item.id}`,
      n,
      item,
      lines: slip.filter((x) => x.line.orderItemId === item.id),
    })),
    ...slip
      .filter((x) => !x.line.orderItemId || !known.has(x.line.orderItemId))
      .map((x, i) => ({
        key: x.line.id,
        n: detail.items.length + i,
        item: undefined,
        lines: [x],
      })),
  ];
  // Independent trial readers, when this slip was part of a comparison.
  const others = (itemId: string, skip: Set<string>) =>
    trial
      ? readersInTrial(trial)
          .filter((reader) => !skip.has(reader))
          .flatMap((reader) =>
            trial[reader]?.status === "complete"
              ? trial[reader].lines
                  .filter((t) => t.orderItemId === itemId)
                  .map((t) => ({ reader, t }))
              : [],
          )
      : [];
  return (
    <div>
      <ul className="divide-y">
        {rows.map(({ key, n, item, lines }) => {
          const open = openRow === key,
            live = lines.filter((x) => !x.line.ignored),
            status = lines
              .map((x) => lineStatus(x.line, r))
              .sort(
                (x, y) => statusOrder.indexOf(x) - statusOrder.indexOf(y),
              )[0],
            tone = status ? statusStyle[status] : undefined,
            due = item
              ? Math.max(0, qtyRound(item.ordered - item.received))
              : 0,
            readings = live.flatMap((x) =>
              modelReadings(x.line, detail).map((reading) => ({
                ...reading,
                line: x.line,
              })),
            ),
            trialReadings = item
              ? others(item.id, new Set<string>(readings.map((x) => x.reader)))
              : [],
            title = item ? item.description : lines[0]!.line.description,
            likely = item ? null : likelyName(detail, lines),
            orderText = item
              ? item.description
              : likely
                ? `Likely ${likely}`
                : "No matching part";
          const copies = readerCopies({
            item,
            lines: lines.map((x) => x.line),
            live: live.map((x) => x.line),
            readings,
            trialReadings,
          });
          return (
            <li key={key} className={open ? "bg-muted/30" : undefined}>
              {(showOthers ? copies : copies.slice(0, 1)).map((copy, c) => (
                <div
                  key={copy.key}
                  className={`relative grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_1rem] grid-rows-[auto_1fr_auto_auto] gap-x-3 px-4 ${c ? "border-t border-dashed pb-3 pt-2.5" : "py-3"}`}
                >
                  {c === 0 ? (
                    <span
                      aria-hidden
                      className={`row-span-4 mt-5 flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${tone?.badge ?? "bg-muted text-muted-foreground"}`}
                    >
                      {status === "approved" ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        n + 1
                      )}
                    </span>
                  ) : (
                    <span className="row-span-4" />
                  )}
                  <div
                    className={`relative row-span-4 grid min-w-0 grid-rows-subgrid ${c ? "text-muted-foreground" : ""}`}
                  >
                    <p className={copyLabel}>Order</p>
                    {c === 0 ? (
                      <h3 aria-label={title} className={copyText}>
                        {item ? (
                          <button
                            type="button"
                            aria-label={`View material-list item: ${title}`}
                            onClick={() => showPreview({ kind: "item", item })}
                            className="text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                          >
                            {orderText}
                          </button>
                        ) : (
                          orderText
                        )}
                      </h3>
                    ) : (
                      <p className={copyText}>
                        {item ? (
                          <button
                            type="button"
                            aria-label={`View material-list item: ${title}`}
                            onClick={() => showPreview({ kind: "item", item })}
                            className="text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                          >
                            {orderText}
                          </button>
                        ) : (
                          orderText
                        )}
                      </p>
                    )}
                    {item ? (
                      <QuantityPair
                        ordered={item.ordered}
                        received={item.received}
                        unit={item.unit}
                      />
                    ) : (
                      <p className="text-muted-foreground border-t pt-2 text-sm">
                        Not on the order
                      </p>
                    )}
                    <p className={copyNote}>
                      {item && (
                        <>
                          {due > 0
                            ? `${due} ${item.unit} still due`
                            : "All received"}
                          {item.sku && ` · ${item.sku}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label={`${copy.label} reading`}
                    className="relative row-span-4 grid min-w-0 grid-rows-subgrid border-l pl-3"
                  >
                    <p className={copyLabel}>
                      {copy.label}
                      {copy.score !== null && (
                        <span
                          className={`ml-1.5 normal-case tabular-nums ${unsure(copy.score) ? amber.text : ""}`}
                        >
                          {percent(copy.score)}
                        </span>
                      )}
                    </p>
                    {copy.missing ? (
                      <>
                        <p className={`${copyText} text-muted-foreground`}>
                          Not on the slip
                        </p>
                        <span />
                      </>
                    ) : (
                      <>
                        <p className={copyText}>
                          <button
                            type="button"
                            aria-label={`View packing-slip line: ${copy.description || title} (${copy.label})`}
                            className="text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                            onClick={() => {
                              const fromTrial = trialReadings.filter(
                                ({ reader }) => reader === copy.key,
                              );
                              const matching = live.filter(({ line }) =>
                                modelReadings(line, detail).some(
                                  (reading) => reading.reader === copy.key,
                                ),
                              );
                              const sources = fromTrial.length
                                ? fromTrial.map(({ t }) => ({
                                    page: t.page,
                                    box: t.box ?? undefined,
                                  }))
                                : (matching.length ? matching : lines).map(
                                    ({ line }) => ({
                                      page: line.page,
                                      box:
                                        line.sourceBox ??
                                        sourceLine(line, detail)?.box,
                                    }),
                                  );
                              showPreview({
                                kind: "slip",
                                title: copy.description || title,
                                sources,
                              });
                            }}
                          >
                            {copy.description || "—"}
                          </button>
                        </p>
                        <QuantityPair
                          ordered={copy.ordered}
                          received={copy.shipped}
                          unit={copy.unit}
                        />
                      </>
                    )}
                    <div>
                      {!copy.missing && (
                        <>
                          {copy.verdict && (
                            <p
                              className={`${copyNote} flex items-center gap-1 font-medium ${copy.verdict.text}`}
                            >
                              {copy.verdict.ok ? (
                                <CheckCircle2Icon className="size-3.5 shrink-0" />
                              ) : (
                                <AlertTriangleIcon className="size-3.5 shrink-0" />
                              )}
                              {copy.verdict.label}
                            </p>
                          )}
                          {c === 0 && !item && tone && (
                            <p
                              className={`${copyNote} font-medium ${tone.text}`}
                            >
                              {tone.label}
                            </p>
                          )}
                        </>
                      )}
                      {c === 0 && copies.length > 1 && (
                        <button
                          type="button"
                          aria-expanded={showOthers}
                          onClick={() => setShowOthers(!showOthers)}
                          className="text-muted-foreground hover:text-foreground relative z-10 mt-2 inline-flex items-center gap-1 text-xs font-medium"
                        >
                          {showOthers
                            ? "Hide other readers"
                            : `${copies.length - 1} other ${copies.length === 2 ? "reader" : "readers"}`}
                          <ChevronDownIcon
                            className={`size-3.5 transition-transform motion-reduce:transition-none ${showOthers ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                  {c === 0 && lines.length > 0 ? (
                    <button
                      type="button"
                      aria-label={`Review line: ${title}`}
                      aria-expanded={open}
                      onClick={() => setOpenRow(open ? null : key)}
                      className="relative row-span-4 mt-4 h-8 w-6 -ml-1 rounded focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronDownIcon
                        aria-hidden
                        className={`text-muted-foreground size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  ) : (
                    <span className="row-span-4" />
                  )}
                </div>
              ))}
              {live.flatMap((x) => {
                const check = terraCheck(x.line, detail);
                return check
                  ? [
                      <p
                        key={`terra:${x.line.id}`}
                        className={`px-4 pb-3 pl-13 text-xs ${amber.text}`}
                      >
                        {readerLabels.terra} {check.reader}.
                      </p>,
                    ]
                  : [];
              })}
              {open &&
                lines.map(({ line, index }) => (
                  <div key={line.id}>
                    {lines.length > 1 && (
                      <p className="text-muted-foreground px-4 pb-1 text-xs font-medium">
                        Slip line {index + 1}
                      </p>
                    )}
                    <LineReview
                      key={`${line.id}:${r.revision}`}
                      line={line}
                      index={index}
                      detail={detail}
                      jobId={jobId}
                      run={run}
                      onDone={() => setOpenRow(null)}
                    />
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previewTrigger.current?.focus({ preventScroll: true });
          }}
          className={`flex max-h-[90dvh] flex-col overflow-hidden ${preview?.kind === "slip" ? "sm:max-w-4xl" : "sm:max-w-md"}`}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {preview?.kind === "item"
                ? "Material-list item"
                : "Packing-slip line"}
            </DialogTitle>
            <DialogDescription>
              {preview?.kind === "item"
                ? preview.item.description
                : preview?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            {preview?.kind === "item" && (
              <ReceivingItemPreview
                item={preview.item}
                part={detail.orderParts?.[preview.item.id]}
                materialListId={
                  detail.document.packingSlip?.materialListId ??
                  detail.orders.find(
                    (o) => o.id === detail.document.packingSlip?.orderId,
                  )?.listId ??
                  ""
                }
                materialListName={detail.document.packingSlip?.materialListName}
                supplierName={
                  detail.suppliers.find(
                    (s) => s.id === detail.review.supplierId,
                  )?.name ?? detail.review.supplierName
                }
              />
            )}
            {preview?.kind === "slip" &&
              (detail.review.versionId !== detail.document.currentVersionId ? (
                <p className="text-sm text-muted-foreground">
                  The source file changed. Review the new version before viewing
                  this line.
                </p>
              ) : (
                <div className="space-y-4">
                  {preview.sources.map((source, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Page {source.page}
                        {!source.box &&
                          " · Exact line position unavailable; showing the source page."}
                      </p>
                      <SlipLineImage
                        url={detail.sourceUrl}
                        page={source.page}
                        box={source.box ?? { x: 0, y: 0, width: 1, height: 1 }}
                        label={`Packing-slip source ${i + 1}, page ${source.page}`}
                        initiallyZoomed
                        showError
                      />
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <Button className="w-full shrink-0" onClick={() => setPreview(null)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Asks how to read a slip count that disagrees with its order part, and
 * shows the part changes that would let the next slip match on its own. */
function PartFitDialog({
  fit,
  item,
  unit,
  onClose,
  onChoose,
}: {
  fit: PartFit | null;
  item: ReceiptOrderItem | undefined;
  unit: string;
  onClose: () => void;
  onChoose: (over?: {
    quantity?: number;
    unit?: string;
    fit?: PartUpdate;
  }) => void;
}) {
  const change = !!fit?.rows.length,
    read = fit?.read ?? null,
    counted = fit && item ? `${fit.quantity} ${item.unit}` : "";
  return (
    <Dialog open={!!fit && !!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {fit && item && (
          <>
            <DialogHeader>
              <DialogTitle>
                {change
                  ? "Update this part to match the slip?"
                  : `Receive ${counted}?`}
              </DialogTitle>
              <DialogDescription>{fit.reason}</DialogDescription>
            </DialogHeader>
            {change && (
              <div className="min-w-0 space-y-2 text-sm">
                <p className="font-medium break-words">{item.description}</p>
                <table className="w-full table-fixed text-left">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="w-[34%] pb-1 font-normal">
                        <span className="sr-only">Detail</span>
                      </th>
                      <th className="w-[24%] pb-1 font-normal">Now</th>
                      <th className="pb-1 font-normal">Change to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fit.rows.map((r) => (
                      <tr key={r.label} className="border-t align-top">
                        <th
                          scope="row"
                          className="text-muted-foreground py-2 pr-3 font-normal"
                        >
                          {r.label}
                        </th>
                        <td className="text-muted-foreground py-2 pr-3">
                          {r.before}
                        </td>
                        <td className="py-2 font-medium break-words">
                          {r.after}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-muted-foreground text-xs">
                  Next time, a slip like this one matches without asking.
                </p>
              </div>
            )}
            {fit.held && (
              <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                {fit.held}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {change && (
                <Button
                  onClick={() =>
                    onChoose({
                      fit: fit.update,
                      ...(read === null
                        ? {}
                        : { quantity: fit.quantity, unit: item.unit }),
                    })
                  }
                >
                  <CheckIcon />
                  {read === null
                    ? "Update part and confirm"
                    : `Update part and receive ${counted}`}
                </Button>
              )}
              {read === null ? (
                <Button variant="outline" onClick={() => onChoose()}>
                  Confirm only
                </Button>
              ) : (
                <Button
                  variant={change ? "outline" : "default"}
                  onClick={() =>
                    onChoose({ quantity: fit.quantity, unit: item.unit })
                  }
                >
                  {!change && <CheckIcon />}
                  {change ? `Receive ${counted} only` : `Receive ${counted}`}
                </Button>
              )}
              {read !== null && (
                <Button variant="ghost" onClick={() => onChoose()}>
                  Keep {read} {unit || item.unit}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
const slipViewerHref = (jobId: string, detail: Detail) =>
  `/jobs/${jobId}/documents?document=${detail.document.id}&from=receiving`;
function LineReview({
  line: l,
  index,
  detail,
  jobId,
  run,
  onDone,
}: {
  line: ReceivingLine;
  index: number;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  onDone: () => void;
}) {
  const [name, setName] = useState(l.description),
    [kind, setKind] = useState(l.kind ?? ""),
    [sku, setSku] = useState(l.sku),
    [quantity, setQuantity] = useState(
      l.quantity === null ? "" : String(l.quantity),
    ),
    [ordered, setOrdered] = useState(
      l.ordered === null ? "" : String(l.ordered),
    ),
    [unit, setUnit] = useState(l.unit),
    [price, setPrice] = useState(
      l.unitPrice === null ? "" : String(l.unitPrice),
    ),
    [item, setItem] = useState(l.orderItemId ?? ""),
    [checked, setChecked] = useState(l.checked ?? false),
    [part, setPart] = useState(false),
    [reason, setReason] = useState(""),
    // Lines missing a quantity or an order part open straight into editing.
    [editing, setEditing] = useState(
      !l.orderItemId || l.quantity === null,
    );
  const a = detail.document.packingSlipAnalysis,
    source =
      l.sourceIndex === undefined || detail.review.analysisRunId !== a?.runId
        ? undefined
        : a?.lines[l.sourceIndex];
  const sourceBox =
    detail.review.versionId === detail.document.currentVersionId
      ? (l.sourceBox ?? source?.box)
      : undefined;
  const terra = terraCheck(l, detail);
  const save = (
    asChecked: boolean,
    over: { quantity?: number; unit?: string; fit?: PartUpdate } = {},
  ) =>
    run({
      action: "line",
      lineId: l.id,
      kind: kind || null,
      description: name,
      sku,
      quantity: over.quantity ?? (quantity === "" ? null : Number(quantity)),
      ordered: ordered === "" ? null : Number(ordered),
      unit: over.unit ?? unit,
      unitPrice: price === "" ? null : Number(price),
      orderItemId: item || null,
      checked: asChecked,
      ...(over.fit && Object.keys(over.fit).length ? { fit: over.fit } : {}),
    });
  const complete = !!item && quantity !== "";
  const chosen = detail.items.find((i) => i.id === item);
  // A slip line that disagrees with its order part asks before it is
  // confirmed: how to read the count, and what to change on the part.
  const [fit, setFit] = useState<PartFit | null>(null);
  const confirm = async () => {
    const found =
      chosen && quantity !== ""
        ? partFit(
            chosen,
            {
              quantity: Number(quantity),
              read: l.quantity,
              unit,
              description: name,
              sku,
              evidence: l.evidence,
            },
            detail.orderParts?.[chosen.id],
            {
              byHand: item !== (l.orderItemId ?? ""),
              canEdit: !!detail.canEditParts,
            },
          )
        : null;
    if (found) setFit(found);
    else if (await save(true)) onDone();
  };
  const finish = async (over?: Parameters<typeof save>[1]) => {
    setFit(null);
    if (await save(true, over)) onDone();
  };
  if (l.ignored)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="text-muted-foreground min-w-0 flex-1 break-words">
          Left out: {l.ignored.reason}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void run({
              action: "restoreLine",
              lineId: l.id,
              reason: "Reviewer restored excluded line",
            })
          }
        >
          Restore line
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 px-4 pb-4">
          {sourceBox && (
            <SlipLineImage
              url={detail.sourceUrl}
              page={l.page}
              box={sourceBox}
              label={`Source for line ${index + 1}`}
            />
          )}
          <Button variant="link" size="sm" className="-my-1 h-auto px-0" asChild>
            <Link href={slipViewerHref(jobId, detail)}>
              <FileTextIcon />
              View whole slip
            </Link>
          </Button>
          {terra ? (
            <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <p>{terra.text}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void run({
                    action: "ignore",
                    lineId: l.id,
                    reason: "Not a product line.",
                  })
                }
              >
                Not a product, leave it out
              </Button>
            </div>
          ) : l.issues.length > 0 && !l.checked && !l.autoConfirmed && (
            <p className="text-sm">
              {sourceBox
                ? "The reading is unsure. Check the slip image above."
                : "The reading is unsure. Check it against the slip."}
            </p>
          )}
          {!l.orderItemId &&
            !l.approved &&
            detail.canCreate &&
            detail.document.packingSlip && (
              <AddToList line={l} detail={detail} jobId={jobId} run={run} />
            )}
          {editing && (
            <div className="space-y-3 border-t pt-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem]">
                <Label name="Matched order part">
                  <select
                    className={field}
                    value={item}
                    disabled={!!l.approved}
                    onChange={(e) => {
                      setItem(e.target.value);
                      const i = detail.items.find(
                        (i) => i.id === e.target.value,
                      );
                      if (i) setUnit(i.unit);
                      setChecked(false);
                    }}
                  >
                    <option value="">Unmatched</option>
                    {detail.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.description} · due{" "}
                        {Math.max(0, qtyRound(i.ordered - i.received))} {i.unit}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label
                  name={
                    (kind || detail.review.kind) === "delivery"
                      ? "Quantity"
                      : "Return quantity"
                  }
                >
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className={field}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </Label>
                <Label name="Unit (Optional)">
                  <input
                    className={field}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder={detail.items.find((i) => i.id === item)?.unit ?? "Order unit"}
                  />
                </Label>
              </div>
              {/* Without an order, a chosen part rebuilds one below. */}
              {!l.orderItemId &&
                detail.canCreate &&
                !detail.document.packingSlip && (
                  <div className="-mt-1 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-3"
                      onClick={() => setPart(!part)}
                    >
                      <SearchIcon />
                      Find or create part
                    </Button>
                  </div>
                )}
              {part && (
                <PartDraft line={l} detail={detail} jobId={jobId} run={run} />
              )}
              <details className="group text-sm">
                <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
                  More fields
                  <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Label name="Description">
                    <input
                      className={field}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Label>
                  <Label name="Line type">
                    <select
                      className={field}
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as ReceiptKind | "")
                      }
                    >
                      <option value="">Use document type</option>
                      <option value="delivery">Delivery</option>
                      <option value="return-replacement">
                        Return for replacement
                      </option>
                      <option value="return-credit">Return for credit</option>
                    </select>
                  </Label>
                  <Label name="Supplier code">
                    <input
                      className={field}
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                    />
                  </Label>
                  <Label name="Printed ordered quantity">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={field}
                      value={ordered}
                      onChange={(e) => setOrdered(e.target.value)}
                    />
                  </Label>
                  <Label name="Price per order unit (optional)">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={field}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </Label>
                  {(!l.approved || l.approved.quantity === 0) && (
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <input
                        aria-label="Reason for excluding line"
                        className={`${field} flex-1 basis-56`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Other reason to leave it out: totals, duplicate…"
                      />
                      <Button
                        variant="outline"
                        className="h-11"
                        disabled={reason.trim().length < 3}
                        onClick={() =>
                          void run({ action: "ignore", lineId: l.id, reason })
                        }
                      >
                        Exclude with reason
                      </Button>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!complete} onClick={() => void confirm()}>
              <CheckIcon />
              {editing ? "Save and confirm" : "Looks right"}
            </Button>
            {editing ? (
              <Button variant="outline" onClick={() => void save(checked)}>
                Save changes
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Change
              </Button>
            )}
            {(!l.approved || l.approved.quantity === 0) && (
              <Button
                variant="ghost"
                className="text-muted-foreground ml-auto"
                onClick={() =>
                  void run({
                    action: "ignore",
                    lineId: l.id,
                    reason: "Not delivered.",
                  })
                }
              >
                Not delivered
              </Button>
            )}
          </div>
          <PartFitDialog
            fit={fit}
            item={chosen}
            unit={unit}
            onClose={() => setFit(null)}
            onChoose={(over) => void finish(over)}
          />
          {!complete && (
            <p className="text-muted-foreground -mt-1 text-xs">
              Match a part and enter the quantity to confirm this line.
            </p>
          )}
          <details className="group text-sm">
            <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
              Reading notes
              {l.issues.length > 0 && ` (${l.issues.length})`}
              <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-2 space-y-2">
              {l.issues.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  {l.issues.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground text-xs">
                Line {index + 1} · page {l.page} · “{l.evidence}”
                {l.readingSource && (
                  <span title="Confidence estimates are retained with the original reading; they are not measured accuracy or approval.">
                    {" · "}
                    {l.readingSource.reader === "terra"
                      ? "Terra assisted"
                      : l.readingSource.reader === "jev"
                        ? "Jev image reading"
                        : "OCR reading"}
                    {l.readingSource.confidence &&
                      ` · product ${Math.round(l.readingSource.confidence.part * 100)}% · quantity ${Math.round(l.readingSource.confidence.quantity * 100)}% confidence`}
                  </span>
                )}
              </p>
            </div>
          </details>
    </div>
  );
}
/** The likely catalogue part, named in a row that is not on the order. */
const likelyName = (detail: Detail, lines: Array<{ line: ReceivingLine }>) => {
  const top = detail.likely?.[lines[0]?.line.id ?? ""]?.[0];
  return top && (top.code || top.score >= 0.45) ? top.name : undefined;
};
/** Links the catalogue part and puts it on the order's material list. */
const addPart = (
  run: (a: Action) => Promise<boolean>,
  line: ReceivingLine,
  p: Part,
  packageUnitConfirmed = false,
) =>
  run({
    action: "part",
    lineId: line.id,
    partId: p.id,
    name: p.name.slice(0, 255),
    description: (p.description ?? "").slice(0, 4000),
    catalogId: p.catalogId,
    unit: (p.unit?.trim() ? p.unit : line.unit.trim() ? line.unit : "ea").slice(
      0,
      32,
    ),
    piecesPerPack: p.piecesPerPack,
    individualUnit: (p.individualUnit ?? "").slice(0, 32),
    photoUrl: null,
    addToOrder: true,
    packageUnitConfirmed,
  });
function PartChoice({
  part: p,
  note,
  primary,
  disabled,
  onAdd,
  line,
}: {
  line: ReceivingLine;
  part: Part;
  note?: string;
  primary?: boolean;
  disabled?: boolean;
  onAdd: (confirmed?: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const needsConfirmation = receiptUnit(line.unit) === "ea" && !!p.piecesPerPack && p.piecesPerPack > 1 && !!p.unit && receiptUnit(p.unit) !== "ea";
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      {p.photoUrl ? (
        <PartImage
          width={48}
          height={48}
          alt=""
          src={p.photoUrl}
          className="part-photo size-12 shrink-0 rounded object-contain p-1"
        />
      ) : (
        <span aria-hidden className="bg-muted size-12 shrink-0 rounded" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{p.name}</p>
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
      </div>
      <Button
        size="sm"
        variant={primary ? "default" : "outline"}
        aria-label={`Add ${p.name} to the list`}
        disabled={disabled}
        onClick={() => needsConfirmation ? setConfirm(true) : onAdd()}
      >
        <PlusIcon />
        Add to list
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm what “each” means</DialogTitle>
            <DialogDescription>
              {p.name}: one {p.unit} contains {p.piecesPerPack} {p.individualUnit ?? "pieces"}.
              Does 1 {line.unit ?? "EA"} on the slip mean one complete {p.unit}?
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Ordered: {line.ordered ?? line.quantity ?? "not entered"} {p.unit}.
            Delivered: {line.quantity ?? "not entered"} {p.unit}.
            The counts stay the same. You will still review and approve the delivery.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={() => { setConfirm(false); onAdd(true); }}>Yes, add as {p.unit}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
/** A slip line that is not on the order. The reviewer adds the likely
 * catalogue part, or a new one, to the order's material list. */
function AddToList({
  line,
  detail,
  jobId,
  run,
}: {
  line: ReceivingLine;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"search" | "new" | null>(null);
  const likely = detail.likely?.[line.id] ?? [],
    order = detail.document.packingSlip!,
    count = line.ordered ?? line.quantity,
    counted = count !== null && count > 0;
  const toggle = (next: "search" | "new") =>
    setMode(mode === next ? null : next);
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div>
        <h4 className="font-medium">Add it to the material list</h4>
        <p className="text-muted-foreground text-sm">
          This part is not on order {order.orderNumber}. Adding it puts it on{" "}
          {order.materialListName}
          {counted ? ` with ${count} ordered` : ""}. You still confirm what
          came.
        </p>
        {!counted && (
          <p className={`mt-1 text-sm ${amber.text}`}>
            Enter the quantity that came below and save it first.
          </p>
        )}
      </div>
      {likely.length > 0 ? (
        <ul
          aria-label="Likely catalogue parts"
          className="divide-y rounded-md border"
        >
          {likely.map((p, i) => (
            <PartChoice
              key={p.id}
              part={p}
              line={line}
              primary={i === 0}
              disabled={!counted}
              note={
                p.id === line.partId
                  ? "Chosen part"
                  : p.code
                    ? "Same supplier code"
                    : p.score >= 0.58
                      ? "Close match"
                      : "Possible match"
              }
              onAdd={(confirmed) => void addPart(run, line, p, confirmed)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm">No close match in your catalogue.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-expanded={mode === "search"}
          onClick={() => toggle("search")}
        >
          <SearchIcon />
          Search catalogue
        </Button>
        <Button
          size="sm"
          variant={likely.length ? "outline" : "default"}
          aria-expanded={mode === "new"}
          onClick={() => toggle("new")}
        >
          <PlusIcon />
          New part in ForemanHQ
        </Button>
      </div>
      {mode && (
        <PartDraft
          key={mode}
          line={line}
          detail={detail}
          jobId={jobId}
          run={run}
          mode={mode}
        />
      )}
    </section>
  );
}
/** Mode `all` chooses or creates a part for a slip with no order yet; `search`
 * and `new` also put the part on the linked order's material list. */
function PartDraft({
  line,
  detail,
  jobId,
  run,
  mode = "all",
}: {
  line: ReceivingLine;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  mode?: "all" | "search" | "new";
}) {
  const [name, setName] = useState(line.description.slice(0, 255)),
    [description, setDescription] = useState(line.description),
    [catalog, setCatalog] = useState(detail.catalogs[0]?.id ?? ""),
    [unit, setUnit] = useState(line.unit || "ea"),
    [pack, setPack] = useState(""),
    [individual, setIndividual] = useState("ea"),
    [parts, setParts] = useState<Part[]>([]),
    [selected, setSelected] = useState<Part | null>(null),
    [search, setSearch] = useState(line.description.slice(0, 70)),
    [error, setError] = useState(""),
    [photoSuggestions, setPhotoSuggestions] = useState<
      Detail["photoSuggestions"]
    >([]),
    [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // A new part's photo suggestions follow its name.
  const query = mode === "new" ? name : search,
    count = line.ordered ?? line.quantity,
    // Only a counted line can go on the order.
    blocked = mode !== "all" && !(count !== null && count > 0);
  const find = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId, documentId: detail.document.id, q: query })}`,
      );
      const data = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw Error(data.error);
      setParts(data.parts);
      setPhotoSuggestions(data.photoSuggestions ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [jobId, detail.document.id, query]);
  useEffect(() => {
    const t = setTimeout(() => void find(), 300);
    return () => clearTimeout(t);
  }, [find]);
  return (
    <section className="bg-background space-y-3 rounded-lg border p-4">
      <h4 className="font-medium">
        {mode === "search"
          ? "Search the catalogue"
          : mode === "new"
            ? "New part in ForemanHQ"
            : "Catalogue part"}
      </h4>
      <p className="text-muted-foreground text-sm">
        {mode === "search"
          ? "Find the part, then add it to the list."
          : mode === "new"
            ? "It joins your catalogue and this order's material list. Prices stay with this job."
            : "Reuse an existing part, or approve a new entry for your organization. Prices stay with this job."}
      </p>
      {mode !== "new" && (
        <div className="flex gap-2">
          <input
            aria-label="Search catalogue"
            className={field}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="outline" onClick={() => void find()}>
            Search
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {mode === "search" &&
        (parts.length ? (
          <ul
            aria-label="Catalogue parts"
            className="divide-y rounded-md border"
          >
            {parts.map((p) => (
              <PartChoice
                key={p.id}
                part={p}
                line={line}
                disabled={blocked}
                onAdd={(confirmed) => void addPart(run, line, p, confirmed)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No parts found.</p>
        ))}
      {mode === "all" &&
        parts.map((p) => (
          <button
            key={p.id}
            className={`flex w-full items-center gap-3 border-b py-2 text-left text-sm ${selected?.id === p.id ? "bg-muted" : ""}`}
            onClick={() => {
              setSelected(p);
              setName(p.name);
              setCatalog(p.catalogId);
              setUnit(p.unit ?? unit);
            }}
          >
            {p.photoUrl && (
              <img
                alt={p.name}
                src={p.photoUrl}
                className="size-12 object-contain"
              />
            )}
            {p.name}
          </button>
        ))}
      {mode !== "search" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label name="Part name">
              <input
                className={field}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSelected(null);
                }}
              />
            </Label>
            <Label name="Catalogue">
              <select
                className={field}
                value={catalog}
                onChange={(e) => setCatalog(e.target.value)}
              >
                {detail.catalogs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label name="Description">
              <input
                className={field}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Label>
            <Label name="Order unit">
              <input
                className={field}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Label>
            <Label name="Pieces per pack (if packaged)">
              <input
                type="number"
                min="1"
                className={field}
                value={pack}
                onChange={(e) => setPack(e.target.value)}
              />
            </Label>
            <Label name="Individual unit">
              <input
                className={field}
                value={individual}
                onChange={(e) => setIndividual(e.target.value)}
              />
            </Label>
          </div>
          {!selected && photoSuggestions.length > 0 && (
            <div>
              <p className="mb-2 text-sm">
                Photo suggestions from your catalogue — select only if it shows
                this product.
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {photoSuggestions.map(
                  (p) =>
                    p.imageUrl && (
                      <button
                        key={p.id}
                        aria-pressed={photoUrl === p.imageUrl}
                        className="w-28 shrink-0 rounded border p-2 text-xs aria-pressed:ring-2"
                        onClick={() =>
                          setPhotoUrl(
                            photoUrl === p.imageUrl ? null : p.imageUrl,
                          )
                        }
                      >
                        <img
                          src={p.imageUrl}
                          alt={p.displayName}
                          className="mb-1 h-20 w-full object-contain"
                        />
                        {p.displayName}
                      </button>
                    ),
                )}
              </div>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {selected?.photoUrl
              ? "Photo from the existing catalogue."
              : "No verified product photo is available. You can add one in Catalogue; a guessed photo will not be used."}
          </p>
          <Button
            disabled={blocked}
            onClick={() =>
              void run({
                action: "part",
                lineId: line.id,
                partId: selected?.id ?? null,
                name,
                description,
                catalogId: catalog,
                unit,
                piecesPerPack: pack ? Number(pack) : null,
                individualUnit: individual,
                photoUrl: selected?.photoUrl ?? photoUrl,
                addToOrder: mode === "new",
              })
            }
          >
            {mode === "new"
              ? "Add to ForemanHQ and the list"
              : selected
                ? "Use catalogue part"
                : "Approve new catalogue part"}
          </Button>
        </>
      )}
    </section>
  );
}
function Reconstruct({
  detail,
  run,
}: {
  detail: Detail;
  run: (a: Action) => Promise<boolean>;
}) {
  const [list, setList] = useState(""),
    [name, setName] = useState(
      `Delivery ${detail.review.deliveryDate || new Date().toLocaleDateString()}`,
    ),
    [number, setNumber] = useState(
      detail.review.supplierOrderNumber ||
        `SLIP-${detail.document.id.slice(0, 8)}`,
    );
  const candidates = detail.review.lines.filter(
    (l) => !l.ignored && l.partId && l.ordered !== null && l.ordered > 0,
  );
  return (
    <details className={`${card} px-4 py-3`}>
      <summary className="cursor-pointer font-medium">
        Reconstruct an order from this slip
      </summary>
      <p className="text-muted-foreground my-3 text-sm">
        Log an order already placed outside FormanHQ. Nothing is sent to the
        supplier. Choose catalogue parts and confirm ordered quantities first.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label name="Material list">
          <select
            className={field}
            value={list}
            onChange={(e) => setList(e.target.value)}
          >
            <option value="">Create a new material list</option>
            {detail.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Label>
        {!list && (
          <Label name="New list name">
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Label>
        )}
        <Label name="Order reference">
          <input
            className={field}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </Label>
      </div>
      <p className="my-3 text-sm">
        {candidates.length} lines have a catalogue part and ordered quantity.
        Other lines stay unresolved.
      </p>
      <Button
        disabled={!candidates.length || !detail.review.supplierId}
        onClick={() =>
          void run({
            action: "reconstruct",
            materialListId: list || null,
            listName: name,
            orderNumber: number,
            lineIds: candidates.map((l) => l.id),
            confirmed: true,
          })
        }
      >
        Approve reconstructed order
      </Button>
    </details>
  );
}
