"use client";
import { receivingReviewHref } from "~/lib/receiving-navigation";
import Link from "next/link";
import { useState } from "react";
import { SlipProcessingProgress } from "./SlipProcessingProgress";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  convertSlipQuantity,
  slipHeader,
  type SlipAnalysis,
  type SlipLine,
} from "~/lib/packing-slip-review";
import { lineAmount, linkOf, openIssues, roundQty } from "~/lib/slip-draft";
import { cn } from "~/lib/utils";
import { SlipLineImage } from "./SlipLineImage";
import type { SlipDraft } from "./use-slip-draft";

type Entry = NonNullable<ReturnType<SlipDraft["item"]>>;
export type SlipEntry = Entry;
const fmt = (n: number, unit: string) => `${roundQty(n)} ${unit}`;
/** Keeps taps on slip controls from verifying the part card underneath. */
const stop = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerUp: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/** Everything SlipBadge shows; the same key draws the same badge. */
export const slipBadgeKey = ({ item, amount, slip, lines, check, edited, total }: Entry) =>
  JSON.stringify([item.description, item.unit, item.ordered, amount ?? null, slip ?? null, lines.length, check, edited, total]);

/** What the slip says about a part, on the part's photo. */
export function SlipBadge({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: () => void;
}) {
  const { item, amount, slip, lines, check, edited } = entry;
  const over = entry.total > item.ordered + 1e-6;
  const label = !lines.length
    ? amount === undefined
      ? "Not on slip"
      : `+${roundQty(amount)}`
    : check
      ? "Check"
      : amount === undefined
        ? "Slip"
        : `Slip +${roundQty(amount)}`;
  return (
    <button
      type="button"
      {...stop}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Packing slip for ${item.description}: ${
        check
          ? "check this part"
          : slip === undefined
            ? "not read on the slip"
            : `slip says ${fmt(slip, item.unit)}`
      }${edited ? `, set to ${fmt(amount ?? 0, item.unit)}` : ""}`}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] leading-none font-semibold shadow-sm ring-1",
        check || over
          ? "bg-amber-100/95 text-amber-900 ring-amber-300 dark:bg-amber-950/90 dark:text-amber-200 dark:ring-amber-800"
          : lines.length
            ? "bg-blue-100/95 text-blue-900 ring-blue-300 dark:bg-blue-950/90 dark:text-blue-200 dark:ring-blue-800"
            : "bg-card/95 text-muted-foreground ring-border",
      )}
    >
      {check || over ? (
        <AlertTriangleIcon className="size-3" />
      ) : (
        <FileTextIcon className="size-3" />
      )}
      {label}
    </button>
  );
}

/** One slip line: the printed line, what was read, and anything to check. */
export function SlipLineView({
  analysis,
  line,
  index,
  jobId,
  links,
  busy,
  onLink,
  pickerLabel,
  openPicker = false,
}: {
  analysis: SlipAnalysis;
  line: SlipLine;
  index: number;
  jobId: string;
  links: Record<number, string | null>;
  busy: boolean;
  onLink: (index: number, itemId: string | null) => void;
  pickerLabel: string;
  openPicker?: boolean;
}) {
  const header = slipHeader(analysis.headers, line.page);
  const picker = (
    <SlipLinePicker
      analysis={analysis}
      line={line}
      index={index}
      links={links}
      busy={busy}
      onLink={onLink}
      label={pickerLabel}
    />
  );
  return (
    <div className="space-y-1.5">
      {line.box ? (
        <SlipLineImage
          url={`/api/job-documents/files/${analysis.versionId}?jobId=${encodeURIComponent(jobId)}`}
          page={line.page}
          box={line.box}
          header={header}
          label={`Slip line ${index + 1} as printed on page ${line.page}`}
        />
      ) : (
        <p className="bg-muted/50 rounded px-2 py-1 font-mono text-xs break-words">
          {line.evidence}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Read from slip:{" "}
        {[
          line.ordered != null && `ordered ${line.ordered}`,
          `shipped ${line.shipped ?? "unclear"}`,
          line.backordered !== null && `backordered ${line.backordered}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        {line.unit ? ` ${line.unit}` : ""}
      </p>
      {openIssues(line, index in links).map((issue) => (
        <p
          key={issue}
          className="flex gap-1.5 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {issue}
        </p>
      ))}
      {(line.notes ?? []).map((note) => (
        <p key={note} className="text-muted-foreground flex gap-1.5 text-xs">
          <InfoIcon className="mt-0.5 size-3 shrink-0" />
          {note}
        </p>
      ))}
      {openPicker ? (
        picker
      ) : (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            Wrong item?
          </summary>
          <div className="pt-2">{picker}</div>
        </details>
      )}
    </div>
  );
}

