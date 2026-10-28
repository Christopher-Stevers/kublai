"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
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
import { DocumentPdfPreview } from "~/components/jobs/documents/DocumentPdfPreview";
import { SlipLineImage } from "./SlipLineImage";
import { SlipProcessingProgress } from "./SlipProcessingProgress";
import type {
  ReceivingReview,
  ReceivingLine,
  ReceiptKind,
} from "~/lib/receiving-review";
import { receiptDelta, qtyRound, lineKind } from "~/lib/receiving-review";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import type { JobDocument } from "~/server/documents/types";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  PackingSlipTrialComparison,
  PackingSlipTrialSummary,
  type TrialSummary,
} from "./PackingSlipTrial";
import { trialReaders } from "~/lib/packing-slip-trial";

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
type Detail = {
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
  photoSuggestions: Array<{
    id: string;
    displayName: string;
    imageUrl: string | null;
  }>;
  canCreate: boolean;
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
  !!l.unit &&
  (l.checked === true || !l.issues.length) &&
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
export function ReceivingWorkspace({ jobId }: { jobId: string }) {
  const query = useSearchParams(),
    router = useRouter(),
    id = query.get("document");
  const online = useOnlineStatus();
  const [docs, setDocs] = useState<Entry[]>([]),
    [trial, setTrial] = useState<TrialSummary | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showAll, setShowAll] = useState(false),
    [suggestedFirst, setSuggestedFirst] = useState(true),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState(true),
    [source, setSource] = useState(false),
    [preview, setPreview] = useState(false),
    [reason, setReason] = useState(""),
    [over, setOver] = useState(false),
    [accounted, setAccounted] = useState(false),
    [openLine, setOpenLine] = useState<string | null>(null);
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
    setDocs(data.documents);
    setDetail(id ? data : null);
  }, [jobId, id]);
  useEffect(() => {
    setSource(window.matchMedia?.("(min-width: 1280px)").matches ?? false);
    setDetail(null);
    setError("");
    setNotice("");
    setOpenLine(null);
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
            : !r?.kindConfirmed
              ? "Confirm the slip details first"
              : !r.orderConfirmed
                ? "Link an order first"
                : repeat
                  ? "Decide on the possible repeat first"
                  : remaining - ready.length > 0
                    ? `${remaining - ready.length} still to review`
                    : ready.length
                      ? "Everything else is done"
                      : "Every line is approved or excluded";
  const lines = r
    ? r.lines
        .map((line, index) => ({ line, index, status: lineStatus(line, r) }))
        .sort(
          (x, y) =>
            statusOrder.indexOf(x.status) - statusOrder.indexOf(y.status) ||
            x.index - y.index,
        )
    : [];
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
  const select = (docId: string) =>
    router.push(`/jobs/${jobId}/receiving?document=${docId}`);
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 pb-32 sm:px-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            className="text-muted-foreground inline-flex items-center gap-1 text-sm"
            href={
              id ? `/jobs/${jobId}/receiving` : `/jobs/${jobId}/material-lists`
            }
          >
            <ChevronLeftIcon className="size-4" />
            {id ? "Receiving queue" : "Material lists"}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
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
        <div className="flex shrink-0 items-center gap-2 pt-7">
          {detail && a?.status === "processing" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setProgress(!progress)}
            >
              {progress ? "Hide progress" : "Show progress"}
            </Button>
          )}
          {detail && (
            <Button
              variant="outline"
              size="sm"
              aria-label={source ? "Hide source" : "View source"}
              aria-pressed={source}
              onClick={() => setSource(!source)}
            >
              {source ? <EyeOffIcon /> : <EyeIcon />}
              <span className="hidden sm:inline">
                {source ? "Hide source" : "View source"}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh receiving queue"
            onClick={() =>
              void load().catch((e: unknown) => setError(errorMessage(e)))
            }
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        </div>
      </header>
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
          <PackingSlipTrialSummary
            jobId={jobId}
            online={online}
            onUpdate={setTrial}
          />
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <div className="relative min-w-48 flex-1">
              <SearchIcon className="text-muted-foreground absolute top-3.5 left-3 size-4" />
              <input
                aria-label="Search packing slips"
                className={`${field} pl-9`}
                placeholder="Search slips or orders"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show completed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={suggestedFirst}
                onChange={(e) => setSuggestedFirst(e.target.checked)}
              />
              Suggested order matches first
            </label>
          </div>
          <p className="text-muted-foreground mb-3 text-sm">
            {
              docs.filter(
                (d) => d.status === "review" || d.status === "processing",
              ).length
            }{" "}
            slips awaiting review · this job only
          </p>
          <div className="divide-y border-y">
            {docs
              .filter(
                (d) =>
                  (showAll ||
                    !!trial?.cases.some(
                      (c) =>
                        c.documentId === d.id &&
                        d.reviewTrialRunId !== trial.runId,
                    ) ||
                    d.status === "review" ||
                    d.status === "processing") &&
                  `${d.name} ${d.order?.orderNumber ?? ""}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .sort((a, b) =>
                suggestedFirst
                  ? Number(!!b.hasSuggestedOrder) -
                    Number(!!a.hasSuggestedOrder)
                  : 0,
              )
              .map((d) => (
                <button
                  key={d.id}
                  onClick={() => select(d.id)}
                  className="hover:bg-muted/50 flex w-full items-center gap-3 py-4 text-left transition-colors motion-reduce:transition-none"
                >
                  <FileTextIcon className="text-muted-foreground size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {d.order?.orderNumber ?? "Order not linked"} ·{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                    {d.hasSuggestedOrder && (
                      <span className="block text-xs text-sky-700 dark:text-sky-300">
                        Suggested order match · needs confirmation
                      </span>
                    )}
                    {trial?.cases.find((c) => c.documentId === d.id) && (
                      <span className="text-muted-foreground block text-xs">
                        Fresh trial ·{" "}
                        {
                          trialReaders.filter(
                            (reader) =>
                              trial.cases.find((c) => c.documentId === d.id)
                                ?.readers?.[reader] === "complete",
                          ).length
                        }
                        /4 readings ready
                      </span>
                    )}
                  </span>
                  <span className="text-sm">
                    {d.status === "processing"
                      ? "Reading…"
                      : d.status === "review"
                        ? d.pending === null
                          ? "Needs review"
                          : `${d.pending} unresolved`
                        : d.status === "complete"
                          ? trial && d.reviewTrialRunId !== trial.runId
                            ? "Previously approved"
                            : "Reviewed"
                          : d.status === "supporting"
                            ? "Supporting file"
                            : "Replaced"}
                  </span>
                </button>
              ))}
          </div>
          {!docs.length && !error && (
            <p className="py-8 text-sm">
              No packing slips yet. Scan a slip from Material Lists or upload it
              in Documents → Packing Slips.
            </p>
          )}
        </>
      ) : !detail ? (
        <p role="status">Loading review…</p>
      ) : (
        <>
          <PackingSlipTrialComparison
            key={detail.document.id}
            jobId={jobId}
            documentId={detail.document.id}
            online={online}
            busy={busy}
            selectedReader={r?.sourceTrial?.reader}
            onUse={async (reader, runId) => {
              await run({ action: "trialDraft", reader, runId });
            }}
          />
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
          <div
            className={`grid gap-5 ${source ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}
          >
            {source && (
              <aside
                className={`${card} h-[55vh] overflow-hidden xl:sticky xl:top-20 xl:h-[75vh]`}
              >
                {detail.sourceMimeType?.startsWith("image/") ? (
                  <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
                    <img
                      src={detail.sourceUrl}
                      alt={detail.document.name}
                      className="h-full w-full object-contain"
                    />
                  </a>
                ) : (
                  <DocumentPdfPreview
                    url={detail.sourceUrl}
                    title={detail.document.name}
                    fillHeight
                  />
                )}
              </aside>
            )}
            <div className="min-w-0 space-y-4">
              <fieldset
                disabled={busy || !online || blocked}
                className="min-w-0 space-y-4 disabled:opacity-70"
              >
                <Identity
                  key={`${id}:${r!.revision}`}
                  detail={detail}
                  run={run}
                />
                {detail.duplicates.length > 0 && (
                  <DuplicateReview detail={detail} run={run} />
                )}
                <section className={`${card} overflow-hidden`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3 pb-2.5">
                    <h2 className="font-semibold">Slip lines</h2>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {[
                        active - remaining && `${active - remaining} approved`,
                        ready.length && `${ready.length} ready`,
                        remaining - ready.length &&
                          `${remaining - ready.length} to review`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No lines yet"}
                    </p>
                  </div>
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
                  {lines.length > 0 ? (
                    <ul className="divide-y">
                      {lines.map(({ line: l, index, status }) => (
                        <LineReview
                          key={`${id}:${l.id}:${r!.revision}`}
                          line={l}
                          index={index}
                          status={status}
                          detail={detail}
                          jobId={jobId}
                          run={run}
                          open={openLine === l.id}
                          setOpen={(open) => setOpenLine(open ? l.id : null)}
                        />
                      ))}
                    </ul>
                  ) : (
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
                        added.current = new Set(r!.lines.map((l) => l.id));
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
                </section>
                {!detail.document.packingSlip && detail.canCreate && (
                  <Reconstruct
                    key={`reconstruct:${r!.revision}`}
                    detail={detail}
                    run={run}
                  />
                )}
              </fieldset>
              <details className={`${card} group text-sm`}>
                <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span>
                    Slip tools
                    {!!r!.warnings.length && (
                      <span className={`ml-2 text-xs ${amber.text}`}>
                        {r!.warnings.length} reading{" "}
                        {r!.warnings.length === 1 ? "note" : "notes"}
                      </span>
                    )}
                  </span>
                  <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="space-y-4 border-t px-4 py-4">
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
                </div>
              </details>
            </div>
          </div>
          <footer className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 sm:px-2">
              <div className="min-w-0 text-sm">
                <p className="font-semibold tabular-nums">
                  {ready.length} {ready.length === 1 ? "line" : "lines"} ready
                  to approve
                </p>
                <p className="text-muted-foreground truncate">{hint}</p>
              </div>
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
function Identity({
  detail,
  run,
}: {
  detail: Detail;
  run: (a: Action) => Promise<boolean>;
}) {
  const r = detail.review,
    linked = detail.document.packingSlip?.orderId ?? "",
    confirmed = r.kindConfirmed && !!r.orderConfirmed,
    [editing, setEditing] = useState(!confirmed),
    [kind, setKind] = useState(r.kind),
    [supplier, setSupplier] = useState(r.supplierId ?? ""),
    [delivery, setDelivery] = useState(r.deliveryNumber),
    [orderNum, setOrderNum] = useState(r.supplierOrderNumber),
    [date, setDate] = useState(r.deliveryDate),
    [link, setLink] = useState(linked),
    [newSupplier, setNewSupplier] = useState(false),
    [name, setName] = useState(r.supplierName),
    [email, setEmail] = useState(r.supplierEmail ?? ""),
    [phone, setPhone] = useState(r.supplierPhone ?? ""),
    [accounted, setAccounted] = useState(r.documentChecked ?? false);
  const suggested = (orderId: string) =>
    detail.document.packingSlipAnalysis?.orderCandidates?.includes(orderId) ??
    false;
  if (!editing)
    return (
      <section className={`${card} flex items-center gap-3 px-4 py-3`}>
        <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            {detail.document.packingSlip?.orderNumber ?? "No order linked"} ·{" "}
            {typeLabel(r.kind)}
          </p>
          <p className="text-muted-foreground truncate">
            {[
              detail.suppliers.find((s) => s.id === r.supplierId)?.name ??
                r.supplierName,
              r.deliveryNumber && `Slip ${r.deliveryNumber}`,
              r.supplierOrderNumber && `Ref ${r.supplierOrderNumber}`,
              r.deliveryDate,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </section>
    );
  return (
    <section className={`${card} p-4`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-semibold">Slip details</h2>
        {!confirmed && (
          <p className={`text-xs ${amber.text}`}>
            {r.kindConfirmed
              ? "Link an order to approve lines"
              : "Confirm before approving"}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label name="Order in this job">
          <select
            className={field}
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              const order = detail.orders.find((o) => o.id === e.target.value);
              if (order?.supplierId) setSupplier(order.supplierId);
            }}
          >
            <option value="" disabled={!!linked}>
              Choose order
            </option>
            {[...detail.orders]
              .sort((a, b) => Number(suggested(b.id)) - Number(suggested(a.id)))
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
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={accounted}
          onChange={(e) => setAccounted(e.target.checked)}
        />
        All source pages and item lines are accounted for.
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            // Linking rematches the lines, so it goes first; the details then confirm on top.
            if (
              link &&
              link !== linked &&
              !(await run({ action: "link", orderId: link, confirmed: true }))
            )
              return;
            await run({
              action: "header",
              kind,
              supplierId: supplier || null,
              supplierName:
                detail.suppliers.find((s) => s.id === supplier)?.name ?? name,
              deliveryNumber: delivery,
              supplierOrderNumber: orderNum,
              deliveryDate: date,
              confirmed: true,
              documentChecked: accounted,
            });
          }}
        >
          <CheckIcon />
          Confirm details
        </Button>
        {confirmed && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        {detail.canCreate && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setNewSupplier(!newSupplier)}
          >
            New supplier
          </Button>
        )}
      </div>
      {newSupplier && (
        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          <p className="text-muted-foreground text-sm sm:col-span-3">
            Create a shared organization supplier from this slip.
          </p>
          <Label name="Supplier name">
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Label>
          <Label name="Email">
            <input
              type="email"
              className={field}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Label>
          <Label name="Phone">
            <input
              className={field}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Label>
          <div className="sm:col-span-3">
            <Button
              variant="outline"
              onClick={() =>
                void run({ action: "supplier", name, email, phone })
              }
            >
              Approve new supplier
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
function DuplicateReview({
  detail,
  run,
}: {
  detail: Detail;
  run: (a: Action) => Promise<boolean>;
}) {
  const [reason, setReason] = useState(""),
    [comparison, setComparison] = useState("");
  const unresolved = detail.duplicates.filter(
    (d) => !detail.review.duplicateChecked?.includes(d.key),
  );
  if (!unresolved.length)
    return (
      <p className="text-muted-foreground px-1 text-sm">
        Duplicate reviewed:{" "}
        {detail.review.duplicateDecision?.action === "supporting"
          ? "supporting document, no receiving"
          : "explicit additional delivery or replacement"}
        .
      </p>
    );
  return (
    <section className="rounded-xl border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <h3 className="flex items-center gap-2 font-semibold">
        <AlertTriangleIcon className="size-4 text-amber-600" />
        Possible repeated slip
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Review before receiving. A matching supplier order number alone is not a
        duplicate.
      </p>
      {unresolved.map((d) => (
        <div key={d.id} className="mt-3 text-sm">
          <Link className="font-medium underline" href={`?document=${d.id}`}>
            {d.name}
          </Link>
          <p className="text-muted-foreground">
            {d.reason}
            {d.received ? " It already has approved quantities." : ""}
          </p>
        </div>
      ))}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label name="Compare with this saved slip">
          <select
            className={field}
            value={
              unresolved.some((d) => d.id === comparison)
                ? comparison
                : unresolved[0]!.id
            }
            onChange={(e) => setComparison(e.target.value)}
          >
            {unresolved.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Label>
        <Label name="Reason for your decision">
          <input
            className={field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["supporting", "additional", "replace"] as const).map((choice) => (
          <Button
            key={choice}
            variant="outline"
            size="sm"
            disabled={reason.trim().length < 3}
            onClick={() =>
              void run({
                action: "duplicate",
                decision: choice,
                otherDocumentId: unresolved.some((d) => d.id === comparison)
                  ? comparison
                  : unresolved[0]!.id,
                reason,
              })
            }
          >
            {choice === "supporting"
              ? "Keep file only"
              : choice === "additional"
                ? "Separate delivery"
                : "Replace original"}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Leave this review to cancel receiving. The saved scan stays in the
        queue.
      </p>
    </section>
  );
}
function LineReview({
  line: l,
  index,
  status,
  detail,
  jobId,
  run,
  open,
  setOpen,
}: {
  line: ReceivingLine;
  index: number;
  status: LineStatus;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  open: boolean;
  setOpen: (open: boolean) => void;
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
    [excluding, setExcluding] = useState(false),
    [reason, setReason] = useState(""),
    [part, setPart] = useState(false);
  const a = detail.document.packingSlipAnalysis,
    source =
      l.sourceIndex === undefined || detail.review.analysisRunId !== a?.runId
        ? undefined
        : a?.lines[l.sourceIndex];
  const sourceBox =
    detail.review.versionId === detail.document.currentVersionId
      ? (l.sourceBox ?? source?.box)
      : undefined;
  const tone = statusStyle[status],
    match = l.orderItemId
      ? (detail.items.find((i) => i.id === l.orderItemId)?.description ??
        "Order part")
      : null;
  const save = (asChecked: boolean) =>
    run({
      action: "line",
      lineId: l.id,
      kind: kind || null,
      description: name,
      sku,
      quantity: quantity === "" ? null : Number(quantity),
      ordered: ordered === "" ? null : Number(ordered),
      unit,
      unitPrice: price === "" ? null : Number(price),
      orderItemId: item || null,
      checked: asChecked,
    });
  const complete = !!item && quantity !== "" && !!unit.trim();
  return (
    <li className={open ? "bg-muted/30" : undefined}>
      <div className="relative flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${tone.badge}`}
        >
          {status === "approved" ? (
            <CheckIcon className="size-3.5" />
          ) : (
            index + 1
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className={`font-medium break-words ${l.ignored ? "text-muted-foreground line-through" : ""}`}
          >
            {l.ignored ? (
              l.description
            ) : (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="focus-visible:after:ring-ring/50 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
              >
                {l.description}
              </button>
            )}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-sm break-words">
            {l.ignored ? (
              l.ignored.reason
            ) : (
              <>
                {match ? (
                  match.trim().toLowerCase() ===
                  l.description.trim().toLowerCase() ? (
                    "Matched to order"
                  ) : (
                    match
                  )
                ) : (
                  <span className={amber.text}>Not matched to the order</span>
                )}
                {l.sku && ` · ${l.sku}`}
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {!l.ignored && (
            <p className="font-semibold tabular-nums">
              {l.quantity ?? <span className={amber.text}>?</span>}{" "}
              <span className="text-muted-foreground text-xs font-normal">
                {l.unit}
              </span>
            </p>
          )}
          <p className={`text-xs font-medium ${tone.text}`}>{tone.label}</p>
          {l.ignored && (
            <Button
              variant="ghost"
              size="sm"
              className="relative z-10 -mr-2"
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
          )}
        </div>
        {!l.ignored && (
          <ChevronDownIcon
            aria-hidden
            className={`text-muted-foreground mt-1 size-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        )}
      </div>
      {open && !l.ignored && (
        <div className="space-y-4 px-4 pb-4 sm:pl-13">
          {sourceBox && (
            <SlipLineImage
              url={detail.sourceUrl}
              page={l.page}
              box={sourceBox}
              label={`Source for line ${index + 1}`}
            />
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
          {l.issues.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {l.issues.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                  {s}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem]">
            <Label name="Matched order part">
              <select
                className={field}
                value={item}
                disabled={!!l.approved}
                onChange={(e) => {
                  setItem(e.target.value);
                  const i = detail.items.find((i) => i.id === e.target.value);
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
            <Label name="Unit">
              <input
                className={field}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="ea, ft…"
              />
            </Label>
          </div>
          {!l.orderItemId && detail.canCreate && (
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
              {l.partId && detail.document.packingSlip && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run({ action: "extra", lineId: l.id, confirmed: true })
                  }
                >
                  Approve additional order line
                </Button>
              )}
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
                  onChange={(e) => setKind(e.target.value as ReceiptKind | "")}
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
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!complete}
              onClick={async () => {
                if (await save(true)) setOpen(false);
              }}
            >
              <CheckIcon />
              Confirm line
            </Button>
            <Button variant="outline" onClick={() => void save(checked)}>
              Save changes
            </Button>
            {(!l.approved || l.approved.quantity === 0) && (
              <Button
                variant="ghost"
                className="text-muted-foreground ml-auto"
                aria-expanded={excluding}
                onClick={() => setExcluding(!excluding)}
              >
                Exclude line
              </Button>
            )}
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">
            {complete
              ? "Confirm once the product, quantity and unit match the source."
              : "Match a part and enter the quantity to confirm this line."}
          </p>
          {excluding && (
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Reason for excluding line"
                className={`${field} flex-1 basis-56`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why? Totals, duplicate, nothing delivered…"
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
      )}
    </li>
  );
}
function PartDraft({
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
  const find = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId, documentId: detail.document.id, q: search })}`,
      );
      const data = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw Error(data.error);
      setParts(data.parts);
      setPhotoSuggestions(data.photoSuggestions ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [jobId, detail.document.id, search]);
  useEffect(() => {
    const t = setTimeout(() => void find(), 300);
    return () => clearTimeout(t);
  }, [find]);
  return (
    <section className="bg-background space-y-3 rounded-lg border p-4">
      <h4 className="font-medium">Catalogue part</h4>
      <p className="text-muted-foreground text-sm">
        Reuse an existing part, or approve a new entry for your organization.
        Prices stay with this job.
      </p>
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
      {error && <p role="alert">{error}</p>}
      {parts.map((p) => (
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
            Photo suggestions from your catalogue — select only if it shows this
            product.
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
                      setPhotoUrl(photoUrl === p.imageUrl ? null : p.imageUrl)
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
          })
        }
      >
        {selected ? "Use catalogue part" : "Approve new catalogue part"}
      </Button>
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
