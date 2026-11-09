import { lineKind, type ReceivingReview } from "./receiving-review";
import { pendingOrderResolutions, receivedLineQuantity, resolutionBlockers } from "./receiving-resolution";

/** Completion follows posted receipts, not a document checkbox cleared by later edits.
 * This is a display decision only; it never posts or approves a receipt. */
export function receivingReviewComplete(review: ReceivingReview | null | undefined, versionId: string | null | undefined) {
  if (!review || !review.lines.length || review.versionId !== versionId ||
      !review.kindConfirmed || !review.orderConfirmed || review.retiredBy ||
      review.duplicateDecision?.action === "supporting" || pendingOrderResolutions(review)) return false;
  const active = review.lines.filter(line => !line.ignored);
  if (!active.length) return review.documentChecked === true;
  return active.every(line => !!line.approved &&
    line.approved.itemId === line.orderItemId &&
    line.approved.quantity === receivedLineQuantity(line) &&
    line.approved.kind === lineKind(line, review.kind) &&
    line.checked !== false && (!review.sourceTrial || line.checked === true) &&
    (!line.resolution?.materialIssue || resolutionBlockers(line, undefined, review.lines, review.kind).length === 0));
}
