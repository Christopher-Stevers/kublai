import { lineKind, type ReceivingReview } from "./receiving-review";
import type { ReceiptOrderItem } from "./packing-slip-review";
import { pendingOrderResolutions, receivedLineQuantity, receivingLineReady, resolutionBlockers } from "./receiving-resolution";

/** Keep human checks separate from checked lines waiting for receipt approval. */
export function receivingProgress(review: ReceivingReview, items: ReceiptOrderItem[]) {
  const active = review.lines.filter(line => !line.ignored);
  const ready = active.filter(line => receivingLineReady(line, review.kind, items.find(i => i.id === line.orderItemId), review.lines));
  const readyIds = new Set(ready.map(line => line.id));
  const unresolved = active.filter(line => !readyIds.has(line.id) && (
    !line.approved || line.approved.itemId !== line.orderItemId ||
    line.approved.quantity !== receivedLineQuantity(line) ||
    line.approved.kind !== lineKind(line, review.kind) ||
    line.checked === false || (!!review.sourceTrial && line.checked !== true) ||
    (!!line.resolution?.materialIssue && resolutionBlockers(line, items.find(i => i.id === line.orderItemId), review.lines, review.kind).length > 0)
  ));
  const toReview = unresolved.length + pendingOrderResolutions(review);
  return { active: active.length, ready, toReview, pending: ready.length + toReview, approved: active.length - ready.length - unresolved.length };
}
