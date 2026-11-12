"use client";
import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FileUpIcon,
  Link2OffIcon,
  LinkIcon,
  MessageSquareTextIcon,
  ScanSearchIcon,
  SkipForwardIcon,
  SplitIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { SaveCheck } from "~/components/ui/save-check";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { SlipLineImage } from "./SlipLineImage";
import { ResolveSlipSource } from "./ResolveSlipSource";
import { ReceivingReplaceSource } from "./ReceivingReplaceSource";
import { ReceivingItemPreview } from "./ReceivingItemPreview";
import { receivingQuantity } from "~/lib/receiving-quantity-display";
import {
  OPEN_CHECKS,
  resolutionBlockers,
  resolutionEvidenceFingerprint,
  resolutionCounterpartFingerprint,
  receivedLineQuantity,
  receivingLineReady,
  type ReceivingResolution,
} from "~/lib/receiving-resolution";
import { lineReadings, readSlipQuantity } from "~/lib/packing-slip-review";
import { readerLabels } from "~/lib/packing-slip-trial";
import { convertedOrderedQuantity } from "~/lib/receiving-review";
import type { ReceiptOrderItem, SlipBox } from "~/lib/packing-slip-review";
import type { ReceivingLine } from "~/lib/receiving-review";
import type { ReceivingDetail, ReceivingAction } from "./ReceivingWorkspace";

export type ResolveTarget = { lineId?: string; itemId?: string; findOnSlip?: boolean };

/** Pairs a slip line with an order item, or unlinks it, counting it in the
 * item's unit. Linking approves nothing. Null when the units can't be
 * converted safely, so the reviewer confirms the count first. */
export function linkLineAction(
  l: ReceivingLine,
  orderItemId: string | null,
  items: ReceiptOrderItem[],
): ReceivingAction | null {
  const chosen = items.find((i) => i.id === orderItemId);
  const converted =
    chosen && l.quantity != null
      ? readSlipQuantity(l.quantity, l.unit, chosen)
      : null;
  if (chosen && l.quantity != null && !converted) return null;
  return {
    action: "line",
    lineId: l.id,
    kind: l.kind ?? null,
    description: l.description,
    sku: l.sku,
    quantity: converted?.amount ?? l.quantity,
    ordered: converted
      ? convertedOrderedQuantity(l.ordered, l.quantity, converted.amount)
      : l.ordered,
    unit: chosen?.unit ?? l.unit,
    unitPrice: l.unitPrice,
    orderItemId,
    checked: false,
  };
}
type Page =
  | "review"
  | "source"
  | "find"
  | "choose"
  | "edit"
  | "delivery"
  | "allocate"
  | "part"
  | "replace"
  | "exclude";

// The receiving workspace's own field, card and copy styles.
const field =
  "border-input bg-background h-11 w-full min-w-0 rounded-md border px-3 text-base";
const area = "bg-background min-h-24 text-base";
const card = "bg-card rounded-xl border";
const copyLabel =
  "text-muted-foreground text-[11px] font-medium tracking-wide uppercase";
const amberText = "text-amber-700 dark:text-amber-300";
const doneText = "text-emerald-700 dark:text-emerald-300";
const callout =
  "flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100";
const overlay =
  "focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 hover:underline";
// A whole list row that acts as one button; its notes sit outside the label.
const row =
  "focus-visible:after:ring-ring text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset";

const qty = (n: number | null | undefined, unit: string) =>
  n == null ? "Not read" : receivingQuantity(n, unit);
const percent = (n: number) => `${Math.round(n * 100)}%`;

const deliveryLabels: Record<ReceivingResolution["delivery"], string> = {
  confirmed: "Matches paperwork",
  short: "Short delivery",
  damaged: "Damaged",
  wrong: "Wrong part or substitute",
  extra: "Extra delivered",
  unresolved: "Still investigating",
};
const remainderLabels = {
  backordered: "Rest backordered",
  cancelled: "Cancellation requested for the rest",
  unexplained: "Rest unexplained",
} as const;
const excessLabels = {
  accepted: "Excess accepted",
  return: "Excess going back",
} as const;
const dispositionLabels = {
  unresolved: "Still investigating",
  outstanding: "Outstanding, still due",
  backordered: "Backordered, still due",
  "cancel-requested": "Cancellation requested",
} as const;
const openChecks: string[] = Object.values(OPEN_CHECKS);

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </label>
  );
}

/** Label and figure pairs, set like the receiving rows. */
function Figures({ rows }: { rows: Array<[string, ReactNode] | false> }) {
  return (
    <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-y-1 border-t pt-2 text-sm">
      {rows.map(
        (row) =>
          row && (
            <Fragment key={row[0]}>
              <dt className="text-muted-foreground text-xs">{row[0]}</dt>
              <dd className="font-semibold tabular-nums">{row[1]}</dd>
            </Fragment>
          ),
      )}
    </dl>
  );
}

type CheckState = "done" | "issue" | "open";
type Check = {
  name: string;
  state: CheckState;
  detail: ReactNode;
  actions?: ReactNode;
};
const stateWords = { done: "done", issue: "issue recorded", open: "to do" };

function CheckRow({ check }: { check: Check }) {
  const Icon =
    check.state === "done"
      ? CheckCircle2Icon
      : check.state === "issue"
        ? AlertTriangleIcon
        : CircleIcon;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
      <Icon
        aria-hidden
        className={`mt-0.5 size-5 ${check.state === "done" ? doneText : check.state === "issue" ? amberText : "text-muted-foreground/50"}`}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {check.name}
          <span className="sr-only">, {stateWords[check.state]}</span>
        </p>
        <div className="text-muted-foreground text-sm break-words">
          {check.detail}
        </div>
      </div>
      {check.actions && (
        <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-3 sm:justify-end sm:self-center">
          {check.actions}
        </div>
      )}
    </li>
  );
}

type Fix = {
  title: string;
  text: string;
  icon: LucideIcon;
  run: () => void;
  opens?: boolean;
};

/** Fix a packing-slip line, or an order item no slip line covers: the order
 * and the slip side by side, the four checks, a note for anything the checks
 * can't cover, then the less common fixes. */
