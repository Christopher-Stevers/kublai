"use client";
import { DeletePackingSlipButton } from "./DeletePackingSlipButton";
import { FileComparison } from "~/components/jobs/FileComparison";
import { slipBackorderCheck } from "~/lib/slip-backorder-check";
import { materialIssueLabels, materialMarkedForReturn } from "~/lib/receiving-resolution";
import {
  receivingDisplayUnit,
  receivingQuantity,
} from "~/lib/receiving-quantity-display";
import {
  ReceivingResolve,
  linkLineAction,
  type ResolveTarget,
} from "./ReceivingResolve";
import { useLongPressDrag, type DragPoint } from "~/hooks/use-long-press-drag";
import {
  receivedLineQuantity,
  pendingOrderResolutions,
  resolutionEvidenceFingerprint,
  resolutionCounterpartFingerprint,
  resolutionBlockers,
  receivingLineReady,
  newResolution,
} from "~/lib/receiving-resolution";
import { PartTileContent, PART_TILE_CARD_CLASS } from "./wizard/PartTileContent";
import { playConfirmWave } from "./confirm-wave";
import PartImage from "~/components/catalogue/PartImage";
import { OrderMatchCandidates } from "./OrderMatchCandidates";
import { OrderMatchPreview } from "./OrderMatchPreview";
import { PackingSlipActivity, type ProcessingJob } from "./PackingSlipActivity";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
  MessageSquareTextIcon,
  PlusIcon,
  Trash2Icon,
  UnlinkIcon,
  PencilIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ReceivingItemPreview } from "./ReceivingItemPreview";
import type { SlipBox } from "~/lib/packing-slip-review";
import { SlipLineImage } from "./SlipLineImage";
import { SlipProcessingProgress } from "./SlipProcessingProgress";
import type {
  ReceivingReview,
  ReceivingLine,
  ReceiptKind,
} from "~/lib/receiving-review";
import {
  receiptDelta,
  qtyRound,
  lineKind,
  convertedOrderedQuantity,
} from "~/lib/receiving-review";
import { dueWithHandCount, type ItemReceipts } from "~/lib/receipt-sources";
import {
  lineReadings,
  readSlipQuantity,
  receiptUnit,
  packSizesIn,
  slipHeader,
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
export type ReceivingDetail = {
  canDeleteDocument?: boolean;
  correctionUndo?: { requestId: string; label: string } | null;
  canAcceptSubstitution?: boolean;
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
    unavailable?: string | null;
  }>;
  /** Where each order item's received count came from. */
  receipts?: Record<string, ItemReceipts>;
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
  /** The order item a slip line the matcher missed is likely to be. */
  pairs?: Record<string, string>;
  photoSuggestions: Array<{
    id: string;
    displayName: string;
    imageUrl: string | null;
  }>;
  canCreate: boolean;
  /** The catalogue part behind each order item, for suggested part fixes. */
  orderParts?: Record<string, PartFacts>;
  canEditParts?: boolean;
  canRemoveOrderItems?: boolean;
  scannedBy: string;
  /** Names of the people who wrote line notes, by user id. */
  noteAuthors?: Record<string, string>;
  sourceUrl: string;
  sourceMimeType?: string;
};
type Detail = ReceivingDetail;
export type ReceivingAction = Record<string, unknown> & { action: string };
type Action = ReceivingAction;
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Please try again.";
const field =
  "border-input bg-background h-11 w-full min-w-0 rounded-md border px-3 text-base";
const card = "bg-card rounded-xl border";
const typeLabel = (k: ReceiptKind) =>
  k === "credit-only"
    ? "Credit only (no physical return)"
    : k === "delivery"
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
  receivedLineQuantity(l) !== l.approved?.quantity ||
  lineKind(l, k) !== l.approved.kind;
const approvable = receivingLineReady;
type LineStatus =
  | "review"
  | "recheck"
  | "correction"
  | "ready"
  | "approved"
  | "excluded";
