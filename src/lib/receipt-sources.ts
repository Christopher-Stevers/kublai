/** Where an order item's received count came from: the slips that approved
 * receipts for it, and what was counted by hand on the order, which keeps no
 * record of who or when. */
import type { JobDocument } from "~/server/documents/types";
import type { ReceiptOrderItem } from "./packing-slip-review";
import { qtyRound, receiptDelta } from "./receiving-review";

export type SlipReceipt = {
  documentId: string;
  /** Received by this slip's approved lines; returns count against it. */
  quantity: number;
  by: string;
  at: string;
};
export type ItemReceipts = {
  slips: Array<SlipReceipt & { name: string; self: boolean }>;
  /** Received on the order by hand, not from any slip. */
  byHand: number;
};

/** Each slip's receipts, by order item: its approved review lines, or the
 * per-item confirmation of a slip approved before reviews had lines. */
export function slipReceipts(
  documents: Array<
    Pick<JobDocument, "id" | "receivingReview" | "packingSlipAnalysis">
  >,
) {
  const receipts = new Map<string, SlipReceipt[]>();
  const add = (itemId: string, receipt: SlipReceipt) => {
    if (!receipt.quantity) return;
    const list = receipts.get(itemId) ?? [];
    const same = list.find((r) => r.documentId === receipt.documentId);
    if (same) {
      same.quantity = qtyRound(same.quantity + receipt.quantity);
      if (receipt.at > same.at)
        Object.assign(same, { by: receipt.by, at: receipt.at });
    } else receipts.set(itemId, [...list, { ...receipt }]);
  };
  for (const doc of documents) {
    const approved = doc.receivingReview?.lines.filter((l) => l.approved) ?? [];
    for (const { approved: a } of approved)
      add(a!.itemId, {
        documentId: doc.id,
        quantity: receiptDelta(a!.kind, a!.quantity).received,
        by: a!.by,
        at: a!.at,
      });
    const legacy = doc.packingSlipAnalysis?.applied;
    if (!approved.length && legacy)
      for (const [itemId, quantity] of Object.entries(legacy.quantities))
        add(itemId, {
          documentId: doc.id,
          quantity,
          by: legacy.by,
          at: legacy.at,
        });
  }
  return receipts;
}

/** What is still due once a slip's count takes over a hand count of the same
 * parts, instead of adding to it. */
export function dueWithHandCount(
  item: Pick<ReceiptOrderItem, "ordered" | "received">,
  byHand: number,
  got: number,
) {
  const linked = Math.min(Math.max(0, byHand), Math.max(0, got));
  return {
    linked,
    due: Math.max(0, qtyRound(item.ordered - item.received + linked)),
  };
}