export function ReceivingResolve({
  detail,
  jobId,
  target,
  busy,
  run,
  onClose,
  onSelect,
  onReload,
  onAddLine,
  renderCorrection,
}: {
  detail: ReceivingDetail;
  jobId: string;
  target: ResolveTarget;
  busy: boolean;
  run: (action: ReceivingAction) => Promise<boolean>;
  onClose: () => void;
  onSelect: (target: ResolveTarget) => void;
  onReload: () => Promise<void>;
  onAddLine: (value: {
    itemId?: string;
    detect?: boolean;
    page: number;
    description: string;
    box?: SlipBox;
  }) => Promise<boolean>;
  renderCorrection: (line: ReceivingLine, onDone: () => void) => ReactNode;
}) {
  const line = detail.review.lines.find((l) => l.id === target.lineId);
  const item = detail.items.find(
    (i) => i.id === (line?.orderItemId ?? target.itemId),
  );
  const [page, setPage] = useState<Page>(target.findOnSlip ? "find" : "review");
  const [search, setSearch] = useState("");
  const sourceChanged =
    detail.review.versionId !== detail.document.currentVersionId;
  const orderResolution = item
    ? detail.review.orderResolutions?.[item.id]
    : undefined;
  const r = line?.resolution;
  // What's needed: a line keeps its own note; an order item with no slip line
  // keeps it with its status.
  const [saved, setSaved] = useState<{
    note: string;
    disposition: NonNullable<typeof orderResolution>["disposition"];
    count: number;
  } | null>(null);
  const savedNote =
    saved?.note ??
    (line ? (line.note?.text ?? "") : (orderResolution?.note ?? ""));
  const savedDisposition =
    saved?.disposition ?? orderResolution?.disposition ?? "unresolved";
  const [note, setNote] = useState(savedNote);
  const [disposition, setDisposition] = useState(savedDisposition);
  const [explanation, setExplanation] = useState(r?.note ?? "");
  const [reason, setReason] = useState("");
  const [delivery, setDelivery] = useState<ReceivingResolution["delivery"]>(
    r && r.delivery !== "unresolved" && r.delivery !== "confirmed"
      ? r.delivery
      : "short",
  );
  const [site, setSite] = useState(
    r?.siteQuantity == null ? "" : String(r.siteQuantity),
  );
  const [accepted, setAccepted] = useState(
    r?.acceptedQuantity == null ? "" : String(r.acceptedQuantity),
  );
  const [remainder, setRemainder] = useState<string>(r?.remainder ?? "");
  const [excess, setExcess] = useState<string>(r?.excess ?? "");
  const [candidate, setCandidate] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const correctionLine = pendingLineId
    ? detail.review.lines.find((l) => l.id === pendingLineId)
    : line;
  const [localMessage, setLocalMessage] = useState("");
  const [sources, setSources] = useState<string[]>(line ? [line.id] : []);
  const [outputs, setOutputs] = useState([
    {
      description: line?.description ?? item?.description ?? "",
      sku: line?.sku ?? "",
      quantity: line?.quantity == null ? "" : String(line.quantity),
      unit: line?.unit ?? item?.unit ?? "ea",
      orderItemId: line?.orderItemId ?? item?.id ?? "",
    },
  ]);
  const source =
    line?.sourceIndex !== undefined &&
    detail.review.analysisRunId ===
      detail.document.packingSlipAnalysis?.runId &&
    detail.review.versionId === detail.document.packingSlipAnalysis?.versionId
      ? detail.document.packingSlipAnalysis?.lines[line.sourceIndex]
      : undefined;
  const sourceBox = line?.sourceBox ?? source?.box;
  const creditOnly = (line?.kind ?? detail.review.kind) === "credit-only";
  const blockers = line
    ? resolutionBlockers(line, item, detail.review.lines, detail.review.kind)
    : [];
  const activeReader =
    line?.predictionSource?.reader ?? line?.readingSource?.reader;
  const confidence = line?.predictionSource?.confidence;
  const original = line?.paper ?? {
    quantity: source?.shipped ?? line?.quantity,
    ordered: source?.ordered ?? line?.ordered,
    unit: source?.unit ?? line?.unit ?? "",
    description: source?.description ?? line?.description,
    sku: source?.sku ?? line?.sku,
  };
  const resolve = async (decision: ReceivingAction) => {
    if (!line || sourceChanged) return false;
    return run({
      ...decision,
      action: "resolve",
      lineId: line.id,
      evidenceFingerprint: resolutionEvidenceFingerprint(line),
      counterpartFingerprint: item
        ? resolutionCounterpartFingerprint(item)
        : null,
      skipped: decision.skipped ?? false,
    });
  };
  const next = () => {
    const current = line ? detail.review.lines.indexOf(line) : -1;
    const following = detail.review.lines.slice(current + 1).find(
      (l) =>
        !l.ignored &&
        !l.approved &&
        (!l.checked ||
          resolutionBlockers(
            l,
            detail.items.find((i) => i.id === l.orderItemId),
            detail.review.lines,
            detail.review.kind,
          ).length),
    );
    if (following) onSelect({ lineId: following.id });
    else onClose();
  };
  const noteDirty =
    note.trim() !== savedNote ||
    (!line && !!item && disposition !== savedDisposition);
  const cancelNeedsNote =
    !line && disposition === "cancel-requested" && note.trim().length < 3;
  const saveNote = async () => {
    if (!noteDirty || sourceChanged) return true;
    const done = line
      ? await run({ action: "note", lineId: line.id, note: note.trim() })
      : !!item &&
        (await run({
          action: "orderDisposition",
          itemId: item.id,
          disposition,
          note: note.trim(),
        }));
    if (done) {
      setSaved((v) => ({
        note: note.trim(),
        disposition,
        count: (v?.count ?? 0) + 1,
      }));
      setLocalMessage("");
    }
    return done;
  };
  // Leaving keeps what was typed: save it first, and stay if that fails.
  const leave = async (then: () => void) => {
    if (await saveNote()) then();
    else
      setLocalMessage(
        "The note isn't saved. Save it again, or clear it to leave without it.",
      );
  };
  const back = () => {
    if (page !== "review") {
      setPage("review");
      setLocalMessage("");
    } else void leave(onClose);
  };
  useHeaderBackOverride(back, { priority: 1 });
  const updateLink = async (l: ReceivingLine, orderItemId: string | null) => {
    const action = linkLineAction(l, orderItemId, detail.items);
    if (!action) {
      setPendingLink(orderItemId);
      setPendingLineId(l.id);
      setLocalMessage(
        "The counterpart uses a different or ambiguous unit. Enter and confirm the conversion before saving.",
      );
      setPage("edit");
      return;
    }
    if (await run(action)) {
      setCandidate(null);
      setPage("review");
      onSelect({ lineId: l.id });
    }
  };
  const contributors = item
    ? detail.review.lines.filter((l) => !l.ignored && l.orderItemId === item.id)
    : [];
  const pending = detail.review.lines.filter((l) => !l.ignored && !l.approved);
  const linkedElsewhere =
    candidate && !line
      ? detail.review.lines.find((l) => l.id === candidate)
      : undefined;
  const otherOwner = linkedElsewhere?.orderItemId
    ? detail.items.find((i) => i.id === linkedElsewhere.orderItemId)
    : undefined;
  const itemSnapshot = (
    detail.document.packingSlipAnalysis?.confirmedItems ??
    detail.document.packingSlipAnalysis?.items
  )?.find((i) => i.id === item?.id);
  const differentOrder =
    !!item &&
    !!itemSnapshot &&
    ((itemSnapshot.originalOrdered ??
      itemSnapshot.ordered + (itemSnapshot.credited ?? 0)) !==
      (item.originalOrdered ?? item.ordered + (item.credited ?? 0)) ||
      itemSnapshot.description !== item.description ||
      itemSnapshot.sku !== item.sku ||
      itemSnapshot.unit !== item.unit ||
      itemSnapshot.piecesPerPack !== item.piecesPerPack ||
      itemSnapshot.individualUnit !== item.individualUnit);
  const choices = line
    ? detail.items.filter((i) =>
        `${i.description} ${i.sku}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : pending.filter((l) =>
        `${l.description} ${l.sku}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      );
  const ready =
    !!line &&
    receivingLineReady(line, detail.review.kind, item, detail.review.lines);
  const approved = !!line?.approved;

  // The four checks. A line confirmed without a resolution counts as done; a
  // resolution made for older evidence starts again on the next decision.
  const settled = !!line && !r && (ready || approved);
  const current =
    !!r &&
    !!line &&
    r.evidenceFingerprint === resolutionEvidenceFingerprint(line) &&
    (!item ||
      r.counterpartFingerprint === resolutionCounterpartFingerprint(item));
  const live = current ? r : undefined;
  const matchState: CheckState =
    settled || (!!line?.orderItemId && live?.match === "confirmed")
      ? "done"
      : "open";
  const spec = settled ? "confirmed" : (live?.specification ?? "unresolved");
  const specState: CheckState =
    spec === "unresolved"
      ? "open"
      : spec === "substitution-rejected"
        ? "issue"
        : "done";
  const quantityState: CheckState =
    settled || live?.quantity === "confirmed" ? "done" : "open";
  const deliveryValue = settled
    ? "confirmed"
    : (live?.delivery ?? "unresolved");
  const deliveryState: CheckState =
    deliveryValue === "unresolved"
      ? "open"
      : deliveryValue === "confirmed"
        ? "done"
        : "issue";
  const doneCount = [
    matchState,
    specState,
    quantityState,
    deliveryState,
  ].filter((s) => s !== "open").length;
  const extras = blockers.filter((b) => !openChecks.includes(b));
  const confirm = (decision: Partial<ReceivingResolution>) => () =>
    void resolve({ action: "resolve", ...decision });
  const confirmButton = (
    aria: string,
    decision: Partial<ReceivingResolution>,
  ) => (
    <Button variant="outline" aria-label={aria} onClick={confirm(decision)}>
      Confirm
    </Button>
  );
  const checks: Check[] = line
    ? [
        {
          name: "Part match",
          state: matchState,
          detail: !line.orderItemId
            ? "No order item linked yet."
            : matchState === "done"
              ? "Confirmed"
              : OPEN_CHECKS.match,
          actions: !approved && (
            <>
              <Button
                variant="outline"
                aria-label={
                  line.orderItemId ? "Change order item" : "Find order item"
                }
                onClick={() => {
                  setCandidate(null);
                  setPage("choose");
                }}
              >
                {line.orderItemId ? "Change" : "Find"}
              </Button>
              {matchState !== "done" &&
                line.orderItemId &&
                confirmButton("Confirm part match", { match: "confirmed" })}
            </>
          ),
        },
        {
          name: "Size & specification",
          state: specState,
          detail: {
            confirmed: "Confirmed",
            "substitution-accepted": "Substitute accepted",
            "substitution-rejected": "Substitute rejected",
            unresolved: OPEN_CHECKS.specification,
          }[spec],
          // A rejected substitute is edited where it was recorded, so Confirm
          // never sits beside it as a second answer. Credit lines have no
          // delivery page, so they keep Confirm.
          actions:
            !approved &&
            (specState === "issue" && !creditOnly ? (
              <Button
                variant="outline"
                aria-label="Edit substitute decision"
                onClick={() => setPage("delivery")}
              >
                Edit
              </Button>
            ) : (
              specState !== "done" &&
              confirmButton("Confirm size & specification", {
                specification: "confirmed",
              })
            )),
        },
        {
          name: "Quantity & unit",
          state: quantityState,
          detail: quantityState === "done" ? "Confirmed" : OPEN_CHECKS.quantity,
          actions: (
            <>
              <Button
                variant="outline"
                aria-label="Correct the reading"
                onClick={() => setPage("edit")}
              >
                Correct
              </Button>
              {!approved &&
                quantityState !== "done" &&
                confirmButton("Confirm quantity & unit", {
                  quantity: "confirmed",
                })}
            </>
          ),
        },
        {
          name: creditOnly ? "Credit" : "Delivery",
          state: deliveryState,
          detail: (
            <>
              {deliveryState === "open"
                ? OPEN_CHECKS.delivery
                : deliveryState === "done"
                  ? creditOnly
                    ? "Credit matches paperwork"
                    : "Matches paperwork"
                  : [
                      deliveryLabels[deliveryValue],
                      live?.siteQuantity != null &&
                        `${qty(live.siteQuantity, line.unit)} on site`,
                      `${qty(receivedLineQuantity(line), line.unit)} to ${creditOnly ? "credit" : "receive"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              {live?.remainder && (
                <span className="block">{remainderLabels[live.remainder]}</span>
              )}
              {live?.excess && (
                <span className="block">{excessLabels[live.excess]}</span>
              )}
              {live?.note && (
                <span className="text-foreground mt-1 block">
                  “{live.note}”
                </span>
              )}
            </>
          ),
          actions: (
            <>
              {!creditOnly && (
                <Button
                  variant="outline"
                  aria-label={
                    deliveryState === "issue"
                      ? "Edit delivery issue"
                      : "Record delivery issue"
                  }
                  onClick={() => setPage("delivery")}
                >
                  {deliveryState === "issue" ? "Edit" : "Record issue"}
                </Button>
              )}
              {!approved &&
                (creditOnly
                  ? deliveryState !== "done"
                  : deliveryState === "open") &&
                confirmButton(
                  creditOnly
                    ? "Credit matches paperwork"
                    : "Delivery matches paperwork",
                  { delivery: "confirmed" },
                )}
            </>
          ),
        },
      ]
    : [];
  const status = !line
    ? "No slip line linked"
    : approved
      ? "Already received"
      : ready
        ? "Ready to approve"
        : doneCount < 4
          ? `${doneCount} of 4 checks done`
          : extras.length === 0
            ? "All checks done"
            : extras.length === 1
              ? "1 thing left"
              : `${extras.length} things left`;

  const toChoose = () => {
    setCandidate(null);
    setPage("choose");
  };
  const primary: { label: string; run: () => void } = !line
    ? { label: "Choose slip line", run: toChoose }
    : !line.orderItemId
      ? { label: "Find order item", run: toChoose }
      : ready || approved
        ? { label: "Next line", run: () => void leave(next) }
        : matchState === "open"
          ? { label: "Confirm match", run: confirm({ match: "confirmed" }) }
          : specState === "open"
            ? {
                label: "Confirm size & spec",
                run: confirm({ specification: "confirmed" }),
              }
            : quantityState === "open"
              ? {
                  label: "Confirm quantity",
                  run: confirm({ quantity: "confirmed" }),
                }
              : deliveryState === "open"
                ? {
                    label: creditOnly ? "Confirm credit" : "Confirm delivery",
                    run: confirm({ delivery: "confirmed" }),
                  }
                : r?.skipped
                  ? { label: "Clear skip", run: confirm({}) }
                  : !creditOnly
                    ? {
                        label: "Review delivery",
                        run: () => setPage("delivery"),
                      }
                    : { label: "Next line", run: () => void leave(next) };

  const fixes: Fix[] = [
    ...(!line
      ? [
          {
            title: "Choose slip line",
            text: "Link a line already read from this slip.",
            icon: LinkIcon,
            run: toChoose,
            opens: true,
          },
        ]
      : []),
    {
      title: "Find on the slip",
      text: "Look over the whole slip, or add a line the scan missed.",
      icon: ScanSearchIcon,
      run: () => setPage("find"),
      opens: true,
    },
    ...(line && !approved
      ? [
          {
            title: "Split, merge or allocate",
            text: "Share one slip line across order items, or join lines read twice.",
            icon: SplitIcon,
            run: () => setPage("allocate"),
            opens: true,
          },
          ...(line.orderItemId
            ? [
                {
                  title: "Unlink order item",
                  text: `Take this line off ${item?.description ?? "its order item"}.`,
                  icon: Link2OffIcon,
                  run: () => void updateLink(line, null),
                },
              ]
            : []),
          {
            title: "Exclude this line",
            text: "For headings, freight, totals or a line read twice.",
            icon: BanIcon,
            run: () => setPage("exclude"),
            opens: true,
          },
        ]
      : []),
    {
      title: "Replace the slip file",
      text: "Upload a complete or clearer copy.",
      icon: FileUpIcon,
      run: () => setPage("replace"),
      opens: true,
    },
  ];

  const titles: Record<Page, string> = {
    review: line ? "Resolve line" : "Resolve order item",
    source: "Original slip",
    find: "Find on the slip",
    choose: line ? "Choose the order item" : "Choose a slip line",
    edit: "Correct the reading",
    delivery: "Delivery",
    allocate: "Split, merge or allocate",
    part: "Order part",
    replace: "Replace the slip file",
    exclude: "Exclude this line",
  };
  const subtitle =
    page === "review"
      ? [
          detail.document.packingSlip?.orderNumber ?? detail.document.name,
          line && `Page ${line.page}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : (line?.description ?? item?.description ?? "");
  const noteAuthor = line?.note
    ? `${detail.noteAuthors?.[line.note.by] ?? "Organization member"} · ${new Date(line.note.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
    : null;
  const bar = page === "review" || page === "choose";

  return (
    <section
      aria-label="Resolve packing-slip line"
      className={`mx-auto max-w-3xl space-y-4 ${bar ? "pb-36" : "pb-8"}`}
    >
      <header>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2.5"
          onClick={back}
        >
          <ArrowLeftIcon />
          {page === "review" ? "Back to lines" : "Back"}
        </Button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {titles[page]}
        </h1>
        {subtitle && (
          <p className="text-muted-foreground mt-1 truncate text-sm">
            {subtitle}
          </p>
        )}
      </header>
      {sourceChanged && (
        <p role="alert" className={callout}>
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          The source file changed. Go back to the lines and review the new
          version before using this evidence.
        </p>
      )}
      {localMessage && (
        <p role="status" className={callout}>
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {localMessage}
        </p>
      )}
      <fieldset
        hidden={sourceChanged}
        disabled={busy}
        className="min-w-0 space-y-4"
      >
        {page === "review" && (
          <>
            {differentOrder && (
              <div className={callout}>
                <AlertTriangleIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0"
                />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    The order changed after this slip was read
                  </p>
                  <p>
                    When read: {itemSnapshot.description} ·{" "}
                    {qty(itemSnapshot.ordered, itemSnapshot.unit)}
                    {itemSnapshot.sku && ` · ${itemSnapshot.sku}`}
                  </p>
                  <p>
                    Now: {item.description} · {qty(item.ordered, item.unit)}
                    {item.sku && ` · ${item.sku}`}
                  </p>
                </div>
              </div>
            )}

            <section
              aria-label="Order and slip"
              className={`${card} overflow-hidden`}
            >
              <div className="grid grid-cols-2 divide-x">
                <div
                  role="group"
                  aria-label="Order"
                  className="relative min-w-0 space-y-2 p-4"
                >
                  <p className={copyLabel}>Order</p>
                  <h2 className="text-sm font-semibold break-words">
                    {item ? (
                      <button
                        type="button"
                        aria-label={`View order part: ${item.description}`}
                        onClick={() => setPage("part")}
                        className={overlay}
                      >
                        {item.description}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">
                        No order item
                      </span>
                    )}
                  </h2>
                  {item && (
                    <Figures
                      rows={[
                        ["Ordered", qty(item.ordered, item.unit)],
                        ["Received", qty(item.received, item.unit)],
                        [
                          "Still due",
                          qty(
                            Math.max(0, item.ordered - item.received),
                            item.unit,
                          ),
                        ],
                      ]}
                    />
                  )}
                  {item?.sku && (
                    <p className="text-muted-foreground text-xs break-all">
                      {item.sku}
                    </p>
                  )}
                </div>
                <div
                  role="group"
                  aria-label={`Slip${activeReader ? ` · ${readerLabels[activeReader]}` : ""}`}
                  className="relative min-w-0 space-y-2 p-4"
                >
                  <p className={copyLabel}>
                    Slip{activeReader && ` · ${readerLabels[activeReader]}`}
                  </p>
                  {line ? (
                    <>
                      <h2 className="text-sm font-semibold break-words">
                        <button
                          type="button"
                          aria-label={`View on the slip: ${line.description}`}
                          onClick={() => setPage("source")}
                          className={overlay}
                        >
                          {line.description || "No description read"}
                        </button>
                      </h2>
                      <Figures
                        rows={[
                          ["On paper", qty(original.quantity, original.unit)],
                          (original.quantity !== line.quantity ||
                            original.unit !== line.unit) && [
                            "Reviewed",
                            qty(line.quantity, line.unit),
                          ],
                          r?.siteQuantity != null && [
                            "On site",
                            qty(r.siteQuantity, line.unit),
                          ],
                          [
                            creditOnly ? "To credit" : "To receive",
                            qty(receivedLineQuantity(line), line.unit),
                          ],
                        ]}
                      />
                      {confidence && (
                        <p className="text-muted-foreground text-xs tabular-nums">
                          Match{" "}
                          <span
                            className={
                              confidence.match.value < 0.9
                                ? amberText
                                : undefined
                            }
                          >
                            {percent(confidence.match.value)}
                          </span>{" "}
                          · quantity{" "}
                          <span
                            className={
                              confidence.quantity.value < 0.9
                                ? amberText
                                : undefined
                            }
                          >
                            {percent(confidence.quantity.value)}
                          </span>
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h2 className="text-muted-foreground text-sm font-semibold">
                        No slip line linked
                      </h2>
                      <p className="text-muted-foreground border-t pt-2 text-sm">
                        It may be elsewhere on the slip, missed by the scan, or
                        still outstanding.
                      </p>
                    </>
                  )}
                </div>
              </div>
              {line && sourceBox && (
                <div className="border-t p-3">
                  <SlipLineImage
                    url={detail.sourceUrl}
                    page={line.page}
                    box={sourceBox}
                    label={`Slip line on page ${line.page}`}
                  />
                </div>
              )}
              {contributors.length > 1 && (
                <div className="space-y-2 border-t px-4 py-3">
                  <p className="text-sm">
                    <span className="font-medium">
                      {contributors.length} slip lines on this order item
                    </span>
                    {contributors.every((l) => l.unit === item?.unit) && (
                      <span className="text-muted-foreground">
                        {" "}
                        ·{" "}
                        {qty(
                          contributors.reduce(
                            (sum, l) => sum + (receivedLineQuantity(l) ?? 0),
                            0,
                          ),
                          item!.unit,
                        )}{" "}
                        in all
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {contributors.map((l) => (
                      <Button
                        key={l.id}
                        size="sm"
                        variant={line?.id === l.id ? "default" : "outline"}
                        aria-current={line?.id === l.id ? "true" : undefined}
                        onClick={() =>
                          void leave(() => onSelect({ lineId: l.id }))
                        }
                      >
                        Page {l.page} · {qty(receivedLineQuantity(l), l.unit)}
                        {l.approved ? " · received" : ""}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {line && (
              <section aria-labelledby="resolve-checks" className={card}>
                <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-1">
                  <h2 id="resolve-checks" className="font-semibold">
                    Checks
                  </h2>
                  <p
                    className={`text-sm tabular-nums ${ready || approved ? doneText : "text-muted-foreground"}`}
                  >
                    {status}
                  </p>
                </div>
                {approved && (
                  <p className="text-muted-foreground px-4 text-sm">
                    Corrections keep the receipt history.
                  </p>
                )}
                <ul className="divide-y">
                  {checks.map((check) => (
                    <CheckRow key={check.name} check={check} />
                  ))}
                </ul>
                {extras.length > 0 && (
                  <ul
                    className={`space-y-1.5 border-t px-4 py-3 text-sm ${amberText}`}
                  >
                    {extras.map((b) => (
                      <li key={b} className="flex gap-2">
                        <AlertTriangleIcon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0"
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
                {!r && !ready && line.issues.length > 0 && (
                  <div className="border-t px-4 py-3 text-sm">
                    <p className={copyLabel}>From the reading</p>
                    <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5">
                      {line.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {(line ?? item) && (
              <section
                aria-labelledby="resolve-note"
                className={`${card} space-y-3 p-4`}
              >
                <div className="flex gap-3">
                  <MessageSquareTextIcon
                    aria-hidden
                    className="text-muted-foreground mt-0.5 size-5 shrink-0"
                  />
                  <div className="min-w-0">
                    <h2 id="resolve-note" className="font-semibold">
                      What&apos;s needed
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {line
                        ? "If none of these fixes cover it, say how to solve it or what's needed. Everyone reviewing this slip sees it."
                        : "Say why no slip line covers this item, or what's needed. It doesn't receive stock or cancel the order item."}
                    </p>
                  </div>
                </div>
                {!line && (
                  <Field name="Order item status">
                    <select
                      className={field}
                      value={disposition}
                      onChange={(e) =>
                        setDisposition(e.target.value as typeof disposition)
                      }
                    >
                      {Object.entries(dispositionLabels).map(
                        ([value, text]) => (
                          <option key={value} value={value}>
                            {text}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                )}
                <Textarea
                  aria-label="What's needed to fix this"
                  className={area}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    line
                      ? "For example: the slip shows 2 boxes of 25. Ask the supplier which box size they sent."
                      : "For example: the supplier says this ships next week."
                  }
                />
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                  <p className="text-muted-foreground mr-auto flex min-w-0 items-center gap-1.5 text-xs">
                    {saved && !noteDirty ? (
                      <>
                        <SaveCheck key={saved.count} />
                        Saved
                      </>
                    ) : cancelNeedsNote ? (
                      <span className={amberText}>
                        Say why the cancellation is requested.
                      </span>
                    ) : noteDirty ? (
                      "Not saved yet"
                    ) : (
                      noteAuthor
                    )}
                  </p>
                  <Button
                    variant="outline"
                    disabled={!noteDirty || cancelNeedsNote}
                    onClick={() => void saveNote()}
                  >
                    {line ? "Save note" : "Save"}
                  </Button>
                </div>
              </section>
            )}

            <section
              aria-labelledby="resolve-fixes"
              className={`${card} overflow-hidden`}
            >
              <h2 id="resolve-fixes" className="px-4 pt-4 pb-2 font-semibold">
                Other fixes
              </h2>
              <ul className="divide-y border-t">
                {fixes.map((fix, i) => (
                  <li
                    key={fix.title}
                    className="hover:bg-muted/50 relative flex min-h-14 items-center gap-3 px-4 py-3"
                  >
                    <fix.icon
                      aria-hidden
                      className="text-muted-foreground size-5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        aria-describedby={`resolve-fix-${i}`}
                        onClick={fix.run}
                        className={`${row} text-sm font-medium`}
                      >
                        {fix.title}
                      </button>
                      <p
                        id={`resolve-fix-${i}`}
                        className="text-muted-foreground text-sm"
                      >
                        {fix.text}
                      </p>
                    </div>
                    {fix.opens && (
                      <ChevronRightIcon
                        aria-hidden
                        className="text-muted-foreground size-4 shrink-0"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {line && (
              <details className={`${card} group`}>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  Evidence and other saved readings
                </summary>
                <div className="space-y-3 border-t px-4 py-3 text-sm">
                  {confidence && (
                    <p className="text-muted-foreground">
                      Saved match confidence: {percent(confidence.match.value)}{" "}
                      · quantity confidence:{" "}
                      {percent(confidence.quantity.value)}. Each must reach 90%
                      to confirm on its own. Other checks still apply.
                    </p>
                  )}
                  {line.humanEdited && (
                    <p className="text-muted-foreground">
                      This line has been edited. The reader scores describe the
                      original reading.
                    </p>
                  )}
                  <p>
                    <span className="text-muted-foreground">
                      Page {line.page} ·{" "}
                    </span>
                    {line.evidence}
                  </p>
                  {source &&
                    lineReadings(source).map((reading, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p>
                            {readerLabels[reading.reader]} · match{" "}
                            {reading.match == null
                              ? "unknown"
                              : percent(reading.match)}{" "}
                            · quantity{" "}
                            {reading.quantity == null
                              ? "unknown"
                              : percent(reading.quantity)}
                          </p>
                          <p className="font-semibold tabular-nums">
                            {qty(reading.shipped, reading.unit ?? line.unit)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            approved || reading.shipped == null || !item
                          }
                          onClick={async () => {
                            if (!item || reading.shipped == null) return;
                            const converted = readSlipQuantity(
                              Math.abs(reading.shipped),
                              reading.unit,
                              item,
                            );
                            if (!converted) {
                              setLocalMessage(
                                "That saved reading uses an ambiguous unit. Correct and confirm the conversion before saving.",
                              );
                              setPage("edit");
                              return;
                            }
                            await run({
                              action: "line",
                              lineId: line.id,
                              kind: line.kind ?? null,
                              description: line.description,
                              sku: line.sku,
                              quantity: converted.amount,
                              // The reviewed ordered count is already in the order unit.
                              ordered: line.ordered,
                              unit: item.unit,
                              unitPrice: line.unitPrice,
                              orderItemId: line.orderItemId,
                              checked: false,
                            });
                          }}
                        >
                          Use this quantity for review
                        </Button>
                      </div>
                    ))}
                  <p className="text-muted-foreground text-xs">
                    Changing the reading does not approve it.
                  </p>
                </div>
              </details>
            )}
          </>
        )}
        {page === "part" && item && (
          <ReceivingItemPreview
            item={item}
            part={detail.orderParts?.[item.id]}
            materialListId={detail.document.packingSlip?.materialListId ?? ""}
            materialListName={detail.document.packingSlip?.materialListName}
            supplierName={detail.review.supplierName}
          />
        )}
        {page === "source" && (
          <>
            <SlipLineImage
              url={detail.sourceUrl}
              page={line?.page ?? 1}
              box={sourceBox ?? { x: 0, y: 0, width: 1, height: 1 }}
              label="Original slip evidence"
              initiallyZoomed
              showError
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPage("find")}>
                <ScanSearchIcon />
                Find another line on the source
              </Button>
              <Button variant="outline" asChild>
                <Link
                  href={`/jobs/${jobId}/documents?document=${detail.document.id}&from=receiving`}
                >
                  Open full document
                </Link>
              </Button>
            </div>
          </>
        )}
        {page === "find" && (
          <ResolveSlipSource
            url={detail.sourceUrl}
            initialPage={line?.page ?? 1}
            onDetect={item && !line ? async (page, box) => { await onAddLine({ page, box, description: "", itemId: item.id, detect: true }); } : undefined}
            onCancel={() => setPage("review")}
            disabled={busy}
            onUse={async (value) => {
              await onAddLine(value);
            }}
          />
        )}
        {page === "replace" && (
          <ReceivingReplaceSource
            jobId={jobId}
            documentId={detail.document.id}
            expectedVersionId={detail.document.currentVersionId!}
            disabled={busy}
            onCancel={() => setPage("review")}
            onDone={async () => {
              await onReload();
              onClose();
            }}
          />
        )}
        {page === "edit" && correctionLine && (
          <div className={`${card} pt-4`}>
            {renderCorrection(
              pendingLink
                ? { ...correctionLine, orderItemId: pendingLink }
                : correctionLine,
              () => {
                setPage("review");
                setPendingLink(null);
                setPendingLineId(null);
                setLocalMessage("");
                if (!line) onSelect({ lineId: correctionLine.id });
              },
            )}
          </div>
        )}
        {page === "choose" && (
          <div className="space-y-3">
            <Input
              aria-label="Search counterparts"
              className="h-11 text-base"
              placeholder="Search description or supplier code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {choices.length === 0 ? (
              <p className="text-muted-foreground px-1 text-sm">
                Nothing matches.
              </p>
            ) : (
              <ul className={`${card} divide-y overflow-hidden`}>
                {choices.map((choice) => {
                  const otherLines = line
                    ? detail.review.lines.filter(
                        (l) =>
                          !l.ignored &&
                          l.orderItemId === choice.id &&
                          l.id !== line.id,
                      )
                    : [];
                  const owner = !line
                    ? detail.items.find(
                        (i) => i.id === (choice as ReceivingLine).orderItemId,
                      )
                    : undefined;
                  const picked = candidate === choice.id;
                  const Mark = picked ? CheckCircle2Icon : CircleIcon;
                  return (
                    <li
                      key={choice.id}
                      className={`relative flex items-start gap-3 px-4 py-3 text-sm ${picked ? "bg-primary/10" : "hover:bg-muted/50"}`}
                    >
                      <Mark
                        aria-hidden
                        className={`mt-0.5 size-5 shrink-0 ${picked ? "text-primary" : "text-muted-foreground/50"}`}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <button
                          type="button"
                          aria-pressed={picked}
                          className={`${row} font-medium break-words`}
                          onClick={() => setCandidate(choice.id)}
                        >
                          {choice.description}
                        </button>
                        {line?.orderItemId === choice.id && (
                          <p className="text-muted-foreground">Linked now</p>
                        )}
                        {choice.sku && (
                          <p className="text-muted-foreground break-all">
                            {choice.sku}
                          </p>
                        )}
                        {owner && (
                          <p className={amberText}>
                            Linked to {owner.description}. Moving it sends that
                            pair back to review.
                          </p>
                        )}
                        {otherLines.length > 0 && (
                          <p className="text-muted-foreground">
                            {otherLines.length === 1
                              ? "1 other slip line is linked here. Its quantity adds to this one."
                              : `${otherLines.length} other slip lines are linked here. Their quantities add to this one.`}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!line && (
              <Button variant="outline" onClick={() => setPage("find")}>
                <ScanSearchIcon />
                Not listed? Find it on the slip
              </Button>
            )}
          </div>
        )}
        {page === "delivery" && line && (
          <div className={`${card} space-y-4 p-4`}>
            <p className="text-sm">
              The slip says {qty(original.quantity, original.unit)}. Record what
              was counted on site separately.
            </p>
            <Field name="Delivery">
              <select
                className={field}
                value={delivery}
                onChange={(e) => setDelivery(e.target.value as typeof delivery)}
              >
                {Object.entries(deliveryLabels).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name={`Counted on site (${line.unit})`}>
                <input
                  className={field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                />
              </Field>
              <Field name={`Accepted to receive (${line.unit})`}>
                <input
                  className={field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={accepted}
                  onChange={(e) => setAccepted(e.target.value)}
                  placeholder="Site count"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="Outstanding remainder">
                <select
                  className={field}
                  value={remainder}
                  onChange={(e) => setRemainder(e.target.value)}
                >
                  <option value="">No decision</option>
                  <option value="backordered">Backordered, still due</option>
                  <option value="cancelled">Cancellation requested</option>
                  <option value="unexplained">Unexplained, still due</option>
                </select>
              </Field>
              <Field name="Excess quantity">
                <select
                  className={field}
                  value={excess}
                  onChange={(e) => setExcess(e.target.value)}
                >
                  <option value="">No decision</option>
                  <option value="accepted">Accept the excess</option>
                  <option value="return">Return the excess</option>
                </select>
              </Field>
            </div>
            <Field name="Explanation">
              <Textarea
                className={area}
                maxLength={1000}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="What happened, and who agreed it"
              />
            </Field>
            {delivery === "wrong" && (
              <div className="bg-muted/40 space-y-2 rounded-lg p-3">
                <p className="text-sm">Keep the part they sent instead?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!detail.canAcceptSubstitution}
                    onClick={() =>
                      void resolve({
                        action: "resolve",
                        specification: "substitution-accepted",
                        note: explanation,
                      })
                    }
                  >
                    Accept substitute
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void resolve({
                        action: "resolve",
                        specification: "substitution-rejected",
                        note: explanation,
                      })
                    }
                  >
                    Reject substitute
                  </Button>
                </div>
                {!detail.canAcceptSubstitution && (
                  <p className="text-muted-foreground text-xs">
                    Accepting a substitute needs order permission.
                  </p>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                onClick={async () => {
                  if (
                    await resolve({
                      action: "resolve",
                      delivery,
                      siteQuantity: site === "" ? null : Number(site),
                      acceptedQuantity:
                        accepted === "" ? null : Number(accepted),
                      remainder: remainder || null,
                      excess: excess || null,
                      note: explanation,
                    })
                  )
                    setPage("review");
                }}
              >
                Save delivery decision
              </Button>
            </div>
          </div>
        )}
        {page === "allocate" && line && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Tick the slip lines to split or merge, then share their total
              across the new lines. These stay on this order. Units must match,
              and lines already received can&apos;t move.
            </p>
            <div className={`${card} overflow-hidden`}>
              <p className={`${copyLabel} px-4 pt-3 pb-1`}>From</p>
              <ul className="divide-y">
                {pending.map((l) => (
                  <li key={l.id}>
                    <label className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={sources.includes(l.id)}
                        onChange={(e) =>
                          setSources(
                            e.target.checked
                              ? [...sources, l.id]
                              : sources.filter((id) => id !== l.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {l.description}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {qty(l.quantity, l.unit)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${card} space-y-3 p-4`}>
              <p className={copyLabel}>Into</p>
              {outputs.map((output, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">New line {i + 1}</p>
                    {outputs.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setOutputs((v) => v.filter((_, n) => n !== i))
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    aria-label={`Output ${i + 1} description`}
                    className="h-11 text-base"
                    value={output.description}
                    onChange={(e) =>
                      setOutputs((v) =>
                        v.map((o, n) =>
                          n === i ? { ...o, description: e.target.value } : o,
                        ),
                      )
                    }
                  />
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <Input
                      aria-label={`Output ${i + 1} quantity`}
                      className="h-11 text-base"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      placeholder="Qty"
                      value={output.quantity}
                      onChange={(e) =>
                        setOutputs((v) =>
                          v.map((o, n) =>
                            n === i ? { ...o, quantity: e.target.value } : o,
                          ),
                        )
                      }
                    />
                    <select
                      aria-label={`Output ${i + 1} order item`}
                      className={field}
                      value={output.orderItemId}
                      onChange={(e) =>
                        setOutputs((v) =>
                          v.map((o, n) =>
                            n === i ? { ...o, orderItemId: e.target.value } : o,
                          ),
                        )
                      }
                    >
                      <option value="">Unmatched</option>
                      {detail.items.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.description}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                disabled={outputs.length >= 20}
                onClick={() =>
                  setOutputs((v) => [
                    ...v,
                    { ...v[0]!, quantity: "", orderItemId: "" },
                  ])
                }
              >
                Add a line
              </Button>
            </div>
            <Field name="Reason">
              <Textarea
                className={area}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                disabled={
                  !sources.length ||
                  reason.trim().length < 3 ||
                  outputs.some((o) => !o.quantity || !o.description.trim())
                }
                onClick={async () => {
                  if (
                    await run({
                      action: "allocate",
                      lineIds: sources,
                      reason,
                      outputs: outputs.map((o) => ({
                        ...o,
                        quantity: Number(o.quantity),
                        orderItemId: o.orderItemId || null,
                      })),
                    })
                  )
                    onClose();
                }}
              >
                Save allocation for review
              </Button>
            </div>
          </div>
        )}
        {page === "exclude" && line && (
          <div className={`${card} space-y-4 p-4`}>
            <p className="text-sm">
              For headings, freight, totals or a line read twice. A shortage or
              an open question should stay in review instead.
            </p>
            <Field name="Reason">
              <Textarea
                className={area}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                disabled={reason.trim().length < 3 || approved}
                onClick={async () => {
                  if (await run({ action: "ignore", lineId: line.id, reason }))
                    onClose();
                }}
              >
                <BanIcon />
                Exclude with reason
              </Button>
            </div>
          </div>
        )}
      </fieldset>
      {bar && (
        <div className="bg-card pin-viewport-bottom fixed inset-x-0 bottom-0 z-30 border-t px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {page === "review" ? (
            <PriorityActionBar
              className="mx-auto max-w-3xl"
              label={<span className="text-muted-foreground">{status}</span>}
            >
              <Button
                key="undo"
                variant="outline"
                disabled={busy || sourceChanged || !detail.correctionUndo}
                onClick={async () => {
                  if (
                    detail.correctionUndo &&
                    (await run({
                      action: "undoCorrection",
                      requestIdToUndo: detail.correctionUndo.requestId,
                      reason: "Reviewer undid the last correction",
                    }))
                  )
                    onClose();
                }}
              >
                <Undo2Icon />
                Undo
              </Button>
              <Button
                key="skip"
                variant="outline"
                disabled={
                  busy ||
                  sourceChanged ||
                  approved ||
                  (!line && cancelNeedsNote)
                }
                onClick={async () => {
                  // An order item with no slip line keeps its status and note.
                  if (!line) return void leave(onClose);
                  if (!(await saveNote())) return;
                  if (await resolve({ action: "resolve", skipped: true }))
                    next();
                }}
              >
                <SkipForwardIcon />
                Skip
              </Button>
              <Button
                key="primary"
                disabled={busy || sourceChanged}
                onClick={primary.run}
              >
                {primary.label}
              </Button>
            </PriorityActionBar>
          ) : (
            <PriorityActionBar
              className="mx-auto max-w-3xl"
              label={
                <span className="text-muted-foreground">
                  {!candidate
                    ? "Pick the one this belongs with."
                    : otherOwner
                      ? `Moves this line off ${otherOwner.description}.`
                      : "Linking approves no quantities."}
                </span>
              }
            >
              <Button
                key="link"
                disabled={!candidate || busy || sourceChanged}
                onClick={() => {
                  if (!candidate) return;
                  if (line) void updateLink(line, candidate);
                  else {
                    const chosen = detail.review.lines.find(
                      (l) => l.id === candidate,
                    );
                    if (chosen && item) void updateLink(chosen, item.id);
                  }
                }}
              >
                <LinkIcon />
                {otherOwner
                  ? "Move line"
                  : line
                    ? "Link order item"
                    : "Link slip line"}
              </Button>
            </PriorityActionBar>
          )}
        </div>
      )}
    </section>
  );
}