const lineStatus = (
  l: ReceivingLine,
  r: ReceivingReview,
  item?: ReceiptOrderItem,
): LineStatus =>
  l.ignored
    ? "excluded"
    : l.approved
      ? changed(l, r.kind)
        ? "correction"
        : r.sourceTrial && l.checked !== true
          ? "recheck"
          : "approved"
      : approvable(l, r.kind, item, r.lines)
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
  const [docs, setDocs] = useState<Entry[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showAll, setShowAll] = useState(false),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    // The notice that offers Undo, such as a line moved by dragging.
    [undoNotice, setUndoNotice] = useState(""),
    [progress, setProgress] = useState(true),
    [preview, setPreview] = useState(false),
    [reason, setReason] = useState(""),
    [over, setOver] = useState(false),
    // Whether the parts counted by hand on the order are this slip's.
    [sameAsHand, setSameAsHand] = useState<boolean | null>(null),
    [accounted, setAccounted] = useState(false),
    [openLine, setOpenLine] = useState<string | null>(null),
    [lab, setLab] = useState(false),
    [changingOrder, setChangingOrder] = useState(false),
    [recheckingDuplicates, setRecheckingDuplicates] = useState(false),
    [showLines, setShowLines] = useState(false);
  const [comparisonDocument, setComparisonDocument] = useState<{ current: string; earlier: string } | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ResolveTarget | null>(
    null,
  );
  useEffect(() => { setComparisonDocument(null); }, [id]);
  // Back from a slip steps up to the queue, not out to the job.
  useHeaderBackOverride(
    comparisonDocument
      ? () => setComparisonDocument(null)
      : resolveTarget
      ? () => setResolveTarget(null)
      : id
        ? () => {
            const queue = `/jobs/${jobId}/receiving`;
            if (!online) window.location.href = queue;
            else router.replace(queue);
          }
        : null,
  );

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
    setResolveTarget(null);
    setChangingOrder(false);
    setRecheckingDuplicates(false);
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
    const t = setTimeout(
      () => setNotice(""),
      notice === undoNotice ? 6000 : 4000,
    );
    return () => clearTimeout(t);
  }, [notice, undoNotice]);
  useEffect(() => {
    // Open a line the reviewer just added so it can be filled in straight away.
    const before = added.current,
      fresh = before && detail?.review.lines.find((l) => !before.has(l.id));
    if (!fresh) return;
    added.current = null;
    setOpenLine(fresh.id);
    setResolveTarget((current) => (current ? { lineId: fresh.id } : current));
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
  const ready =
    r?.lines.filter((l) =>
      approvable(
        l,
        r.kind,
        detail?.items.find((i) => i.id === l.orderItemId),
        r.lines,
      ),
    ) ?? [];
  const remaining =
    (r?.lines.filter(
      (l) =>
        !l.ignored &&
        (changed(l, r.kind) || (!!r.sourceTrial && l.checked !== true) || (!!l.resolution?.materialIssue && resolutionBlockers(l, detail?.items.find(i => i.id === l.orderItemId), r.lines, r.kind).length > 0)),
    ).length ?? 0) + (r ? pendingOrderResolutions(r) : 0);
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
    !recheckingDuplicates &&
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
            : repeat || recheckingDuplicates
              ? "Finish the duplicate check first"
              : !r?.kindConfirmed || !r.orderConfirmed
                ? "Confirm the order first"
                : remaining - ready.length > 0
                  ? `${remaining - ready.length} still to review`
                  : ready.length
                    ? "Everything else is done"
                    : "Every line is approved or excluded";
  // Approval preview: running totals per order line, as the server applies
  // them, with or without the slip taking over counts made by hand.
  const plan = (linkHand: boolean) => {
    const totals = new Map<string, { received: number; credit: number }>(),
      hand = new Map<string, number>();
    return r
      ? ready.map((l) => {
          const id = l.orderItemId!,
            delta = receiptDelta(
              lineKind(l, r.kind),
              receivedLineQuantity(l)!,
              l.approved,
            ),
            item = detail?.items.find((i) => i.id === id),
            sum = totals.get(id) ?? {
              received: item?.received ?? 0,
              credit: 0,
            },
            before = sum.received;
          if (!hand.has(id)) hand.set(id, detail?.receipts?.[id]?.byHand ?? 0);
          const handBefore = l.approved?.fromHand ?? 0,
            canLink = l.approved
              ? 0
              : Math.max(0, Math.min(hand.get(id)!, delta.received)),
            fromHand = l.approved
              ? Math.min(
                  handBefore,
                  lineKind(l, r.kind) === "delivery"
                    ? receivedLineQuantity(l)!
                    : 0,
                )
              : linkHand
                ? canLink
                : 0;
          if (!l.approved) hand.set(id, qtyRound(hand.get(id)! - fromHand));
          const change = qtyRound(delta.received - fromHand + handBefore);
          sum.received = qtyRound(sum.received + change);
          sum.credit = qtyRound(sum.credit + delta.credit);
          totals.set(id, sum);
          const due = item ? qtyRound(item.ordered - sum.credit) : null;
          return {
            line: l,
            delta,
            change,
            fromHand: l.approved ? 0 : fromHand,
            canLink,
            before,
            after: sum.received,
            due,
            over:
              lineKind(l, r.kind) !== "credit-only" &&
              due !== null &&
              sum.received > due,
          };
        })
      : [];
  };
  const unlinked = plan(false),
    handLines = unlinked.filter((x) => x.canLink > 0),
    // A slip that would take a hand-counted item over what was ordered is
    // almost surely the same parts; otherwise the reviewer says which.
    linkHand =
      sameAsHand ??
      (handLines.some((x) => x.over) ? true : handLines.length ? null : false),
    approvals = linkHand ? plan(true) : unlinked;
  const waiting = docs.filter(
    (d) => d.status === "review" || d.status === "processing",
  ).length;
  // Suggested order matches first: confirming one is quick.
  const shown = docs
    .filter(
      (d) =>
        (showAll || d.status === "review" || d.status === "processing") &&
        `${d.name} ${d.order?.orderNumber ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) => Number(!!b.hasSuggestedOrder) - Number(!!a.hasSuggestedOrder),
    );
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const resolvingLine = detail?.review.lines.find(
    (l) => l.id === resolveTarget?.lineId,
  );
  const resolvingItem = detail?.items.find(
    (i) => i.id === (resolvingLine?.orderItemId ?? resolveTarget?.itemId),
  );
  const resolutionKey = [
    detail?.document.id,
    resolveTarget?.lineId ?? resolveTarget?.itemId,
    resolvingLine ? resolutionEvidenceFingerprint(resolvingLine) : "",
    resolvingItem ? resolutionCounterpartFingerprint(resolvingItem) : "",
  ].join(":");
  if (detail && comparisonDocument?.current === detail.document.id)
    return <main className="bg-background fixed inset-x-0 app-below-header bottom-0 z-30 flex min-h-0 flex-col" aria-label="Packing slip comparison">
      <FileComparison inline jobId={jobId} initialDocumentIds={[comparisonDocument.current, comparisonDocument.earlier]} onClose={() => setComparisonDocument(null)} />
    </main>;
  if (detail && resolveTarget)
    return (
      <main className="mx-auto w-full px-4 py-4">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-500/50 p-3 text-sm"
          >
            {error}
          </p>
        )}
        <ReceivingResolve
          key={resolutionKey}
          detail={detail}
          jobId={jobId}
          target={resolveTarget}
          busy={busy || !online || blocked}
          run={run}
          onReload={load}
          onAddLine={async (value) => {
            added.current = new Set(detail.review.lines.map((l) => l.id));
            const done = await run({
              action: "addLine",
              page: value.page,
              description: value.description,
              sourceBox: value.box,
            });
            if (!done) added.current = null;
            return done;
          }}
          onClose={() => setResolveTarget(null)}
          onSelect={setResolveTarget}
          renderCorrection={(line, onDone) => (
            <LineReview
              key={`${line.id}:${detail.review.revision}`}
              line={line}
              index={detail.review.lines.indexOf(line)}
              detail={detail}
              jobId={jobId}
              run={run}
              onDone={onDone}
              resolveMode
            />
          )}
        />
      </main>
    );
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 pb-32 sm:px-6">
      <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {id ? "Review Packing Slip" : "Receiving queue"}
          </h1>

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

        </div>
        {detail && (
          <p className="text-muted-foreground col-span-2 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-sm">
            <FileTextIcon className="size-4 shrink-0" />
            <Link
              href={slipViewerHref(jobId, detail)}
              title={detail.document.name}
              className="text-foreground min-w-0 truncate rounded-sm font-medium underline decoration-current/30 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {detail.document.name}
            </Link>
            <span className="shrink-0">
              · Received: {new Date(detail.document.createdAt).toLocaleDateString()}
            </span>
          </p>
        )}
      </header>
      {detail && (
        <PackingSlipActivity
          analysis={a}
          job={detail.processingJob}
          online={online}
          receivedAt={receivedAt}
        />
      )}
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
          className="bg-foreground text-background fixed bottom-24 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg"
        >
          <span className="min-w-0">{notice}</span>
          {notice === undoNotice && detail?.correctionUndo && (
            <button
              type="button"
              disabled={busy}
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                const undo = detail.correctionUndo;
                if (undo)
                  void run({
                    action: "undoCorrection",
                    requestIdToUndo: undo.requestId,
                    reason: "Reviewer undid a line move",
                  });
              }}
            >
              Undo
            </button>
          )}
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
          </div>
          <ul className="mb-20 divide-y border-y">
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
          <div className="bg-background fixed inset-x-0 bottom-0 z-30 pin-viewport-bottom border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <PriorityActionBar
              className="mx-auto max-w-[1600px]"
              search={{
                value: search,
                onChange: setSearch,
                label: "Search packing slips",
                placeholder: "Search slips",
              }}
            />
          </div>
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
                disabled={busy || !online || sourceChanged || !!r?.retiredBy || a?.status === "processing"}
                className="min-w-0 space-y-4 disabled:opacity-70"
              >
                <Step
                  n={1}
                  title="Duplicate Check"
                  state={
                    repeat || recheckingDuplicates ||
                    (a?.status === "processing" && !detail.duplicates.length)
                      ? "active"
                      : "done"
                  }
                  warn={repeat}
                  action={!repeat && !recheckingDuplicates && (
                    <Button variant="ghost" size="sm" onClick={() => {
                      setRecheckingDuplicates(true);
                      void load().catch((e: unknown) => setError(errorMessage(e)));
                    }}>Recheck</Button>
                  )}
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
                  {(repeat || recheckingDuplicates) && <DuplicateReview onCompare={earlier => setComparisonDocument({current:detail.document.id, earlier})} onDeleted={() => { setDetail(null); router.replace(`/jobs/${jobId}/receiving`); }} disabled={busy || !online} detail={detail} recheck={recheckingDuplicates} run={async action => {
                    const saved = await run(action);
                    if (saved) setRecheckingDuplicates(false);
                    return saved;
                  }} />}
                  {recheckingDuplicates && <div className="px-4 pb-4">
                    {!detail.duplicates.length && <p className="mb-3 text-sm text-muted-foreground">No possible duplicates found.</p>}
                    <Button variant="ghost" size="sm" onClick={() => setRecheckingDuplicates(false)}>Cancel</Button>
                  </div>}

                </Step>
              </fieldset>
              <fieldset disabled={busy || !online || blocked || recheckingDuplicates} className="min-w-0 space-y-4 disabled:opacity-70">
                <Step
                  n={2}
                  title="Match"
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
                        orderConfirmed
                          ? () => setChangingOrder(false)
                          : undefined
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
                    ) : null
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
                          active - remaining &&
                            `${active - remaining} approved`,
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
                            style={{
                              width: `${(ready.length / active) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                      {(detail.items.length > 0 || r.lines.length > 0) && (
                        <OrderComparison
                          actionError={error}
                          addBlocked={busy || blocked || !online}
                          detail={detail}
                          jobId={jobId}
                          run={run}
                          openRow={openLine}
                          setOpenRow={setOpenLine}
                          trial={trialResults}
                          onResolve={setResolveTarget}
                          notify={(text, undo) => {
                            setNotice(text);
                            setUndoNotice(undo ? text : "");
                          }}
                        />
                      )}
                      {r.lines.length === 0 && (
                        <div className="border-t px-4 py-8 text-center text-sm">
                          <p className="text-muted-foreground">
                            Read this slip to propose lines, or add a line from
                            the source.
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
              <section
                aria-label="Slip tools"
                className="space-y-4 rounded-lg border px-4 py-4 text-sm"
              >
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
                    Reading again or erasing detection keeps approved quantities
                    and saved review decisions.
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
                    setSameAsHand(null);
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
                  ({
                    line: l,
                    delta,
                    change,
                    fromHand,
                    before,
                    after,
                    due,
                    over: above,
                  }) => (
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
                            fromHand > 0 &&
                              `${fromHand} counted by hand, now on this slip`,
                            delta.credit !== 0 &&
                              `Credit ${signed(delta.credit)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">
                          {signed(change)}{" "}
                          <span className="text-muted-foreground text-xs font-normal">
                            {receivingDisplayUnit(l.unit)}
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
              {handLines.length > 0 && (
                <div
                  role="radiogroup"
                  aria-labelledby="hand-count-question"
                  className="space-y-2 rounded-lg border p-3 text-sm"
                >
                  <p id="hand-count-question" className="font-medium">
                    {handLines.length === 1
                      ? "1 line was already counted by hand on the order"
                      : `${handLines.length} lines were already counted by hand on the order`}
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="hand-count"
                      className="mt-0.5"
                      checked={linkHand === true}
                      onChange={() => setSameAsHand(true)}
                    />
                    Same parts. This slip takes over the hand count, so nothing
                    is added twice.
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="hand-count"
                      className="mt-0.5"
                      checked={linkHand === false}
                      onChange={() => setSameAsHand(false)}
                    />
                    A separate delivery. Add this slip on top.
                  </label>
                </div>
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
                  linkHand === null ||
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
                      fromHandCount: linkHand === true,
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
  const link = detail.document.packingSlip;
  const order = detail.orders.find((o) => o.id === link?.orderId);
  const listTitle = detail.lists.find((l) => l.id === (order?.listId ?? link?.materialListId))?.name
    ?? link?.materialListName;
  return [link?.orderNumber ?? "No order linked", listTitle]
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
    [newList, setNewList] = useState(false),
    [kind, setKind] = useState(r.kind),
    [supplierChoice, setSupplier] = useState<string | null>(null),
    [delivery, setDelivery] = useState(r.deliveryNumber),
    [orderNum, setOrderNum] = useState(r.supplierOrderNumber),
    [date, setDate] = useState(r.deliveryDate),
    [linkChoice, setLink] = useState<string | null>(null);
  // Background results can arrive after this form mounts. Follow fresh defaults
  // until the reviewer explicitly chooses a value; polling must not erase edits.
  const link = linkChoice ?? (linked || (match?.id ?? ""));
  const supplier = supplierChoice ?? r.supplierId ?? match?.supplierId ?? "";
  const readingKey = `${analysis?.runId}:${analysis?.status}:${analysis?.progress?.completed}:${analysis?.completedAt}`;
  const chooseOrder = (id: string) => {
    setLink(id);
    setForm(true);
    const order = detail.orders.find((o) => o.id === id);
    setSupplier(order?.supplierId ?? "");
  };
  const comparison = link ? (
    <OrderMatchPreview
      jobId={jobId}
      documentId={detail.document.id}
      orderId={link}
      readingKey={readingKey}
      sourceUrl={detail.sourceUrl}
    />
  ) : null;
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
  const candidates = (
    <OrderMatchCandidates
      jobId={jobId}
      documentId={detail.document.id}
      readingKey={readingKey}
      selectedId={link}
      onSelect={chooseOrder}
      onSure={matchSure}
      onNewList={() => { setForm(true); setNewList(true); }}
    />
  );
  const confirmButton = (
    <Button onClick={() => void confirm()}>
      <CheckIcon />I confirm this is the correct order
    </Button>
  );
  if (newList) return (
    <div className="space-y-3 p-4">
      {detail.canCreate && !detail.document.packingSlipAnalysis?.applied && !detail.review.lines.some((line) => line.approved) ?
        <Reconstruct detail={detail} run={run} newListOnly onCancel={() => setNewList(false)} /> :
        <p className="text-sm">{detail.canCreate ? "This slip already has approved receipts. Correct those receipts before moving it to a new list." : "A foreman, lead hand or executive must create a list from this slip."}</p>}
      {(!detail.canCreate || detail.document.packingSlipAnalysis?.applied || detail.review.lines.some((line) => line.approved)) && <Button variant="outline" onClick={() => setNewList(false)}>Cancel</Button>}
    </div>
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
          <p className="font-medium">
            Packing Slip Matched To &apos;{match.name ?? "Order"}&apos;
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
        <p className="mb-3 text-sm">
          No order matched this slip. Choose it here.
        </p>
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
                const candidates =
                  detail.document.packingSlipAnalysis?.orderCandidates ?? [];
                const rank = (id: string) =>
                  candidates.includes(id)
                    ? candidates.indexOf(id)
                    : Number.MAX_SAFE_INTEGER;
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
            <option value="credit-only">Credit only — no goods returned</option>
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
  onCompare,
  onDeleted,
  disabled,
  run,
  recheck = false,
}: {
  detail: Detail;
  onCompare: (documentId: string) => void;
  onDeleted: () => void;
  disabled: boolean;
  recheck?: boolean;
  run: (a: Action) => Promise<boolean>;
}) {
  const [other, setOther] = useState("");
  const unresolved = detail.duplicates.filter(
    (d) => recheck || !detail.review.duplicateChecked?.includes(d.key),
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
      {!earlier.unavailable && <Button variant="outline" onClick={() => onCompare(earlier.id)}>Compare files</Button>}
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
          {earlier.unavailable ? <span>{earlier.name}</span> : <Link className="underline" href={`?document=${earlier.id}`}>
            {earlier.name}
          </Link>}
        </p>
        <p className="text-muted-foreground mt-1">
          {earlier.reason}
          {earlier.received ? " It has already been received." : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {earlier.unavailable && <p role="alert">{earlier.unavailable}</p>}
        <Button disabled={disabled || !!earlier.unavailable} onClick={() => decide("supporting")}>
          Same slip, don’t receive
        </Button>
        <Button disabled={disabled || !!earlier.unavailable} variant="outline" onClick={() => decide("additional")}>
          Different delivery
        </Button>
        <Button disabled={disabled || !!earlier.unavailable} variant="ghost" onClick={() => decide("replace")}>
          Replace the earlier scan
        </Button>
        {detail.canDeleteDocument && <DeletePackingSlipButton jobId={detail.document.jobId} documentId={detail.document.id} name={detail.document.name} disabled={disabled} onDeleted={onDeleted} />}
      </div>
    </div>
  );
}
const percent = (v: number) => `${Math.round(v * 100)}%`;
/** The slip's column headings for a line on `page`, from this file's reading. */
function headerFor(detail: Detail, page: number) {
  const a = detail.document.packingSlipAnalysis;
  return a?.versionId === detail.review.versionId
    ? slipHeader(a.headers, page)
    : undefined;
}
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
  backordered?: number | null;
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
      ordered:
        r.reader === slipReader(source) ? (source.ordered ?? null) : null,
      backordered: r.reader === slipReader(source) ? source.backordered : null,
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
/** Where an order item's received count came from: each slip that received
 * it, and what was counted by hand on the order, which keeps no record of who
 * or when. */
function ReceivedFrom({
  item,
  receipts,
}: {
  item: ReceiptOrderItem;
  receipts: ItemReceipts | undefined;
}) {
  if (!receipts) return null;
  const amount = (n: number) => receivingQuantity(Math.abs(n), item.unit);
  return (
    <ul aria-label="Received from" className="text-muted-foreground mt-1">
      {receipts.byHand > 0 && (
        <li>{amount(receipts.byHand)} counted by hand on the order</li>
      )}
      {receipts.slips.map((r) => (
        <li key={r.documentId}>
          {amount(r.quantity)} {r.quantity < 0 ? "returned" : "received"} on{" "}
          {r.self ? (
            "this slip"
          ) : (
            <>
              <Link
                className="relative z-10 underline"
                href={`?document=${r.documentId}`}
              >
                {r.name}
              </Link>
              {` · ${r.by} · ${new Date(r.at).toLocaleDateString()}`}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The slip lines against one order item, in the order's unit. */
function compareToOrder(
  item: ReceiptOrderItem,
  lines: ReceivingLine[],
  byHand: number,
) {
  const live = lines.filter((l) => !l.ignored),
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
  if (pending.some((l) => receivedLineQuantity(l) === null))
    return { ok: false, label: "Quantity not read", text: amber.text };
  if (
    pending.some(
      (l) =>
        !!l.unit.trim() &&
        l.unit.trim().toLowerCase() !== item.unit.trim().toLowerCase(),
    )
  )
    return {
      ok: false,
      label: `Different unit. The order counts in ${item.unit}.`,
      text: amber.text,
    };
  return dueVerdict(
    item,
    pending.reduce((n, l) => n + (receivedLineQuantity(l) ?? 0), 0),
    byHand,
  );
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
  backorders = [],
}: {
  ordered: number | null;
  received: number | null;
  unit: string;
  backorders?: Array<{ backordered?: number | null; unit?: string | null }>;
}) {
  // Many dockets have no ordered column, so a blank there is not a misread.
  const shown = (n: number | null, blank: string) =>
    n === null ? (
      <span className="text-muted-foreground font-normal">{blank}</span>
    ) : (
      receivingQuantity(n, unit)
    );
  return (
    <dl className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-baseline gap-y-0.5 border-t pt-2 text-sm">
      <dt className="text-muted-foreground text-xs">Ordered</dt>
      <dd className="font-semibold tabular-nums">{shown(ordered, "—")}</dd>
      <dt className="text-muted-foreground text-xs">Received</dt>
      <dd className="font-semibold tabular-nums">
        {shown(received, "Not read")}
      </dd>
      {backorders.filter(check => check.backordered != null && Number.isFinite(check.backordered)).map((check, index) => (
        <Fragment key={index}>
          <dt className="text-muted-foreground text-xs">Backordered</dt>
          <dd className="font-semibold tabular-nums">{receivingQuantity(check.backordered!, check.unit ?? unit)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
type Verdict = { ok: boolean; label: string; text: string };
/** Whether a count, already in the order's unit, covers what is still due.
 * Parts counted by hand on the order may be the slip's own, so a count they
 * cover is not more than needed. */
function dueVerdict(
  item: ReceiptOrderItem,
  got: number,
  byHand: number,
): Verdict {
  let due = Math.max(0, qtyRound(item.ordered - item.received));
  got = qtyRound(got);
  if (got > due && byHand > 0) {
    due = dueWithHandCount(item, byHand, got).due;
    if (got <= due)
      return {
        ok: true,
        label: "Counted by hand already",
        text: "text-emerald-700 dark:text-emerald-300",
      };
  }
  return got === due
    ? {
        ok: true,
        label: "Matches the order",
        text: "text-emerald-700 dark:text-emerald-300",
      }
    : got < due
      ? {
          ok: false,
          label: `${receivingQuantity(qtyRound(due - got), item.unit)} short`,
          text: amber.text,
        }
      : {
          ok: false,
          label: `${receivingQuantity(qtyRound(got - due), item.unit)} more than needed`,
          text: amber.text,
        };
}
/** One reader's count against the order, read as packs or pieces as fits. */
function readingVerdict(
  item: ReceiptOrderItem,
  shipped: number | null,
  unit: string | null,
  text: string,
  byHand: number,
): Verdict {
  if (shipped === null)
    return { ok: false, label: "Quantity not read", text: amber.text };
  const read = readSlipQuantity(shipped, unit, item, text);
  if (read === null)
    return {
      ok: false,
      label: `Different unit. The order counts in ${item.unit}.`,
      text: amber.text,
    };
  const verdict = dueVerdict(item, read.amount, byHand);
  return read.amount === shipped
    ? verdict
    : {
        ...verdict,
        label: `= ${receivingQuantity(read.amount, item.unit)} · ${verdict.label}`,
      };
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
  reviewStatus?: "Confirmed" | "Edited";
  backorderChecks?: Array<NonNullable<ReturnType<typeof slipBackorderCheck>> & {backordered?: number | null; unit?: string | null}>;
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
  byHand,
  lines,
  live,
  readings,
  trialReadings,
  detail,
  trial,
}: {
  item: ReceiptOrderItem | undefined;
  /** What the order has counted by hand, not from any slip. */
  byHand: number;
  lines: ReceivingLine[];
  live: ReceivingLine[];
  readings: Array<ModelReading & { line: ReceivingLine }>;
  trialReadings: Array<{ reader: TrialReader; t: TrialLine }>;
  detail: Detail;
  trial: TrialResults | null;
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
    const reviewStatus =
      label === "Confirmed" || label === "Edited" ? label : undefined;
    const origins = [
      ...new Set(
        shown.flatMap((line) => {
          const reader =
            line.predictionSource?.reader ?? line.readingSource?.reader;
          return reader ? [readerLabels[reader]] : [];
        }),
      ),
    ];
    return {
      key: label,
      label: reviewStatus
        ? origins.length
          ? origins.join(" + ")
          : "Manual review"
        : label,
      reviewStatus,
      backorderChecks: shown.flatMap((line) => {
        const prediction = line.predictionSource;
        const analyzed = sourceLine(line, detail);
        const source = prediction
          ? trial?.[prediction.reader]?.lines.find((t) => t.lineId === prediction.lineId)
          : analyzed && (!line.readingSource || line.readingSource.reader === slipReader(analyzed)) ? analyzed : undefined;
        const check = slipBackorderCheck(source ?? {
          ordered: line.paper?.ordered ?? line.ordered,
          shipped: line.paper?.quantity ?? line.quantity,
          unit: line.paper?.unit ?? line.unit,
        });
        return check ? [{...check, backordered: source?.backordered, unit: source?.unit ?? line.unit}] : [];
      }),
      score: null,
      description: describe(shown.map((l) => l.description)),
      ordered: sum(shown.map((l) => l.ordered)),
      shipped: sum(shown.map((l) => receivedLineQuantity(l))),
      unit: shown[0]!.unit,
      verdict: item ? compareToOrder(item, lines, byHand) : null,
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
    backordered?: number | null,
  ) => {
    const check = slipBackorderCheck({ ordered, shipped, backordered, unit });
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
      if (check) copy.backorderChecks?.push({...check, backordered, unit});
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
      backorderChecks: check ? [{...check, backordered, unit}] : [],
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
      x.backordered,
    );
  for (const { reader, t } of trialReadings)
    add(
      reader,
      t.ordered,
      t.shipped,
      t.unit,
      meanScore(t.confidence.match.value, t.confidence.quantity.value),
      t.description,
      t.backordered,
    );
  const ranked: ReaderCopy[] = [...byReader.values()]
    .map(({ texts, ...copy }) => {
      const description = describe(texts);
      return {
        ...copy,
        description,
        verdict: item
          ? readingVerdict(item, copy.shipped, copy.unit, description, byHand)
          : null,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (!live.length) return [review("Slip"), ...ranked];
  if (live.every((l) => l.checked)) return [review("Confirmed"), ...ranked];
  if (live.some((l) => l.humanEdited)) return [review("Edited"), ...ranked];
  if (!ranked.length) return [review("Slip")];
  // Once received, the top copy says so rather than re-judging the count.
  if (live.every((l) => l.approved) && item)
    ranked[0] = {
      ...ranked[0]!,
      verdict: compareToOrder(item, lines, byHand),
    };
  const active = review("Active saved reading");
  return [active, ...ranked];
}
/** The element that scrolls the comparison, for scrolling while dragging. */
function scrollParent(node: HTMLElement | null) {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (/auto|scroll/.test(overflowY) && el.scrollHeight > el.clientHeight)
      return el;
  }
  return null;
}
/** The row under a dragged half, if it accepts the drop: an order item for a
 * slip line, or a slip line for an order item. */
const dropTarget = (at: DragPoint) =>
  document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-drop]")
    ?.dataset.drop ?? null;
// Once lifted, this far moved is a drag; less, and letting go opens the menu.
const DRAG_FROM = 8;

// Each comparison card is one ticket torn down a zigzag. The halves are
// masked to either side of the same teeth, and the seam draws them at rest.
const tooth = (path: string, paint = "") =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='8' height='16'><path d='${path}' ${paint}/></svg>`)}")`;
const maskStyle = (
  image: string,
  size: string,
  position: string,
  repeat: string,
): CSSProperties => ({
  maskImage: image,
  WebkitMaskImage: image,
  maskSize: size,
  WebkitMaskSize: size,
  maskPosition: position,
  WebkitMaskPosition: position,
  maskRepeat: repeat,
  WebkitMaskRepeat: repeat,
});
const solid = "linear-gradient(#000,#000)";
const tear = {
  order: maskStyle(
    `${solid}, ${tooth("M0 0L8 8L0 16Z")}`,
    "calc(100% - 7px) 100%, 8px 16px",
    "left top, right top",
    "no-repeat, repeat-y",
  ),
  slip: maskStyle(
    `${solid}, ${tooth("M0 0H8V16H0L8 8Z")}`,
    "calc(100% - 7px) 100%, 8px 16px",
    "right top, left top",
    "no-repeat, repeat-y",
  ),
  seam: maskStyle(
    tooth("M-1 -1L8 8L-1 17", "fill='none' stroke='#000' stroke-width='1.25'"),
    "8px 16px",
    "left top",
    "repeat-y",
  ),
};
/** A card half's paper: one torn edge, and slightly red when it is empty. */
function TornPaper({
  side,
  empty,
  needsConfirmation = false,
  markedForReturn = false,
}: {
  side: "order" | "slip";
  empty: boolean;
  needsConfirmation?: boolean;
  markedForReturn?: boolean;
}) {
  const paper = needsConfirmation ? "border-yellow-200/60 bg-yellow-50 dark:border-yellow-900/50 dark:bg-[#25251b]" : empty ? "border-red-500/30 bg-red-50 dark:bg-red-950" : "bg-zinc-100 dark:bg-zinc-800";
  const corners = side === "order" ? "rounded-l-xl" : "rounded-r-xl";
  return markedForReturn ? (
    <span
      role="img"
      aria-label="Material marked for return"
      data-return-caution={side}
      style={{...tear[side], backgroundImage: "repeating-linear-gradient(135deg, #facc15 0px, #facc15 7px, #171717 7px, #171717 14px)"}}
      className={`pointer-events-none absolute inset-0 -z-10 ${corners}`}
    >
      <span style={{...tear[side], maskPosition: side === "order" ? "left top, right -3px" : "right top, left -3px", WebkitMaskPosition: side === "order" ? "left top, right -3px" : "right top, left -3px"}} className={`absolute inset-[3px] ${corners} ${paper}`} />
    </span>
  ) : (
    <span aria-hidden style={tear[side]} className={`pointer-events-none absolute inset-0 -z-10 border-y ${corners} ${side === "order" ? "border-l" : "border-r"} ${paper}`} />
  );
}

const NOT_AN_ITEM_REASON = "This is not an item";

/** Step 3: every order item beside what the slip says arrived for it. */
function OrderComparison({
  actionError,
  addBlocked,
  detail,
  jobId,
  run,
  openRow,
  setOpenRow,
  trial,
  onResolve,
  notify,
}: {
  actionError: string;
  addBlocked: boolean;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  openRow: string | null;
  setOpenRow: (row: string | null) => void;
  trial: TrialResults | null;
  onResolve: (target: ResolveTarget) => void;
  notify: (text: string, undo?: boolean) => void;
}) {
  // One toggle for every row: opening the other readers on one opens them all.
  const [showOthers, setShowOthers] = useState(false);
  const modifying = useRef(false);
  const [notItem, setNotItem] = useState<{ ids: string[]; selected: string } | null>(null);
  const [removingDetection, setRemovingDetection] = useState(false);
  const removingDetectionRef = useRef(false);
  const [removeDetectionFailed, setRemoveDetectionFailed] = useState(false);
  const detectedLine = detail.review.lines.find(line => line.id === notItem?.selected);
  const removeDetection = async () => {
    if (!detectedLine || detectedLine.ignored || (detectedLine.approved?.quantity ?? 0) !== 0 ||
        addBlocked || removingDetectionRef.current || detail.review.versionId !== detail.document.currentVersionId) return;
    removingDetectionRef.current = true;
    setRemovingDetection(true);
    setRemoveDetectionFailed(false);
    try {
      if (await run({action: "ignore", lineId: detectedLine.id, reason: NOT_AN_ITEM_REASON})) {
        setNotItem(null);
        notify("Removed from detected items.", true);
      } else setRemoveDetectionFailed(true);
    } finally {
      removingDetectionRef.current = false;
      setRemovingDetection(false);
    }
  };
  const [addLineId, setAddLineId] = useState<string | null>(null);
  const [addingPart, setAddingPart] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const addingPartRef = useRef(false);
  const addLine = detail.review.lines.find(line => line.id === addLineId);
  const canAddLine = !!addLine && !addLine.orderItemId && !addLine.approved &&
    !addLine.ignored && detail.canCreate && !!detail.document.packingSlip &&
    detail.review.versionId === detail.document.currentVersionId;
  const addFromSlip = async (action: Action) => {
    if (!canAddLine || addBlocked || addingPartRef.current) return false;
    addingPartRef.current = true;
    setAddingPart(true);
    setAddFailed(false);
    try {
      const saved = await run(action);
      if (saved) {
        setAddLineId(null);
        notify("Part added to the material list. Review the delivery before approval.");
      }
      setAddFailed(!saved);
      return saved;
    } finally {
      addingPartRef.current = false;
      setAddingPart(false);
    }
  };
  const [removeItem, setRemoveItem] = useState<ReceiptOrderItem | null>(null);
  const [removing, setRemoving] = useState(false);
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
  const [materialIssue, setMaterialIssue] = useState<{ kind: "mismatch" | "supplier"; lineIds: string[]; selected: string } | null>(null);
  const [savingIssue, setSavingIssue] = useState(false);
  const saveMaterialIssue = async (choice: keyof typeof materialIssueLabels) => {
    const line = detail.review.lines.find(l => l.id === materialIssue?.selected);
    if (!line || savingIssue) return;
    const item = detail.items.find(i => i.id === line.orderItemId);
    setSavingIssue(true);
    try {
      if (await run({ action: "resolve", lineId: line.id,
        evidenceFingerprint: resolutionEvidenceFingerprint(line),
        counterpartFingerprint: item ? resolutionCounterpartFingerprint(item) : null,
        materialIssue: choice, match: "unresolved", quantity: "unresolved",
        specification: choice === "supplier-return" ? "substitution-rejected" : "unresolved",
        delivery: "wrong", skipped: false,
      })) {
        setMaterialIssue(null);
        notify("Material issue recorded. Review the line before approval.");
        onResolve({ lineId: line.id, itemId: item?.id });
      }
    } finally { setSavingIssue(false); }
  };
  const r = detail.review,
    slip = r.lines.map((line, index) => ({ line, index })).filter(({line}) => line.ignored?.reason !== NOT_AN_ITEM_REASON);
  const known = new Set(detail.items.map((i) => i.id));
  // Long press either half of a card to lift it and see its options. Drag it
  // to pair it with the other half of another card: a slip line onto an
  // order item, or an order item onto a slip line. A row that only held a
  // likely part goes with its line.
  const pressDrag = useLongPressDrag();
  type Grab = {
    key: string;
    start: DragPoint;
    at: DragPoint;
    moving: boolean;
    over: string | null;
  } & (
    | { side: "slip"; line: ReceivingLine | null }
    | { side: "order"; item: ReceiptOrderItem }
  );
  const [drag, setDrag] = useState<Grab | null>(null);
  // Accept: the row whose confirmation is playing.
  // Rows confirmed here keep their place until the next visit, so a card
  // never jumps away from under its new check.
  const [cheer, setCheer] = useState<{
    key: string;
    badge: string;
    label: string;
    tint: { order: boolean; slip: boolean };
    covered: boolean;
    burst: boolean;
  } | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [asking, setAsking] = useState<{
    fit: PartFit;
    item: ReceiptOrderItem;
    unit: string;
    go: (fit?: PartUpdate) => void;
  } | null>(null);
  const stopCheer = useRef<(() => void) | null>(null);
  useEffect(() => () => stopCheer.current?.(), []);
  const [menu, setMenu] = useState<{
    key: string;
    side: "order" | "slip";
  } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const draggedHalf = useRef<{ node: HTMLElement; left: number; top: number } | null>(null);
  const positionHalf = useCallback((at: DragPoint, start: DragPoint) => {
    const held = draggedHalf.current;
    if (!held) return;
    // Keep the original grid layout, including subgrid row heights. Translate
    // the real half and compensate for scrolling while the pointer is held.
    held.node.style.translate = "0px 0px";
    held.node.style.transform = "none";
    const origin = held.node.getBoundingClientRect();
    held.node.style.transform = `translate(${held.left + at.x - start.x - origin.left}px, ${held.top + at.y - start.y - origin.top}px)`;
  }, []);
  const pointer = useRef<DragPoint | null>(null);
  // The press handlers read the grab as it is now, not as last rendered.
  const grabbed = useRef<Grab | null>(null);
  const setGrab = (next: Grab | null) => {
    if (!next && draggedHalf.current) {
      draggedHalf.current.node.style.removeProperty("transform");
      draggedHalf.current.node.style.removeProperty("translate");
      draggedHalf.current = null;
    }
    grabbed.current = next;
    setDrag(next);
  };
  const dragging = !!drag?.moving;
  useEffect(() => {
    if (!dragging) return;
    // Near the top or bottom of the screen, scroll to reach other rows.
    const scroller = scrollParent(list.current);
    let frame = 0;
    const tick = () => {
      const at = pointer.current;
      if (at) {
        const box = scroller?.getBoundingClientRect() ?? {
          top: 0,
          bottom: window.innerHeight,
        };
        const zone = 140,
          up = box.top + zone - at.y,
          down = at.y - (box.bottom - zone);
        const speed =
          up > 0
            ? -Math.min(1, up / zone)
            : down > 0
              ? Math.min(1, down / zone)
              : 0;
        if (speed) {
          const by = Math.round(speed * 14);
          if (scroller) scroller.scrollBy(0, by);
          else window.scrollBy(0, by);
          if (grabbed.current) positionHalf(at, grabbed.current.start);
          const over = dropTarget(at),
            d = grabbed.current;
          if (d && d.over !== over) {
            grabbed.current = { ...d, over, at };
            setDrag(grabbed.current);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, positionHalf]);
  const sourceChanged = r.versionId !== detail.document.currentVersionId;
  const moveLine = async (line: ReceivingLine, itemId: string) => {
    const target = detail.items.find((i) => i.id === itemId);
    if (!target) return;
    const action = linkLineAction(line, itemId, detail.items);
    if (!action)
      return notify(
        "Units differ. Use Resolve to link it and confirm the count.",
      );
    if (await run(action)) notify(`Moved to ${target.description}.`, true);
  };
  const lineIds = new Map(r.lines.map((line) => [line.id, line]));
  const dropOn = (grab: Grab, over: string) => {
    if (grab.side === "slip") {
      if (grab.line) void moveLine(grab.line, over);
    } else {
      const line = lineIds.get(over);
      if (line) void pairItem(grab.item, line);
    }
  };
  // An order item dragged onto a slip line leaves the lines it was paired
  // with, unless they are already approved.
  const pairItem = async (item: ReceiptOrderItem, line: ReceivingLine) => {
    const link = linkLineAction(line, item.id, detail.items);
    if (!link)
      return notify(
        "Units differ. Use Resolve to link it and confirm the count.",
      );
    const left = r.lines.filter(
      (l) =>
        l.orderItemId === item.id &&
        l.id !== line.id &&
        !l.ignored &&
        !l.approved,
    );
    if (!(await run(link))) return;
    if (!left.length) return notify(`Moved to ${item.description}.`, true);
    for (const l of left) {
      const unpair = linkLineAction(l, null, detail.items);
      if (!unpair || !(await run(unpair)))
        return notify(
          `Paired with ${line.description}, but ${l.description} is still paired too.`,
        );
    }
    // Undo only reaches the last change, so it isn't offered here.
    notify(
      `Paired with ${line.description}. ${left.map((l) => l.description).join(", ")} unpaired.`,
    );
  };
  const rows = [
    ...detail.items.map((item, n) => ({
      key: `item:${item.id}`,
      n,
      item,
      lines: slip.filter(
        (x) =>
          x.line.orderItemId === item.id ||
          (!x.line.orderItemId && detail.pairs?.[x.line.id] === item.id),
      ),
    })),
    ...slip
      .filter(
        (x) =>
          !(x.line.orderItemId
            ? known.has(x.line.orderItemId)
            : known.has(detail.pairs?.[x.line.id] ?? "")),
      )
      .map((x, i) => ({
        key: x.line.id,
        n: detail.items.length + i,
        item: undefined,
        lines: [x],
      })),
  ];
  const rowComplete = ({ item, lines }: Pick<(typeof rows)[number], "item" | "lines">) => {
    const live = lines.filter(x => !x.line.ignored);
    if (live.some(({line}) => line.resolution?.materialIssue && resolutionBlockers(line, item, r.lines, r.kind).length > 0)) return false;
    const status = lines.map(x => lineStatus(x.line, r, item)).sort((x, y) => statusOrder.indexOf(x) - statusOrder.indexOf(y))[0];
    const byHand = item ? (detail.receipts?.[item.id]?.byHand ?? 0) : 0;
    const resolved =
      !!item &&
      live.length > 0 &&
      live.every(
        ({ line }) =>
          line.checked === true &&
          resolutionBlockers(line, item, r.lines, r.kind).length === 0,
      ) &&
      compareToOrder(
        item,
        live.map(({ line }) => line),
        byHand,
      )?.ok === true &&
      status !== "correction";
    const disposition = item ? r.orderResolutions?.[item.id] : undefined;
    const complete =
      resolved ||
      status === "approved" ||
      (!live.length &&
        !!disposition &&
        ["outstanding", "backordered"].includes(disposition.disposition));
    return complete;
  };
  // Keep source order within each group, but always bring unfinished work first.
  const finished = (row: (typeof rows)[number]) =>
    rowComplete(row) && !kept.has(row.key);
  rows.sort((a, b) => Number(finished(a)) - Number(finished(b)) || a.n - b.n);
  // What Accept saves for a row: each slip line
  // linked to the order item and confirmed as read, or an order item no slip
  // line covers marked still due. Null unless that alone settles the row, so
  // a short count or an open decision still goes through Resolve.
  type Plan = {
    actions: Action[];
    fit?: { fit: PartFit; unit: string; index: number };
    label?: string;
    message?: string;
  };
  const confirmPlan = (
    item: ReceiptOrderItem | undefined,
    lines: Array<{ line: ReceivingLine }>,
    byHand: number,
  ): Plan | null => {
    if (!item || sourceChanged) return null;
    const live = lines.map((x) => x.line).filter((l) => !l.ignored);
    if (!live.length)
      return qtyRound(item.ordered - item.received) > 0 &&
        (!r.orderResolutions?.[item.id] || r.orderResolutions[item.id]?.disposition === "unresolved")
        ? {
            actions: [
              {
                action: "orderDisposition",
                itemId: item.id,
                disposition: "outstanding",
                note: "",
              },
            ],
          }
        : null;
    // A correction, or a material issue or return recorded in Resolve, is
    // settled there.
    if (
      live.some(
        (l) =>
          lineStatus(l, r, item) === "correction" ||
          !!l.resolution?.materialIssue ||
          materialMarkedForReturn(l, r.kind),
      )
    )
      return null;
    const actions: Action[] = [];
    const fits: NonNullable<Plan["fit"]>[] = [];
    const after = new Map<string, ReceivingLine>();
    for (const l of live) {
      if (l.approved) continue;
      if (
        l.orderItemId !== item.id &&
        (l.orderItemId || detail.pairs?.[l.id] !== item.id)
      )
        return null;
      let next = l;
      if (l.orderItemId !== item.id || l.checked !== true) {
        // Linked and confirmed as read, as "Looks right" saves it.
        const link = linkLineAction(l, item.id, detail.items);
        if (!link) return null;
        const fit = partFit(
          item,
          {
            quantity: l.quantity,
            read: l.quantity,
            unit: l.unit,
            description: l.description,
            sku: l.sku,
            evidence: l.evidence,
          },
          detail.orderParts?.[item.id],
          {
            byHand: l.orderItemId !== item.id,
            canEdit: !!detail.canEditParts,
          },
        );
        // Counted in packs: "Looks right" asks how to read it first.
        if (fit && fit.read !== null) return null;
        if (fit?.rows.length)
          fits.push({ fit, unit: l.unit, index: actions.length });
        actions.push({ ...link, checked: true });
        next = {
          ...l,
          orderItemId: item.id,
          quantity: link.quantity as number | null,
          ordered: link.ordered as number | null,
          unit: link.unit as string,
          checked: true,
        };
        if (
          next.resolution &&
          resolutionEvidenceFingerprint(next) !==
            resolutionEvidenceFingerprint(l)
        )
          next = {
            ...next,
            checked: false,
            resolution: {
              ...newResolution(next, "", ""),
              note: next.resolution.note,
            },
          };
      }
      // A line already in Resolve: confirm the checks still open, and keep
      // every decision already recorded.
      const was = next.resolution;
      if (was) {
        const evidence = resolutionEvidenceFingerprint(next),
          counterpart = resolutionCounterpartFingerprint(item);
        const base =
          was.evidenceFingerprint === evidence &&
          was.counterpartFingerprint === counterpart
            ? was
            : newResolution(next, "", "");
        const open = {
          ...(base.match !== "confirmed" && { match: "confirmed" as const }),
          ...(base.specification === "unresolved" && {
            specification: "confirmed" as const,
          }),
          ...(base.quantity !== "confirmed" && {
            quantity: "confirmed" as const,
          }),
          ...(base.delivery === "unresolved" && {
            delivery: "confirmed" as const,
          }),
        };
        if (Object.keys(open).length || base.skipped || base !== was) {
          actions.push({
            action: "resolve",
            lineId: l.id,
            evidenceFingerprint: evidence,
            counterpartFingerprint: counterpart,
            ...open,
            skipped: false,
          });
          next = {
            ...next,
            resolution: {
              ...base,
              ...open,
              skipped: false,
              evidenceFingerprint: evidence,
              counterpartFingerprint: counterpart,
            },
          };
          next = { ...next, checked: resolutionBlockers(next).length === 0 };
        }
      }
      after.set(l.id, next);
    }
    if (!actions.length) return null;
    const all = r.lines.map((l) => after.get(l.id) ?? l),
      settled = live.map((l) => after.get(l.id) ?? l);
    return settled.every(
      (l) =>
        l.checked === true &&
        resolutionBlockers(l, item, all, r.kind).length === 0,
    ) && compareToOrder(item, settled, byHand)?.ok === true
      ? { actions, fit: fits.length === 1 ? fits[0] : undefined }
      : null;
  };
  const confirmRow = (
    key: string,
    item: ReceiptOrderItem,
    plan: Plan,
    badge: string,
    tint: { order: boolean; slip: boolean },
    from: HTMLElement,
  ) => {
    if (cheer) return;
    const row = from.closest("li");
    const go = (fit?: PartUpdate) => {
      setAsking(null);
      const actions = plan.actions.map((a, i) =>
        fit && Object.keys(fit).length && i === plan.fit?.index
          ? { ...a, fit }
          : a,
      );
      // The circle must be in view for its burst.
      const circle = row?.querySelector<HTMLElement>("[data-comparison-state]");
      const top = circle?.getBoundingClientRect().top ?? 200;
      if (top < 96) {
        const by = { top: top - 120, behavior: "smooth" as const };
        const scroller = scrollParent(list.current);
        if (scroller) scroller.scrollBy(by);
        else window.scrollBy(by);
      }
      const saved = (async () => {
        for (const action of actions) if (!(await run(action))) return false;
        return true;
      })();
      setKept((k) => new Set(k).add(key));
      const label = plan.label ?? "Accept";
      setCheer({ key, badge, label, tint, covered: false, burst: false });
      stopCheer.current = playConfirmWave({
        targets: () => {
          const button = row?.querySelector<HTMLElement>(
              "[data-confirm-button]",
            ),
            card = row?.querySelector<HTMLElement>("[data-confirm-card]"),
            circle = row?.querySelector<HTMLElement>("[data-comparison-state]");
          return row?.isConnected && button && card && circle
            ? { button, card, circle }
            : null;
        },
        saved,
        onCovered: () => setCheer((c) => c && { ...c, covered: true }),
        onBurst: () => setCheer((c) => c && { ...c, burst: true }),
        onDone: (ok) => {
          stopCheer.current = null;
          setCheer(null);
          if (!ok)
            setKept((k) => {
              const next = new Set(k);
              next.delete(key);
              return next;
            });
          else
            notify(
              plan.message ?? "Information confirmed. Ready for final approval.",
              actions.length === 1,
            );
        },
      });
    };
    if (plan.fit)
      setAsking({ fit: plan.fit.fit, unit: plan.fit.unit, item, go });
    else go();
  };
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
      <Dialog open={!!notItem} onOpenChange={open => { if (!open && !removingDetection) setNotItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This is not an item?</DialogTitle>
            <DialogDescription>Remove this detected line from the packing slip review? The original slip, order items and received quantities stay unchanged.</DialogDescription>
          </DialogHeader>
          {notItem && notItem.ids.length > 1 && <select aria-label="Detected line to remove" className={field} disabled={removingDetection} value={notItem.selected} onChange={event => setNotItem({...notItem, selected:event.target.value})}>
            {notItem.ids.map(id => <option key={id} value={id}>{detail.review.lines.find(line => line.id === id)?.description}</option>)}
          </select>}
          <p className="break-words font-medium">{detectedLine?.description}</p>
          {removeDetectionFailed && <p role="alert" className="text-sm text-destructive">{actionError || "Could not remove this line. Try again."}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={removingDetection} onClick={() => setNotItem(null)}>Cancel</Button>
            <Button variant="destructive" disabled={addBlocked || removingDetection || !detectedLine || !!detectedLine.ignored || (detectedLine.approved?.quantity ?? 0) !== 0} onClick={() => void removeDetection()}>{removingDetection ? "Removing…" : "Remove item"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!addLineId && canAddLine} onOpenChange={open => { if (!open && !addingPart) setAddLineId(null); }}>
        <DialogContent className="max-h-[85dvh] max-w-full overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader className="pr-6">
            <DialogTitle>Add this part to material list</DialogTitle>
            <DialogDescription>{addLine?.description}</DialogDescription>
          </DialogHeader>
          {addLine && canAddLine && <fieldset disabled={addingPart || addBlocked} aria-busy={addingPart} className="min-w-0">
            <AddToList key={addLine.id} line={addLine} detail={detail} jobId={jobId} run={addFromSlip} cards
              onReviewQuantity={() => { setAddLineId(null); setOpenRow(rows.find(row => row.lines.some(x => x.line.id === addLine.id))?.key ?? addLine.id); }} />
            {addFailed && <p role="alert" className="mt-3 text-sm text-destructive">{actionError || "Could not add the part. Check your connection and try again."}</p>}
            {addingPart && <p role="status" className="mt-3 text-sm">Adding part…</p>}
          </fieldset>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!materialIssue} onOpenChange={open => { if (!open && !savingIssue) setMaterialIssue(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{materialIssue?.kind === "supplier" ? "Supplier Entered This Incorrectly" : "Shipped Material Doesn’t Match Slip"}</DialogTitle>
            <DialogDescription>{materialIssue?.kind === "supplier" ? "What should happen to the material?" : "Record the mismatch, then review what was actually delivered."}</DialogDescription>
          </DialogHeader>
          {materialIssue && materialIssue.lineIds.length > 1 && <select aria-label="Affected slip line" className={field} value={materialIssue.selected} onChange={e => setMaterialIssue({...materialIssue, selected:e.target.value})}>
            {materialIssue.lineIds.map(id => <option key={id} value={id}>{detail.review.lines.find(l => l.id === id)?.description}</option>)}
          </select>}
          <div className="flex flex-col gap-3">
            {materialIssue?.kind === "supplier" ? <>
              <Button disabled={savingIssue} onClick={() => void saveMaterialIssue("supplier-keep")}>Keep material anyway?</Button>
              <Button variant="outline" disabled={savingIssue} onClick={() => void saveMaterialIssue("supplier-return")}>Material needs to be returned.</Button>
            </> : <Button disabled={savingIssue} onClick={() => void saveMaterialIssue("shipped-mismatch")}>Record mismatch</Button>}
            <Button variant="ghost" disabled={savingIssue} onClick={() => setMaterialIssue(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removeItem}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove item from order?</DialogTitle>
            <DialogDescription>
              {removeItem?.description} will be removed from this order,
              including its outstanding quantity. This does not record a
              delivery or delete the catalogue part or material-list entry. An
              item missing from a slip may still be on backorder.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={removing}
              onClick={() => setRemoveItem(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={async () => {
                if (!removeItem) return;
                setRemoving(true);
                try {
                  if (
                    await run({
                      action: "removeOrderItem",
                      itemId: removeItem.id,
                      fingerprint: detail.fingerprint,
                      confirmed: true,
                    })
                  )
                    setRemoveItem(null);
                } finally {
                  setRemoving(false);
                }
              }}
            >
              Remove from order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ul ref={list}>
        {rows.map(({ key, n, item, lines }) => {
          const open = openRow === key,
            live = lines.filter((x) => !x.line.ignored),
            status = lines
              .map((x) => lineStatus(x.line, r, item))
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
            likely = item ? null : likelyName(detail, lines);
          const byHand = item ? (detail.receipts?.[item.id]?.byHand ?? 0) : 0;
          const copies = readerCopies({
            item,
            byHand,
            lines: lines.map((x) => x.line),
            live: live.map((x) => x.line),
            readings,
            trialReadings,
            detail,
            trial,
          });
          const disposition = item ? r.orderResolutions?.[item.id] : undefined;
          const complete = rowComplete({ item, lines });
          // While its confirmation plays, a row keeps its old circle until
          // the burst shows the check.
          const mine = cheer?.key === key ? cheer : null;
          const done = mine ? mine.burst : complete;
          const linkPlan =
            complete || mine || cheer ? null : confirmPlan(item, lines, byHand);
          const orderNeedsNow = !complete && (
            !item || !live.length || live.some(({ line }) =>
              !line.orderItemId || (line.resolution && (
                line.resolution.match !== "confirmed" ||
                line.resolution.specification === "unresolved" ||
                (!!item && line.resolution.counterpartFingerprint !== resolutionCounterpartFingerprint(item))
              )))
          );
          const slipNeedsNow = !complete && (
            !live.length || live.some(({ line }) =>
              (!line.approved || status === "correction" || resolutionBlockers(line, item, r.lines, r.kind).length > 0) &&
              !approvable(line, r.kind, item, r.lines))
          );
          // The pale tint stays until the burst, like the circle.
          const orderNeedsConfirmation = mine && !mine.burst ? mine.tint.order : orderNeedsNow,
            slipNeedsConfirmation = mine && !mine.burst ? mine.tint.slip : slipNeedsNow;
          const resolveLine =
            live.find(
              ({ line }) =>
                !line.approved && !approvable(line, r.kind, item, r.lines),
            )?.line ??
            live.find(({ line }) => !line.approved)?.line ??
            live[0]?.line;
          const resolve = () =>
            onResolve({ lineId: resolveLine?.id, itemId: item?.id });
          const split = async () => {
            if (await run({ action: "splitComparison", lineIds: live.map(x => x.line.id) }))
              notify("Split into separate comparisons.", true);
          };
          const canModify = (complete || live.some(x => x.line.checked === true)) && !live.some(x => !!x.line.approved);
          const modify = async () => {
            if (!canModify || sourceChanged || addBlocked || modifying.current) return;
            modifying.current = true;
            try {
              if (live.length) {
                for (const {line} of live) {
                  if (!await run({
                    action: "resolve", lineId: line.id,
                    evidenceFingerprint: resolutionEvidenceFingerprint(line),
                    counterpartFingerprint: item ? resolutionCounterpartFingerprint(item) : null,
                    match: "unresolved", specification: "unresolved",
                    quantity: "unresolved", delivery: "unresolved", skipped: false,
                    remainder: null, excess: null,
                  })) return;
                }
              } else if (item && !await run({action: "orderDisposition", itemId: item.id, disposition: "unresolved", note: ""})) return;
              setOpenRow(key);
              notify("Acceptance undone. Modify the pair, then accept it again.");
            } finally { modifying.current = false; }
          };
          const modifyOption = canModify ? <DropdownMenuItem disabled={sourceChanged || addBlocked || !!cheer} onSelect={() => void modify()}><PencilIcon />Modify</DropdownMenuItem> : null;
          const splitOption = <DropdownMenuItem
            disabled={sourceChanged || !item || !live.length || live.some(x => !!x.line.approved)}
            title={live.some(x => !!x.line.approved) ? "Correct the approved receipt before splitting." : undefined}
            onSelect={() => void split()}
          ><UnlinkIcon />Split</DropdownMenuItem>;
          const canRemove =
            !!item &&
            !live.length &&
            item.received === 0 &&
            !!detail.canRemoveOrderItems;
          // One slip line moves at a time; Resolve splits a row of several.
          const mover =
            !sourceChanged && live.length === 1 && !live[0]!.line.approved
              ? live[0]!.line
              : null;
          // While a half is held, the rows it can pair with: an order item
          // the slip line isn't linked to, or a movable slip line not linked
          // to the order item. A line only shown beside its likely item can
          // be paired with it in its own row.
          const accepts = !drag
            ? null
            : drag.side === "slip"
              ? item && drag.line && drag.line.orderItemId !== item.id
                ? item.id
                : null
              : mover && mover.orderItemId !== drag.item.id
                ? mover.id
                : null;
          const held = (side: "order" | "slip") =>
            (drag?.key === key && drag.side === side) ||
            (menu?.key === key && menu.side === side);
          const away = drag?.key === key && drag.moving ? drag.side : null;
          const lifted = (side: "order" | "slip") => held(side) && !away;
          const grab = (
            side: "order" | "slip",
            canDrag: boolean,
            base:
              | { side: "slip"; line: ReceivingLine | null }
              | { side: "order"; item: ReceiptOrderItem },
          ) => ({
            onLift: (at: DragPoint) => {
              const node = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-drag-half]") ?? [])
                .find((el) => el.dataset.dragKey === key && el.dataset.dragHalf === side);
              if (node) {
                const bounds = node.getBoundingClientRect();
                draggedHalf.current = { node, left: bounds.left, top: bounds.top };
              }
              pointer.current = at;
              if ("vibrate" in navigator) navigator.vibrate(10);
              setMenu(null);
              setGrab({
                ...base,
                key,
                start: at,
                at,
                moving: false,
                over: null,
              });
            },
            onMove: (at: DragPoint) => {
              pointer.current = at;
              const d = grabbed.current;
              if (!d) return;
              const moving =
                d.moving ||
                (canDrag &&
                  Math.hypot(at.x - d.start.x, at.y - d.start.y) > DRAG_FROM);
              if (!moving) return;
              positionHalf(at, d.start);
              const over = dropTarget(at);
              if (!d.moving || d.over !== over)
                setGrab({ ...d, moving, over, at });
            },
            onDrop: (at: DragPoint) => {
              const d = grabbed.current;
              pointer.current = null;
              setGrab(null);
              if (!d) return;
              if (!d.moving) return setMenu({ key, side });
              const over = dropTarget(at);
              if (over) dropOn(d, over);
            },
            onCancel: () => {
              pointer.current = null;
              setGrab(null);
            },
          });
          const viewItem = () => item && showPreview({ kind: "item", item });
          const viewSlip = (copy: ReaderCopy) => {
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
              : (matching.length ? matching : lines).map(({ line }) => ({
                  page: line.page,
                  box: line.sourceBox ?? sourceLine(line, detail)?.box,
                }));
            showPreview({
              kind: "slip",
              title: copy.description || title,
              sources,
            });
          };
          const main = copies[0]!;
          const backorderLine = live.length === 1 ? live[0]!.line : undefined;
          const canAcceptBackorder = !sourceChanged && !complete && !!item && !!backorderLine &&
            (backorderLine.kind ?? r.kind) === "delivery" &&
            !backorderLine.approved && !backorderLine.resolution?.materialIssue &&
            backorderLine.orderItemId === item.id && backorderLine.quantity === 0 &&
            receivedLineQuantity(backorderLine) === 0 &&
            receiptUnit(backorderLine.unit) === receiptUnit(item.unit) &&
            due > 0 && backorderLine.ordered !== null && Math.abs(backorderLine.ordered - due) < 1e-6 &&
            !!main.backorderChecks?.length && main.backorderChecks.every(check => check.ok) &&
            !approvable(backorderLine, r.kind, item, r.lines);
          const canConfirmInformation = canAcceptBackorder || (
            !sourceChanged && !complete && !!item && !!backorderLine &&
            (backorderLine.kind ?? r.kind) === "delivery" &&
            !backorderLine.approved && !backorderLine.checked && !backorderLine.resolution?.materialIssue &&
            backorderLine.orderItemId === item.id && backorderLine.quantity !== null && backorderLine.quantity > 0 &&
            receivedLineQuantity(backorderLine) === backorderLine.quantity &&
            compareToOrder(item, [backorderLine], byHand)?.ok === true &&
            !main.backorderChecks?.some(check => !check.ok)
          );
          // One Accept button: the slip's own confirmation when it fits,
          // otherwise the links and decisions that settle the row.
          const plan: Plan | null =
            complete || mine || cheer
              ? null
              : canConfirmInformation && backorderLine && item
                ? {
                    actions: [{
                      action: "resolve",
                      lineId: backorderLine.id,
                      evidenceFingerprint: resolutionEvidenceFingerprint(backorderLine),
                      counterpartFingerprint: resolutionCounterpartFingerprint(item),
                      match: "confirmed",
                      specification: "confirmed",
                      quantity: "confirmed",
                      delivery: canAcceptBackorder ? "short" : "confirmed",
                      siteQuantity: backorderLine.quantity,
                      acceptedQuantity: backorderLine.quantity,
                      remainder: canAcceptBackorder ? "backordered" : null,
                      skipped: false,
                      note: canAcceptBackorder ? "Nothing delivered; the slip BO accounts for the full outstanding quantity." : "Reviewer confirmed the displayed information is correct.",
                    }],
                    label: canAcceptBackorder ? "Accept With Backorder" : "Accept",
                    message: canAcceptBackorder ? "Backorder accepted. Nothing received; the full quantity remains outstanding." : undefined,
                  }
                : main.backorderChecks?.some((check) => !check.ok)
                  ? null
                  : linkPlan;


          // The heading, score and verdict of one reader's copy of the line.
          const reading = (copy: ReaderCopy, first: boolean) => (
            <>
              <p className={`${copyLabel} ${first ? "pr-6" : ""}`}>
                {copy.label}
                {copy.reviewStatus && (
                  <span
                    aria-label={`Review status: ${copy.reviewStatus}`}
                    className="text-muted-foreground ml-1.5 font-normal normal-case"
                  >
                    · {copy.reviewStatus}
                  </span>
                )}
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
                  <p className={`${copyText} text-red-700 dark:text-red-300`}>
                    Empty
                  </p>
                  {disposition ? (
                    <p className="text-muted-foreground text-xs">
                      {
                        {
                          outstanding: "Outstanding, still due",
                          backordered: "Backordered, still due",
                          "cancel-requested": "Cancellation requested",
                          unresolved: "Still investigating",
                        }[disposition.disposition]
                      }
                      {disposition.note && ` · ${disposition.note}`}
                    </p>
                  ) : (
                    <p className="text-muted-foreground border-t pt-2 text-xs">
                      No slip line linked
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className={copyText}>
                    <button
                      type="button"
                      aria-label={`View packing-slip line: ${copy.description || title} (${copy.label})`}
                      className="focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2"
                      onClick={() => viewSlip(copy)}
                    >
                      {copy.description || "—"}
                    </button>
                  </p>
                  <QuantityPair
                    ordered={copy.ordered}
                    received={copy.shipped}
                    unit={copy.unit}
                    backorders={copy.backorderChecks}
                  />
                </>
              )}
            </>
          );
          const verdict = (copy: ReaderCopy) => (<>
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
            {copy.backorderChecks?.filter(check => !check.ok).map((check, i) => (
              <p key={i} className={`${copyNote} ${check.ok ? "text-muted-foreground" : amber.text} flex items-start gap-1`}>
                {!check.ok && <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />}
                {check.label}
              </p>
            ))}
          </>);

          const removableDetections = live.filter(({line}) => (line.approved?.quantity ?? 0) === 0);
          const notItemOption = live.length > 0 ? <DropdownMenuItem
            disabled={sourceChanged || addBlocked || removableDetections.length === 0}
            title={removableDetections.length === 0 ? "Correct the recorded receipt before removing this line." : undefined}
            onSelect={() => { setRemoveDetectionFailed(false); setNotItem({ids:removableDetections.map(x => x.line.id), selected:removableDetections[0]!.line.id}); }}
          ><Trash2Icon />This is not an item</DropdownMenuItem> : null;
          const slipOptions = (side: "order" | "slip") => (
            <>
              <DropdownMenuItem onSelect={() => viewSlip(main)}>
                <FileTextIcon />
                View on slip
              </DropdownMenuItem>
              {modifyOption}
              {detail.canCreate && detail.document.packingSlip && live.length === 1 && !live[0]!.line.orderItemId && !live[0]!.line.approved && (
                <DropdownMenuItem disabled={sourceChanged || addBlocked} onSelect={() => { setAddFailed(false); setAddLineId(live[0]!.line.id); }}>
                  <PlusIcon />Add this part to material list
                </DropdownMenuItem>
              )}
              {side === "slip" && <>
              <DropdownMenuItem disabled={sourceChanged} onSelect={() => setMaterialIssue({kind:"mismatch", lineIds:live.map(x => x.line.id), selected:live[0]!.line.id})}>Shipped Material Doesn’t Match Slip</DropdownMenuItem>
              <DropdownMenuItem disabled={sourceChanged} onSelect={() => setMaterialIssue({kind:"supplier", lineIds:live.map(x => x.line.id), selected:live[0]!.line.id})}>Supplier Entered This Incorrectly</DropdownMenuItem>
              </>}
              {notItemOption}
              {splitOption}
            </>
          );
          const halfMenu = (
            side: "order" | "slip",
            hint: string | null,
            items: ReactNode,
          ) =>
            menu?.key === key &&
            menu.side === side && (
              <DropdownMenu
                open
                onOpenChange={(next) => {
                  if (!next) setMenu(null);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-y-0 w-1/2 ${side === "order" ? "left-0" : "right-0"}`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align={side === "order" ? "start" : "end"}
                  className="w-64"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {hint && (
                    <>
                      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                        {hint}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {items}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          const half = (side: "order" | "slip") =>
            `relative isolate row-span-5 grid min-w-0 grid-rows-subgrid pt-6 pb-3 transition-[transform,opacity,filter] duration-150 motion-reduce:transition-none ${side === "order" ? "pr-4 pl-3" : "-ml-2 pr-3 pl-5"} ${lifted(side) ? `z-10 -translate-y-1 drop-shadow-lg ${side === "order" ? "-translate-x-1.5" : "translate-x-1.5"}` : ""} ${away === side ? "pointer-events-none z-50 !transition-none drop-shadow-xl" : ""}`;
          const orderEmpty = !item,
            slipEmpty = !!main.missing;
          return (
            <li
              key={key}
              data-drop={accepts ?? undefined}
              className={`px-3 pt-6 pb-3 ${away ? "relative z-50" : ""}`}
            >
              <div
                data-confirm-card
                className="relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto_auto]"
              >
                {accepts && dragging && (
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute -inset-1.5 z-20 rounded-2xl border-2 transition-colors motion-reduce:transition-none ${drag?.over === accepts ? "border-primary bg-primary/10" : "border-primary/25 border-dashed"}`}
                  />
                )}
                {/* The match number, on the tear between the order and the
                    slip it pairs. */}
                <button
                  type="button"
                  onClick={resolve}
                  aria-label={complete ? "Review resolution" : "Resolve"}
                  title={`${complete ? "Review resolution" : "Resolve"}: ${title}`}
                  data-comparison-state={done ? "complete" : "pending"}
                  className={`absolute top-0 left-[calc(50%-4px)] z-20 flex size-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${done ? statusStyle.approved.badge : (mine?.badge ?? tone?.badge ?? "bg-muted text-muted-foreground")}`}
                >
                  {done ? <CheckIcon aria-hidden className="size-5" /> : n + 1}
                </button>
                <span
                  aria-hidden
                  style={tear.seam}
                  className={`bg-muted-foreground/40 pointer-events-none absolute inset-y-0 left-[calc(50%-8px)] z-[1] w-2 transition-opacity motion-reduce:transition-none ${held("order") || held("slip") ? "opacity-0" : ""}`}
                />
                <div
                  role="group"
                  aria-label="Order"
                  data-drag-half="order"
                  data-drag-key={key}
                  {...pressDrag(
                    item
                      ? grab("order", !sourceChanged, { side: "order", item })
                      : live.length ? {
                          onLift: () => {},
                          onMove: () => {},
                          onDrop: () => setMenu({ key, side: "order" }),
                          onCancel: () => {},
                        } : null,
                  )}
                  className={`${half("order")} ${item || live.length ? "select-none [-webkit-touch-callout:none]" : ""}`}
                >
                  <TornPaper side="order" markedForReturn={live.some(({line}) => line.orderItemId === item?.id && materialMarkedForReturn(line, r.kind))} empty={orderEmpty && !done} needsConfirmation={orderNeedsConfirmation} />
                  <p className={copyLabel}>Order</p>
                  <h3
                    aria-label={title}
                    className={`${copyText} ${orderEmpty ? "text-red-700 dark:text-red-300" : ""}`}
                  >
                    {item ? (
                      <button
                        type="button"
                        aria-label={`View material-list item: ${title}`}
                        onClick={viewItem}
                        className="focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2"
                      >
                        {item.description}
                      </button>
                    ) : (
                      "Empty"
                    )}
                  </h3>
                  {item ? (
                    <QuantityPair
                      ordered={item.ordered}
                      received={item.received}
                      unit={item.unit}
                    />
                  ) : (
                    <p className="text-muted-foreground border-t pt-2 text-xs">
                      Not on the order
                    </p>
                  )}
                  <div className={copyNote}>
                    {item ? (
                      <>
                        {due > 0
                          ? `${receivingQuantity(due, item.unit)} still due`
                          : "All received"}
                        {item.sku && ` · ${item.sku}`}
                        {live.some(({ line }) => !line.orderItemId) && (
                          <span className={`block ${amber.text}`}>
                            The slip line is likely this part. Confirm it in
                            Resolve.
                          </span>
                        )}
                        {canRemove && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="relative z-10 mt-2"
                            onClick={() => setRemoveItem(item)}
                          >
                            Remove from order
                          </Button>
                        )}
                        {item.received > 0 && (
                          <ReceivedFrom
                            item={item}
                            receipts={detail.receipts?.[item.id]}
                          />
                        )}
                      </>
                    ) : (
                      likely && (
                        <span className="text-muted-foreground">
                          Likely {likely}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div
                  data-drag-half="slip"
                  data-drag-key={key}
                  {...pressDrag(
                    live.length
                      ? grab("slip", !!mover, { side: "slip", line: mover })
                      : null,
                  )}
                  className={`${half("slip")} ${live.length ? "select-none [-webkit-touch-callout:none]" : ""}`}
                >
                  <TornPaper side="slip" markedForReturn={live.some(({line}) => materialMarkedForReturn(line, r.kind))} empty={slipEmpty && !done} needsConfirmation={slipNeedsConfirmation} />
                  <div
                    role="group"
                    aria-label={`${main.label} reading`}
                    className="relative row-span-4 grid min-w-0 grid-rows-subgrid"
                  >
                    {reading(main, true)}
                    <div>
                      {!main.missing && (
                        <>
                          {verdict(main)}
                          {!item && tone && (
                            <p
                              className={`${copyNote} font-medium ${tone.text}`}
                            >
                              {tone.label}
                            </p>
                          )}
                        </>
                      )}
                      {copies.length > 1 && (
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
                  <div>
                    {showOthers &&
                      copies.slice(1).map((copy) => (
                        <div
                          key={copy.key}
                          role="group"
                          aria-label={`${copy.label} reading`}
                          className="text-muted-foreground relative mt-3 border-t border-dashed pt-2.5"
                        >
                          {reading(copy, false)}
                          {verdict(copy)}
                        </div>
                      ))}
                  </div>
                  {lines.length > 0 && (
                    <button
                      type="button"
                      aria-label={`Review line: ${title}`}
                      aria-expanded={open}
                      onClick={() => setOpenRow(open ? null : key)}
                      className="focus-visible:ring-ring absolute top-5 right-1.5 z-10 flex h-8 w-7 items-center justify-center rounded focus-visible:ring-2"
                    >
                      <ChevronDownIcon
                        aria-hidden
                        className={`text-muted-foreground size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>
                {/* Outside the halves, so pressing an option never lifts one. */}
                {(item || live.length > 0) &&
                  halfMenu(
                    "order",
                    sourceChanged || !item
                      ? null
                      : "Drag onto a slip line to pair them.",
                    item ? <>
                      <DropdownMenuItem onSelect={viewItem}>
                        <EyeIcon />
                        View item
                      </DropdownMenuItem>
                      {modifyOption}
                      {notItemOption}
                      {splitOption}
                      {canRemove && (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setRemoveItem(item)}
                        >
                          <Trash2Icon />
                          Remove from order
                        </DropdownMenuItem>
                      )}
                    </> : slipOptions("order"),
                  )}
                {live.length > 0 &&
                  halfMenu(
                    "slip",
                    mover ? "Drag onto an order item to pair them." : null,
                    slipOptions("slip"),
                  )}
              </div>
              {(plan ?? mine) && item && (
                // Folds away under the burst, leaving only the check.
                <div
                  className={`grid transition-[grid-template-rows,margin-top] duration-300 motion-reduce:transition-none ${mine?.burst ? "mt-0 grid-rows-[0fr] delay-100" : "mt-3 grid-rows-[1fr]"}`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <button
                      type="button"
                      data-confirm-button
                      disabled={!!cheer}
                      onClick={(event) =>
                        plan &&
                        confirmRow(
                          key,
                          item,
                          plan,
                          tone?.badge ?? "bg-muted text-muted-foreground",
                          {
                            order: orderNeedsConfirmation,
                            slip: slipNeedsConfirmation,
                          },
                          event.currentTarget,
                        )
                      }
                      className={`focus-visible:ring-ring flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-emerald-600/40 bg-emerald-500/10 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default dark:border-emerald-400/30 dark:text-emerald-200 ${mine?.covered ? "invisible" : ""}`}
                    >
                      <CheckIcon className="size-4" />
                      {mine?.label ?? plan?.label ?? "Accept"}
                    </button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-start justify-between gap-3">
                {/* What reviewers said is needed, from Resolve. */}
                {lines.map(({line}) => line.resolution?.materialIssue ? <p key={`issue:${line.id}`} className="text-amber-700 dark:text-amber-300 text-sm">{materialIssueLabels[line.resolution.materialIssue]}</p> : null)}
                <div className="min-w-0 space-y-1">
                  {lines.flatMap(({ line }) =>
                    line.note
                      ? [
                          <p
                            key={line.id}
                            className="text-muted-foreground flex gap-1.5 text-xs break-words"
                          >
                            <MessageSquareTextIcon
                              aria-label="Note"
                              className="mt-px size-3.5 shrink-0"
                            />
                            <span className="min-w-0">{line.note.text}</span>
                          </p>,
                        ]
                      : [],
                  )}
                </div>
              </div>
              {live.flatMap((x) => {
                const check = terraCheck(x.line, detail);
                return check
                  ? [
                      <p
                        key={`terra:${x.line.id}`}
                        className={`mt-2 text-xs ${amber.text}`}
                      >
                        {readerLabels.terra} {check.reader}.
                      </p>,
                    ]
                  : [];
              })}
              {open && (
                <div className="bg-muted/30 -mx-3 mt-2 pt-2">
                  {lines.map(({ line, index }) => (
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <PartFitDialog
        fit={asking?.fit ?? null}
        item={asking?.item}
        unit={asking?.unit ?? ""}
        onClose={() => setAsking(null)}
        onChoose={(over) => asking?.go(over?.fit)}
      />
      {drag?.moving && (
        <span role="status" className="sr-only">
          {drag.side === "order"
            ? drag.over ? `Pair with ${lineIds.get(drag.over)?.description ?? "this line"}` : "Drop on a slip line"
            : drag.over ? `Move to ${detail.items.find((i) => i.id === drag.over)?.description ?? "this item"}` : "Drop on an order item"}
        </span>
      )}
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
                <p className="text-muted-foreground text-sm">
                  The source file changed. Review the new version before viewing
                  this line.
                </p>
              ) : (
                <div className="space-y-4">
                  {preview.sources.map((source, i) => (
                    <div key={i} className="space-y-2">
                      <p className="text-muted-foreground text-sm">
                        Page {source.page}
                        {!source.box &&
                          " · Exact line position unavailable; showing the source page."}
                      </p>
                      <SlipLineImage
                        url={detail.sourceUrl}
                        page={source.page}
                        box={source.box ?? { x: 0, y: 0, width: 1, height: 1 }}
                        header={
                          source.box
                            ? headerFor(detail, source.page)
                            : undefined
                        }
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
  inline = false,
}: {
  inline?: boolean;
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
    counted = fit && item ? receivingQuantity(fit.quantity, item.unit) : "";
  const Title = inline ? "h3" : DialogTitle;
  const Description = inline ? "p" : DialogDescription;
  const Header = inline ? "div" : DialogHeader;
  const body = fit && item && (
    <>
      <Header className="space-y-2">
        <Title className="font-semibold">
          {change
            ? "Update this part to match the slip?"
            : inline
              ? `Use ${counted} for review?`
              : `Receive ${counted}?`}
        </Title>
        <Description className="text-muted-foreground text-sm">
          {fit.reason}
        </Description>
      </Header>
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
                  <td className="py-2 font-medium break-words">{r.after}</td>
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
            {inline
              ? "Update part and save for review"
              : read === null
                ? "Update part and confirm"
                : `Update part and receive ${counted}`}
          </Button>
        )}
        {read === null ? (
          <Button variant="outline" onClick={() => onChoose()}>
            {inline ? "Save reading only" : "Confirm only"}
          </Button>
        ) : (
          <Button
            variant={change ? "outline" : "default"}
            onClick={() =>
              onChoose({ quantity: fit.quantity, unit: item.unit })
            }
          >
            {!change && <CheckIcon />}
            {inline
              ? `Use ${counted} for review`
              : change
                ? `Receive ${counted} only`
                : `Receive ${counted}`}
          </Button>
        )}
        {read !== null && (
          <Button variant="ghost" onClick={() => onChoose()}>
            Keep {receivingQuantity(read, unit || item.unit)}
          </Button>
        )}
      </div>
    </>
  );
  return inline ? (
    <section className="space-y-4 rounded border p-4">
      {body}
      <Button variant="ghost" onClick={onClose}>
        Back to correction
      </Button>
    </section>
  ) : (
    <Dialog open={!!fit && !!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {body}
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
  resolveMode = false,
}: {
  line: ReceivingLine;
  index: number;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
  onDone: () => void;
  resolveMode?: boolean;
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
    [item, setItem] = useState(l.orderItemId ?? detail.pairs?.[l.id] ?? ""),
    [checked, setChecked] = useState(l.checked ?? false),
    [part, setPart] = useState(false),
    [reason, setReason] = useState(""),
    // Lines missing a quantity or an order part open straight into editing.
    [editing, setEditing] = useState(
      resolveMode || !l.orderItemId || l.quantity === null,
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
      ordered:
        over.quantity !== undefined
          ? convertedOrderedQuantity(
              ordered === "" ? null : Number(ordered),
              quantity === "" ? null : Number(quantity),
              over.quantity,
            )
          : ordered === ""
            ? null
            : Number(ordered),
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
    else if (await save(!resolveMode)) onDone();
  };
  const finish = async (over?: Parameters<typeof save>[1]) => {
    setFit(null);
    if (await save(!resolveMode, over)) onDone();
  };
  if (resolveMode && fit)
    return (
      <PartFitDialog
        fit={fit}
        item={chosen}
        unit={unit}
        inline
        onClose={() => setFit(null)}
        onChoose={(over) => void finish(over)}
      />
    );
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
          header={headerFor(detail, l.page)}
          label={`Source for line ${index + 1}`}
        />
      )}
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
      ) : (
        l.issues.length > 0 &&
        !l.checked &&
        !l.autoConfirmed && (
          <p className="text-sm">
            {sourceBox
              ? "The reading is unsure. Check the slip image above."
              : "The reading is unsure. Check it against the slip."}
          </p>
        )
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
                  const i = detail.items.find((i) => i.id === e.target.value);
                  if (i) setUnit(i.unit);
                  setChecked(false);
                }}
              >
                <option value="">Unmatched</option>
                {detail.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.description} · due{" "}
                    {receivingQuantity(
                      Math.max(0, qtyRound(i.ordered - i.received)),
                      i.unit,
                    )}
                  </option>
                ))}
              </select>
            </Label>
            <Label
              name={
                (kind || detail.review.kind) === "delivery"
                  ? "Quantity"
                  : (kind || detail.review.kind) === "credit-only"
                    ? "Credited quantity"
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
                placeholder={
                  detail.items.find((i) => i.id === item)?.unit ?? "Order unit"
                }
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
                  onChange={(e) => setKind(e.target.value as ReceiptKind | "")}
                >
                  <option value="">Use document type</option>
                  <option value="delivery">Delivery</option>
                  <option value="return-replacement">
                    Return for replacement
                  </option>
                  <option value="return-credit">Return for credit</option>
                  <option value="credit-only">
                    Credit only (no physical return)
                  </option>
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
          {resolveMode
            ? "Save reading for review"
            : editing
              ? "Save and confirm"
              : "Looks right"}
        </Button>
        {editing ? (
          <Button
            variant="outline"
            onClick={() => void save(resolveMode ? false : checked)}
          >
            Save changes
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
        {!resolveMode && (!l.approved || l.approved.quantity === 0) && (
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
  card = false,
}: {
  card?: boolean;
  line: ReceivingLine;
  part: Part;
  note?: string;
  primary?: boolean;
  disabled?: boolean;
  onAdd: (confirmed?: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const needsConfirmation =
    receiptUnit(line.unit) === "ea" &&
    !!p.piecesPerPack &&
    p.piecesPerPack > 1 &&
    !!p.unit &&
    receiptUnit(p.unit) !== "ea";
  return (
    <li className={card ? `${PART_TILE_CARD_CLASS} border bg-card shadow-sm` : "flex items-center gap-3 px-3 py-2"}>
      {card ? <button type="button" className="h-full w-full text-left disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Add ${p.name} to the list`} disabled={disabled}
        onClick={() => (needsConfirmation ? setConfirm(true) : onAdd())}>
        <PartTileContent part={{displayName:p.name, imageUrl:p.photoUrl, piecesPerPack:p.piecesPerPack}}
          details={<><span className="text-muted-foreground text-xs">{note}</span><span className="mt-1 text-sm">Add to list</span></>} />
      </button> : <>

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
        onClick={() => (needsConfirmation ? setConfirm(true) : onAdd())}
      >
        <PlusIcon />
        Add to list
      </Button>
      </>}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm what “each” means</DialogTitle>
            <DialogDescription>
              {p.name}: one {p.unit} contains {p.piecesPerPack}{" "}
              {p.individualUnit ?? "pieces"}. Does 1 {line.unit ?? "EA"} on the
              slip mean one complete {p.unit}?
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Ordered: {line.ordered ?? line.quantity ?? "not entered"} {p.unit}.
            Delivered: {line.quantity ?? "not entered"} {p.unit}. The counts
            stay the same. You will still review and approve the delivery.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirm(false);
                onAdd(true);
              }}
            >
              Yes, add as {p.unit}
            </Button>
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
  cards = false,
  onReviewQuantity,
}: {
  cards?: boolean;
  onReviewQuantity?: () => void;
  line: ReceivingLine;
  detail: Detail;
  jobId: string;
  run: (a: Action) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"search" | "new" | null>(null);
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!cards) return;
    const dialog = section.current?.closest('[role="dialog"]');
    if (dialog) dialog.scrollTop = 0;
  }, [cards, mode]);
  const likely = (detail.likely?.[line.id] ?? []).slice(0, 3),
    order = detail.document.packingSlip!,
    count = line.ordered ?? line.quantity,
    counted = count !== null && count > 0;
  const toggle = (next: "search" | "new") =>
    setMode(mode === next ? null : next);
  return (
    <section ref={section} className={cards ? "space-y-4" : "space-y-3 rounded-lg border p-3"}>
      <div>
        {!cards && <h4 className="font-medium">Add it to the material list</h4>}
        <p className="text-muted-foreground text-sm">
          This part is not on order {order.orderNumber}. Adding it puts it on{" "}
          {order.materialListName}
          {counted ? ` with ${count} ordered` : ""}. You still confirm what
          came.
        </p>
        {!counted && (
          <p className={`mt-1 text-sm ${amber.text}`}>
            {cards ? "Save the slip quantity before adding this part." : "Enter the quantity that came below and save it first."}
            {cards && <Button variant="link" onClick={onReviewQuantity}>Review quantity</Button>}
          </p>
        )}
      </div>
      {(!cards || !mode) && (likely.length > 0 || cards) ? (
        <ul
          aria-label="Likely catalogue parts"
          className={cards ? "grid grid-cols-2 justify-items-center gap-3 sm:grid-cols-4" : "divide-y rounded-md border"}
        >
          {likely.map((p, i) => (
            <PartChoice
              card={cards}
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
          {cards && <li className={`${PART_TILE_CARD_CLASS} border bg-card shadow-sm`}>
            <button type="button" className="h-full w-full p-3 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMode("new")}>
              <span className="bg-muted mb-3 flex aspect-square w-full items-center justify-center rounded-xl"><PlusIcon className="size-10" /></span>
              <span className="block text-sm font-medium">Create A Part Instead</span>
              <span className="text-muted-foreground mt-1 block text-xs">Start with the information on this slip</span>
            </button>
          </li>}
        </ul>
      ) : !mode ? (
        <p className="text-sm">No close match in your catalogue.</p>
      ) : null}
      {cards && !mode && likely.length === 0 && <p className="text-muted-foreground text-sm">No close match in your catalogue. Search or create a part.</p>}
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
        {!cards && <Button
          size="sm"
          variant={likely.length ? "outline" : "default"}
          aria-expanded={mode === "new"}
          onClick={() => toggle("new")}
        >
          <PlusIcon />
          New part in ForemanHQ
        </Button>}
        {cards && mode && <Button size="sm" variant="outline" onClick={() => setMode(null)}>Back to matches</Button>}
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
  // Only prefill an explicit package size for a slip already counted in
  // packages. A dimension or an EA count must not silently change its unit.
  const packaged = ["box", "pack", "bag", "bundle", "case", "carton", "roll", "coil", "pail"].includes(receiptUnit(line.unit));
  const slipPacks = packaged ? packSizesIn(line.description) : [];
  const slipPack = slipPacks.length === 1 ? String(slipPacks[0]) : "";
  const slipIndividual = slipPack && /\b\d[\d,]*\s*(?:ft|feet)\s*(?:\/|per\s+)(?:roll|rl|coil)\b/i.test(line.description) ? "ft" : "ea";
  const [name, setName] = useState(line.description.slice(0, 255)),
    [description, setDescription] = useState(line.description),
    [catalog, setCatalog] = useState(detail.catalogs[0]?.id ?? ""),
    [unit, setUnit] = useState(line.unit || "ea"),
    [pack, setPack] = useState(slipPack),
    [individual, setIndividual] = useState(slipIndividual),
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
      {mode === "new" && <div className="bg-muted/40 space-y-1 rounded-md p-3 text-sm" aria-label="Information from packing slip">
        {line.sku && <p>Supplier code: {line.sku}</p>}
        <p>Ordered: {line.ordered ?? line.quantity ?? "Needs review"} {line.unit}</p>
        <p>Received on slip: {line.quantity ?? "Needs review"} {line.unit}</p>
        {line.unitPrice !== null && <p>Job unit price: {line.unitPrice}</p>}
        <p className="text-muted-foreground text-xs">The supplier code, quantities and job price are carried over from this slip.</p>
      </div>}
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
  newListOnly = false,
  onCancel,
}: {
  newListOnly?: boolean;
  onCancel?: () => void;
  detail: Detail;
  run: (a: Action) => Promise<boolean>;
}) {
  const [supplier, setSupplier] = useState(detail.review.supplierId ?? detail.orders.find((order) => order.id === detail.document.packingSlip?.orderId)?.supplierId ?? ""),
    [list, setList] = useState(""),
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
    <details open={newListOnly || undefined} className={`${card} px-4 py-3`}>
      <summary className="cursor-pointer font-medium">
        {newListOnly ? "New List From This Slip" : "Reconstruct an order from this slip"}
      </summary>
      <p className="text-muted-foreground my-3 text-sm">
        Log an order already placed outside FormanHQ. Nothing is sent to the
        supplier. You can create the list now and review the parts and quantities afterward.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {!newListOnly && <Label name="Material list">
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
        </Label>}
        {!list && (
          <Label name="New list name">
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Label>
        )}
        {newListOnly && <Label name="Supplier">
          <select className={field} value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            <option value="">Choose supplier</option>
            {detail.suppliers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </Label>}
        <Label name="Order reference">
          <input
            className={field}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </Label>
      </div>
      <p className="my-3 text-sm">
        {candidates.length ? `${candidates.length} matched lines will be added. Other lines can be reviewed afterward.` : "Create the list first, then match the slip’s items to catalogue parts."}
      </p>
      {newListOnly && !supplier && <p className="mb-3 text-sm text-amber-700">Choose a supplier to create this list.</p>}
      <div className="flex items-center justify-between gap-3">
      {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
      <Button
        className="ml-auto"
        disabled={!(newListOnly ? supplier : detail.review.supplierId) || !name.trim() || !number.trim()}
        onClick={() =>
          void run({
            action: "reconstruct",
            materialListId: list || null,
            listName: name,
            orderNumber: number,
            lineIds: candidates.map((l) => l.id),
            ...(newListOnly ? {supplierId: supplier} : {}),
            confirmed: true,
          })
        }
      >
        {newListOnly ? "Create New List" : "Approve reconstructed order"}
      </Button>
      </div>
    </details>
  );
}
