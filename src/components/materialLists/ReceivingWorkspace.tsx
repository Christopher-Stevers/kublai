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
  CheckIcon,
  ChevronLeftIcon,
  FileTextIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  AlertTriangleIcon,
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
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState(true),
    [source, setSource] = useState(false),
    [preview, setPreview] = useState(false),
    [reason, setReason] = useState(""),
    [over, setOver] = useState(false),
    [accounted, setAccounted] = useState(false);
  const retry = useRef<Action | null>(null),
    scope = useRef(id);
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
    setDocs(data.documents);
    setDetail(id ? data : null);
  }, [jobId, id]);
  useEffect(() => {
    setSource(window.matchMedia?.("(min-width: 1280px)").matches ?? false);
    setDetail(null);
    setError("");
    setNotice("");
    void load().catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => {
      if (!busy) void load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [load, online, busy]);
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
          revision: detail?.review.revision ?? 0,
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
  const sourceChanged =
    !!r && r.versionId !== detail?.document.currentVersionId;
  const blocked =
    sourceChanged ||
    !!r?.retiredBy ||
    r?.duplicateDecision?.action === "supporting" ||
    a?.status === "processing";
  const canApprove =
    !!r?.kindConfirmed &&
    !!r.orderConfirmed &&
    ready.length > 0 &&
    !blocked &&
    !detail?.duplicates.some((d) => !r?.duplicateChecked?.includes(d.key));
  const select = (docId: string) =>
    router.push(`/jobs/${jobId}/receiving?document=${docId}`);
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 pb-32 sm:px-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
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
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh receiving queue"
          onClick={() =>
            void load().catch((e: unknown) => setError(errorMessage(e)))
          }
        >
          <RefreshCwIcon className="size-4" />
        </Button>
      </header>
      {!online && (
        <p role="status" className="mb-4 border-b py-3">
          Reconnect to review and approve receipts.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 border-l-2 border-red-500 p-3 text-sm"
        >
          {error}{" "}
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
        </div>
      )}
      {notice && (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
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
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">{detail.document.name}</h2>
              <p className="text-muted-foreground text-sm">
                {detail.document.packingSlip?.orderNumber ?? "Choose an order"}{" "}
                · scanned by {detail.scannedBy} ·{" "}
                {new Date(detail.document.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSource(!source)}
              >
                {source ? "Hide source" : "View source"}
              </Button>
              {a?.status === "processing" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setProgress(!progress)}
                >
                  {progress ? "Hide progress" : "Show progress"}
                </Button>
              )}
            </div>
          </div>
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
          {progress && a && <SlipProcessingProgress analysis={a} embedded />}
          {sourceChanged && (
            <div className="mb-4 border-l-2 border-amber-500 p-3 text-sm">
              <p>
                The file has a newer version. Read it, then compare it with the
                preserved receipt.
              </p>
              <Button
                disabled={busy || a?.status === "processing"}
                variant="outline"
                onClick={() => void detection("analyze")}
              >
                Read current version
              </Button>
              <Button
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
            </div>
          )}
          {r?.duplicateDecision?.action === "supporting" && (
            <p className="border-y py-3 text-sm">
              This is a supporting file; no quantities will be received.{" "}
              <Button
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
            </p>
          )}
          {r?.retiredBy && (
            <p className="border-y py-3">
              This slip was replaced.{" "}
              <Link
                className="underline"
                href={`/jobs/${jobId}/receiving?document=${r.retiredBy}`}
              >
                Open replacement
              </Link>
            </p>
          )}
          <div
            className={`mt-5 grid gap-6 ${source ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}
          >
            {source && (
              <aside className="h-[55vh] overflow-hidden border xl:sticky xl:top-20 xl:h-[75vh]">
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
            <div className="min-w-0 space-y-5">
              <fieldset
                disabled={busy || !online || blocked}
                className="min-w-0 space-y-5 disabled:opacity-70"
              >
                <Identity
                  key={`${id}:${r!.revision}`}
                  detail={detail}
                  run={run}
                />
                {detail.duplicates.length > 0 && (
                  <DuplicateReview detail={detail} run={run} />
                )}
                <div className="flex items-baseline justify-between border-b pb-3">
                  <h2 className="font-semibold">Slip lines</h2>
                  <span className="text-muted-foreground text-sm">
                    {ready.length} ready · {remaining - ready.length} need
                    attention
                  </span>
                </div>
                <div className="divide-y">
                  {r!.lines.map((l, i) => (
                    <LineReview
                      key={`${id}:${l.id}:${r!.revision}`}
                      line={l}
                      index={i}
                      detail={detail}
                      jobId={jobId}
                      run={run}
                    />
                  ))}
                </div>
                {!r!.lines.length && (
                  <p className="text-muted-foreground text-sm">
                    Read this slip to propose lines, or add a line from the
                    source.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run({
                        action: "addLine",
                        page: 1,
                        description: "New slip line",
                      })
                    }
                  >
                    Add missing line
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void run({ action: "prepare" })}
                  >
                    Read slip
                  </Button>
                </div>
                {!detail.document.packingSlip && detail.canCreate && (
                  <Reconstruct
                    key={`reconstruct:${r!.revision}`}
                    detail={detail}
                    run={run}
                  />
                )}
              </fieldset>
              {!!r!.warnings.length && (
                <details className="border-y py-3 text-sm">
                  <summary className="cursor-pointer">
                    Reading notes ({r!.warnings.length})
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {r!.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">
                  Detection and source text
                </summary>
                {a?.cascade && (
                  <div className="my-3 space-y-1">
                    <p>{a.cascade.status === "not-needed" ? "OCR / Jev handled this slip. Terra was not needed." : a.cascade.status === "completed" ? "OCR → Jev → Terra assistance" : `OCR / Jev reading · Terra ${a.cascade.status.replaceAll("-", " ")}`}</p>
                    {!!a.cascade.reasons.length && <p className="text-muted-foreground">{a.cascade.reasons.join(" · ")}</p>}
                    {a.cascade.estimatedUsd != null && <p className="text-muted-foreground">Terra API estimate: US${a.cascade.estimatedUsd.toFixed(4)}</p>}
                    {a.cascade.error && <p>{a.cascade.error}</p>}
                  </div>
                )}
                <p className="my-3">
                  Rerunning or clearing detection preserves approved quantities
                  and saved review decisions. Compare a new reading with the
                  source before correcting a receipt.
                </p>
                <div className="flex gap-2">
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
                {r!.sourceText && (
                  <pre className="bg-muted mt-3 max-h-72 overflow-auto p-3 text-xs whitespace-pre-wrap">
                    {r!.sourceText}
                  </pre>
                )}
              </details>
            </div>
          </div>
          <footer className="bg-background fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {ready.length} lines ready for approval
                </p>
                <p className="text-muted-foreground">
                  {remaining - ready.length} stay in review
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy || !online || !canApprove}
                onClick={() => {
                  setReason("");
                  setOver(false);
                  setAccounted(r?.documentChecked ?? false);
                  setPreview(true);
                }}
              >
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <CheckIcon className="mr-1 size-4" />
                )}
                Review & approve
              </Button>
            </div>
          </footer>
          <Dialog open={preview} onOpenChange={setPreview}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
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
              <div className="divide-y">
                {ready.map((l) => {
                  const delta = receiptDelta(
                    lineKind(l, r!.kind),
                    l.quantity!,
                    l.approved,
                  );
                  return (
                    <div key={l.id} className="py-3 text-sm">
                      <p className="font-medium">
                        {l.description} · {typeLabel(lineKind(l, r!.kind))}
                      </p>
                      <p>
                        {l.approved
                          ? `Previously ${l.approved.quantity} → ${l.quantity}`
                          : `${l.quantity} ${l.unit}`}{" "}
                        · received change {delta.received > 0 ? "+" : ""}
                        {delta.received}
                        {delta.credit !== 0
                          ? ` · credit change ${delta.credit > 0 ? "+" : ""}${delta.credit}`
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
              {ready.some((l) => l.approved) && (
                <Label name="Reason for correction">
                  <input
                    className={field}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={over}
                  onChange={(e) => setOver(e.target.checked)}
                />
                I approve any quantity above the amount still due.
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={accounted}
                  onChange={(e) => setAccounted(e.target.checked)}
                />
                I checked every source page; all item lines are represented in
                this review.
              </label>
              <Button
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
    [kind, setKind] = useState(r.kind),
    [supplier, setSupplier] = useState(r.supplierId ?? ""),
    [delivery, setDelivery] = useState(r.deliveryNumber),
    [orderNum, setOrderNum] = useState(r.supplierOrderNumber),
    [date, setDate] = useState(r.deliveryDate),
    [link, setLink] = useState(detail.document.packingSlip?.orderId ?? ""),
    [newSupplier, setNewSupplier] = useState(false),
    [name, setName] = useState(r.supplierName),
    [email, setEmail] = useState(r.supplierEmail ?? ""),
    [phone, setPhone] = useState(r.supplierPhone ?? ""),
    [accounted, setAccounted] = useState(r.documentChecked ?? false);
  return (
    <details
      open={!r.kindConfirmed || !r.orderConfirmed || !r.documentChecked}
      className="border-y py-3"
    >
      <summary className="cursor-pointer font-medium">
        {r.kindConfirmed && r.orderConfirmed && r.documentChecked
          ? "Order and slip details confirmed"
          : "Confirm order and slip details"}
      </summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Label name="Order in this job">
          <select
            className={field}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          >
            <option value="">Choose order</option>
            {[...detail.orders]
              .sort(
                (a, b) =>
                  Number(
                    detail.document.packingSlipAnalysis?.orderCandidates?.includes(
                      b.id,
                    ) ?? false,
                  ) -
                  Number(
                    detail.document.packingSlipAnalysis?.orderCandidates?.includes(
                      a.id,
                    ) ?? false,
                  ),
              )
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {detail.lists.find((l) => l.id === o.listId)?.name}
                  {detail.document.packingSlipAnalysis?.orderCandidates?.includes(
                    o.id,
                  )
                    ? " · Suggested match"
                    : ""}
                </option>
              ))}
          </select>
        </Label>
        <div className="self-end">
          <Button
            variant="outline"
            disabled={!link || link === detail.document.packingSlip?.orderId}
            onClick={() =>
              void run({ action: "link", orderId: link, confirmed: true })
            }
          >
            Link this order
          </Button>
        </div>
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
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={accounted}
            onChange={(e) => setAccounted(e.target.checked)}
          />
          All source pages and item lines are accounted for.
        </label>
        <div className="flex flex-wrap gap-2 self-end">
          <Button
            disabled={link !== (detail.document.packingSlip?.orderId ?? "")}
            onClick={() =>
              void run({
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
              })
            }
          >
            Confirm details
          </Button>
          {detail.canCreate && (
            <Button
              variant="ghost"
              onClick={() => setNewSupplier(!newSupplier)}
            >
              New supplier
            </Button>
          )}
        </div>
      </div>
      {newSupplier && (
        <div className="mt-4 grid gap-3 border-t pt-4">
          <p className="text-sm">
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
          <Button
            onClick={() => void run({ action: "supplier", name, email, phone })}
          >
            Approve new supplier
          </Button>
        </div>
      )}
    </details>
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
      <p className="text-muted-foreground text-sm">
        Duplicate reviewed:{" "}
        {detail.review.duplicateDecision?.action === "supporting"
          ? "supporting document, no receiving"
          : "explicit additional delivery or replacement"}
        .
      </p>
    );
  return (
    <section className="border-l-2 border-amber-500 pl-4">
      <h3 className="flex items-center gap-2 font-medium">
        <AlertTriangleIcon className="size-4" />
        Possible repeated slip
      </h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Review before receiving. A matching supplier order number alone is not a
        duplicate.
      </p>
      {unresolved.map((d) => (
        <div key={d.id} className="mt-3 text-sm">
          <Link className="underline" href={`?document=${d.id}`}>
            {d.name}
          </Link>
          <p>
            {d.reason}
            {d.received ? " It already has approved quantities." : ""}
          </p>
        </div>
      ))}
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
          className={`${field} mt-2`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
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
  detail,
  jobId,
  run,
}: {
  line: ReceivingLine;
  index: number;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(l.description),
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
  const status = l.ignored
    ? "Excluded"
    : l.approved
      ? changed(l, detail.review.kind)
        ? "Correction to review"
        : detail.review.sourceTrial && l.checked !== true
          ? "Previously approved · recheck"
          : "Approved"
      : approvable(l, detail.review.kind)
        ? "Ready to approve"
        : "Needs review";
  return (
    <article className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">
            Line {index + 1} · page {l.page}
          </p>
          <h3 className="mt-1 font-medium break-words">{l.description}</h3>
          {l.readingSource && (
            <p className="text-muted-foreground mt-1 text-xs" title="Confidence estimates are retained with the original reading; they are not measured accuracy or approval.">
              {l.readingSource.reader === "terra" ? "Terra assisted" : l.readingSource.reader === "jev" ? "Jev image reading" : "OCR reading"}
              {l.readingSource.confidence && ` · product ${Math.round(l.readingSource.confidence.part * 100)}% · quantity ${Math.round(l.readingSource.confidence.quantity * 100)}% confidence`}
            </p>
          )}
          <p className="text-muted-foreground mt-1 text-sm">
            {l.quantity ?? "Unclear"} {l.unit} · {l.sku || "No supplier code"}
            {l.orderItemId
              ? ` · ${detail.items.find((i) => i.id === l.orderItemId)?.description ?? "Order part"}`
              : " · No matched order part"}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium ${status === "Approved" ? "text-emerald-700 dark:text-emerald-300" : status === "Needs review" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}
        >
          {status}
        </span>
      </div>
      {l.ignored && (
        <p className="mt-2 text-sm">
          {l.ignored.reason}{" "}
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
        </p>
      )}
      {!l.ignored && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(!editing)}
            >
              {editing
                ? "Close details"
                : l.approved
                  ? "Correct / view"
                  : "Review line"}
            </Button>
            {!l.orderItemId && detail.canCreate && (
              <Button size="sm" variant="ghost" onClick={() => setPart(!part)}>
                Find or create part
              </Button>
            )}
            {l.partId &&
              !l.orderItemId &&
              detail.document.packingSlip &&
              detail.canCreate && (
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
          {editing && (
            <div className="mt-4 space-y-3">
              <p className="text-muted-foreground text-sm">{l.evidence}</p>
              {sourceBox && (
                <SlipLineImage
                  url={detail.sourceUrl}
                  page={l.page}
                  box={sourceBox}
                  label={`Source for line ${index + 1}`}
                />
              )}
              {l.issues.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-sm text-amber-800 dark:text-amber-300">
                  {l.issues.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
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
                <Label
                  name={`This ${(kind || detail.review.kind) === "delivery" ? "delivery" : "return"} quantity`}
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
                <Label name="Quantity unit">
                  <input
                    className={field}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="ea, ft, box…"
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
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I checked the product, quantity and unit against the source.
              </label>
              <Button
                onClick={() =>
                  void run({
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
                    checked,
                  })
                }
              >
                Save line review
              </Button>
              {(!l.approved || l.approved.quantity === 0) && (
                <details className="text-sm">
                  <summary className="cursor-pointer">
                    Exclude this line
                  </summary>
                  <p className="text-muted-foreground my-2">
                    For totals, duplicates, zero-delivery lines or items that
                    should not be received.
                  </p>
                  <input
                    aria-label="Reason for excluding line"
                    className={field}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason"
                  />
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    disabled={reason.trim().length < 3}
                    onClick={() =>
                      void run({ action: "ignore", lineId: l.id, reason })
                    }
                  >
                    Exclude with reason
                  </Button>
                </details>
              )}
            </div>
          )}
          {part && (
            <PartDraft line={l} detail={detail} jobId={jobId} run={run} />
          )}
        </>
      )}
      {l.ignored && (
        <p className="text-muted-foreground mt-1 text-sm">{l.ignored.reason}</p>
      )}
    </article>
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
    <section className="mt-4 space-y-3 border-l pl-4">
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
    <details className="border-y py-3">
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