function SlipLinePicker({
  analysis,
  line,
  index,
  links,
  busy,
  onLink,
  label,
}: {
  analysis: SlipAnalysis;
  line: SlipLine;
  index: number;
  links: Record<number, string | null>;
  busy: boolean;
  onLink: (index: number, itemId: string | null) => void;
  label: string;
}) {
  const candidates = (line.candidates ?? []).filter((id) =>
    analysis.items.some((x) => x.id === id),
  );
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        aria-label={`Order item for slip line ${index + 1}`}
        className="border-input bg-background h-9 max-w-full min-w-0 flex-1 rounded-md border px-2 text-sm"
        disabled={busy}
        value={linkOf(analysis, links, index) ?? ""}
        onChange={(e) => onLink(index, e.target.value || null)}
      >
        <option value="">Not on this order</option>
        {candidates.length > 0 && (
          <optgroup label="Likely matches">
            {candidates.map((id) => (
              <option key={id} value={id}>
                {analysis.items.find((x) => x.id === id)!.description}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="All order items">
          {analysis.items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.description}
              {x.sku ? ` (${x.sku})` : ""}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

/** The slip's lines for one part, and what arrived of it. */
export function SlipPartSheet({
  draft,
  orderItemId,
  name,
  jobId,
  onClose,
}: {
  draft: SlipDraft;
  orderItemId: string | null;
  name: string;
  jobId: string;
  onClose: () => void;
}) {
  const entry = orderItemId ? draft.item(orderItemId) : null;
  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {entry && draft.analysis && (
          <SlipPartBody
            key={orderItemId}
            draft={draft}
            entry={entry}
            name={name}
            jobId={jobId}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SlipPartBody({
  draft,
  entry,
  name,
  jobId,
  onClose,
}: {
  draft: SlipDraft;
  entry: Entry;
  name: string;
  jobId: string;
  onClose: () => void;
}) {
  const analysis = draft.analysis!;
  const { item, lines, slip } = entry;
  const [text, setText] = useState(
    entry.edited && entry.amount !== undefined ? String(entry.amount) : "",
  );
  const typed =
    text.trim() && Number.isFinite(Number(text)) ? Number(text) : undefined;
  const amount = typed ?? slip;
  const total = roundQty(item.received + (amount ?? 0));
  const invalid =
    !!text.trim() && (typed === undefined || typed < 0 || typed > 999999);
  const done = () => {
    if (invalid) return;
    draft.setAmount(item.id, typed);
    onClose();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{name}</DialogTitle>
        <DialogDescription>
          {draft.slip?.name ?? "Packing slip"}
          {item.sku ? ` · SKU ${item.sku}` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Ordered">{fmt(item.ordered, item.unit)}</Figure>
        <Figure label="Received before">{fmt(item.received, item.unit)}</Figure>
        <Figure label="Slip says">
          {slip === undefined ? "Unclear" : fmt(slip, item.unit)}
        </Figure>
      </div>
      {lines.length ? (
        <ul className="space-y-3">
          {lines.map(({ line, index }) => (
            <li key={index} className="space-y-2 rounded-lg border p-3">
              <SlipLineView
                analysis={analysis}
                line={line}
                index={index}
                jobId={jobId}
                links={draft.links}
                busy={draft.busy}
                onLink={draft.link}
                pickerLabel="This slip line is"
              />
              {line.handwritten !== undefined && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const pack = !!item.piecesPerPack && item.piecesPerPack > 1;
                    const written = convertSlipQuantity(
                      line.handwritten!,
                      line.unit ?? (pack ? null : item.unit),
                      item,
                      `${line.description ?? ""} ${line.evidence}`,
                    );
                    if (written === null) return;
                    setText(
                      String(
                        roundQty(
                          (slip ?? 0) -
                            (lineAmount(line, item.id, item) ?? 0) +
                            written,
                        ),
                      ),
                    );
                  }}
                >
                  Use handwritten {line.handwritten}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="bg-muted/40 text-muted-foreground rounded-lg p-3 text-sm">
          Not found on this slip. Enter a quantity only if it arrived.
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Arrived in this delivery</span>
        <span className="flex items-center gap-2">
          <Input
            aria-label={`Arrived in this delivery: ${item.description}`}
            type="number"
            min="0"
            max="999999"
            step="any"
            inputMode="decimal"
            value={text}
            placeholder={slip === undefined ? "Count" : String(slip)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && done()}
            className="h-10 w-28"
          />
          <span className="text-sm">{item.unit}</span>
        </span>
        <span
          className={cn(
            "block text-xs",
            invalid
              ? "text-destructive"
              : total > item.ordered + 1e-6
                ? "text-amber-800 dark:text-amber-300"
                : "text-muted-foreground",
          )}
        >
          {invalid
            ? "Enter a quantity from 0 to 999999."
            : amount === undefined
              ? "Leave blank if none arrived."
              : `Received total becomes ${fmt(total, item.unit)} of ${fmt(item.ordered, item.unit)}${
                  total > item.ordered + 1e-6 ? ", more than ordered" : ""
                }.`}
        </span>
      </label>
      <DialogFooter>
        <Button disabled={invalid} onClick={done}>
          <CheckIcon className="size-4" /> Done
        </Button>
      </DialogFooter>
    </>
  );
}

function Figure({ label, children }: { label: string; children: string }) {
  return (
    <div className="bg-muted/50 rounded-lg px-2 py-2">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{children}</p>
    </div>
  );
}

/** Above the parts while a slip is being read or checked: what it found, and
 * the one button that confirms the delivery. */
export function SlipVerifyBar({
  materialListId,
  draft,
  jobId,
  showOrder = false,
}: {
  draft: SlipDraft;
  jobId: string;
  materialListId?: string;
  /** Name the order, for lists with more than one. */
  showOrder?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const order =
    showOrder && draft.orderNumber ? ` for ${draft.orderNumber}` : "";
  if(draft.reviewDoc)return <section className="mb-3 border-y py-3 text-sm"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Packing slip{order}</p><p className="text-muted-foreground">{draft.reading?'Reading in the background…':`${draft.reviewDoc.receivingReview?.pending??0} lines to review`}</p>{!draft.reading&&draft.reviewDoc.receivingReview?.missingPages&&<p className="text-amber-800 dark:text-amber-300">{draft.reviewDoc.receivingReview.missingPages}</p>}</div><Button asChild variant="outline"><Link href={receivingReviewHref(jobId, draft.reviewDoc.id, materialListId)}>Review & approve</Link></Button></div></section>;
  if (!draft.slip) {
    return <SlipProcessingProgress analysis={draft.tracking} order={order} />;
  }
  const filled = draft.items.filter((i) => i.amount !== undefined).length;
  const checks = draft.items.filter((i) => i.check).length;
  const unmatched = draft.unmatched;
  return (
    <section
      aria-label="Packing slip"
      className="bg-card space-y-2 rounded-xl border p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <FileTextIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Packing slip read{order}</p>
          <p className="text-muted-foreground text-xs">
            {filled} {filled === 1 ? "part" : "parts"} filled in from the slip
            {checks ? (
              <span className="text-amber-800 dark:text-amber-300">
                {" "}
                · {checks} to check
              </span>
            ) : null}
            . Tap a part to change it.
          </p>
        </div>
        {draft.analysis!.lines.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-8 shrink-0 px-2 text-xs"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Details"}
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </Button>
        )}
        <Button
          className="h-10 w-full sm:w-auto"
          disabled={draft.busy || !filled}
          asChild
        ><Link href={receivingReviewHref(jobId, draft.slip.id, materialListId)}>

          {draft.busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          Review & approve
        </Link></Button>
      </div>
      {/* Line by line results fold away so the parts stay in view; each
          part card carries its own Check mark. */}
      {(open || draft.reading || draft.tracking?.status === "failed") && (
        <SlipProcessingProgress
          analysis={draft.reading || draft.tracking?.status === "failed" ? draft.tracking : draft.analysis}
          order={order}
          embedded
        />
      )}
      {draft.error && (
        <div
          role="alert"
          className="text-destructive flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="min-w-0 flex-1">{draft.error}</span>
          {/Refresh totals/i.test(draft.error) && (
            <Button
              size="sm"
              variant="outline"
              disabled={draft.busy}
              onClick={() => void draft.refresh()}
            >
              Refresh totals
            </Button>
          )}
        </div>
      )}
      {draft.analysis!.warnings.map((warning) => (
        <p
          key={warning}
          className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-300"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {warning}
        </p>
      ))}
      {unmatched.length > 0 && (
        <details className="group border-t pt-2 text-sm">
          <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs">
            <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
            {unmatched.length} slip {unmatched.length === 1 ? "line" : "lines"}{" "}
            not matched to a part
          </summary>
          <ul className="mt-2 space-y-3">
            {unmatched.map(({ line, index }) => (
              <li
                key={index}
                className="space-y-1.5 rounded-lg border border-dashed p-3"
              >
                <SlipLineView
                  analysis={draft.analysis!}
                  line={line}
                  index={index}
                  jobId={jobId}
                  links={draft.links}
                  busy={draft.busy}
                  onLink={draft.link}
                  pickerLabel="Link to"
                  openPicker
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
