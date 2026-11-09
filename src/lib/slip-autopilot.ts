import type { ReceiptOrderItem, SlipAnalysis } from "./packing-slip-review";
import {
  autoConfirmsLine,
  type ReceiptKind,
  type ReceivingLine,
  type ReceivingReview,
} from "./receiving-review";

/** Slips in a row a person checked and changed nothing on, before a
 * supplier's slips are received without a check. */
export const CLEAN_RUN = 5;
/** Every tenth slip from a trusted supplier is still checked by a person. */
export const ASK_EVERY = 10;
/** The linked order must be the slip's best match, at least this sure. */
export const ORDER_SURE = 90;

/** How one received slip went. */
export type SlipOutcome = {
  by: "person" | "autopilot";
  /** Nothing the reader proposed was changed, added or left out. */
  clean: boolean;
  /** Received without a check, then undone. */
  undone: boolean;
};

/** Whether a supplier's next slip may be received without a check, from its
 * received slips, newest first. A correction or an undo starts the run again. */
export function supplierTrust(outcomes: SlipOutcome[]) {
  let checked = 0,
    unchecked = 0,
    sinceChecked: number | null = null;
  for (const o of outcomes) {
    if (o.undone || !o.clean) break;
    if (o.by === "autopilot") unchecked++;
    else {
      checked++;
      sinceChecked ??= unchecked;
    }
  }
  const earned = checked >= CLEAN_RUN;
  /** This slip is the one in ten a person checks. */
  const due = earned && (sinceChecked ?? unchecked) >= ASK_EVERY - 1;
  return { checked, trusted: earned && !due, due };
}

/** One saved confirmation of a slip, as its review history keeps it. */
export type ConfirmationEntry = {
  operation: string;
  initiator?: string;
  before?: { kind?: ReceiptKind; lines?: ReceivingLine[] };
  after?: { kind?: ReceiptKind; lines?: ReceivingLine[] };
};
/** Anything a person does here means the reading was not right as it was. */
const CORRECTIONS = new Set([
  "addLine",
  "adoptSource",
  "allocate",
  "detectLine",
  "extra",
  "ignore",
  "note",
  "part",
  "reconstruct",
  "removeOrderItem",
  "reopen",
  "resolve",
  "restoreLine",
  "splitComparison",
  "undoAutopilot",
  "undoCorrection",
]);
/** How a slip went, from its confirmations, oldest first; null until it is
 * received. Clean means it was received once, as the reader drafted it: the
 * same lines, parts and quantities. */
export function slipOutcome(entries: ConfirmationEntry[]): SlipOutcome | null {
  const approvals = entries.filter((e) => e.operation === "approve");
  const last = approvals.at(-1);
  if (!last) return null;
  const draft = entries[0]?.before;
  const lines = last.after?.lines ?? [];
  const drafted = new Map((draft?.lines ?? []).map((l) => [l.id, l]));
  const clean =
    approvals.length === 1 &&
    !entries.some((e) => CORRECTIONS.has(e.operation)) &&
    !!draft?.kind &&
    last.after?.kind === draft.kind &&
    lines.length > 0 &&
    lines.length === drafted.size &&
    lines.every((l) => {
      const was = drafted.get(l.id);
      return (
        !!was &&
        !!l.approved &&
        !l.ignored &&
        !l.resolution &&
        !l.allocation &&
        l.sourceIndex !== undefined &&
        l.sourceIndex === was.sourceIndex &&
        l.approved.itemId === was.orderItemId &&
        l.approved.quantity === was.quantity
      );
    });
  return {
    by: last.initiator === "autopilot" ? "autopilot" : "person",
    clean,
    undone: entries.some((e) => e.operation === "undoAutopilot"),
  };
}

/** Why this slip cannot be received without a check: empty when every line
 * was read surely, matches its order line and the printed totals agree. */
export function autopilotBlockers(input: {
  review: ReceivingReview;
  analysis: SlipAnalysis | undefined;
  currentVersionId: string | null | undefined;
  items: ReceiptOrderItem[];
  /** The order the slip is linked to. */
  orderId: string | undefined;
  /** The slip's best matching order, from what was read on it. */
  best: { orderId: string; confidence: number } | undefined;
}) {
  const { review, analysis, items } = input;
  const blockers: string[] = [];
  const no = (when: unknown, why: string) => {
    if (when) blockers.push(why);
  };
  no(analysis?.status !== "ready", "not read");
  no(
    analysis?.versionId !== input.currentVersionId ||
      review.versionId !== input.currentVersionId ||
      review.analysisRunId !== analysis?.runId,
    "reading out of date",
  );
  no(analysis?.cascade?.status !== "not-needed", "reading was escalated");
  no(analysis?.totalsAgree !== true, "printed totals not read or disagree");
  no(!!analysis?.warnings.length || review.warnings.length > 0, "warnings");
  no(analysis?.applied, "already received");
  no(
    [
      review.humanReviewed,
      review.orderConfirmed,
      review.documentChecked,
      review.autopilot,
      review.sourceTrial,
      review.retiredBy,
      review.duplicateDecision,
      review.orderResolutions,
    ].some(Boolean),
    "already handled",
  );
  no(review.kind !== "delivery" || !review.kindConfirmed, "not a delivery");
  no(!input.orderId, "no order");
  no(
    !input.best ||
      input.best.orderId !== input.orderId ||
      input.best.confidence < ORDER_SURE,
    "order match unsure",
  );
  no(!review.lines.length, "no lines");
  const seen = new Set<string>();
  for (const line of review.lines) {
    no(
      [
        line.ignored,
        line.approved,
        line.checked,
        line.resolution,
        line.allocation,
        line.note,
        line.issues.length,
      ].some(Boolean) ||
        (line.kind !== undefined && line.kind !== "delivery") ||
        !line.orderItemId ||
        seen.has(line.orderItemId) ||
        !autoConfirmsLine(
          line,
          review,
          analysis,
          input.currentVersionId,
          items,
        ),
      `line ${line.id} unsure`,
    );
    if (line.orderItemId) seen.add(line.orderItemId);
  }
  return blockers;
}
