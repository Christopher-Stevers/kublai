import { materialOrderReference } from "./order-number";
import { renameLinkedSlip } from "./documents/packing-slips";
import type { DocumentState } from "./documents/types";

export type NumberedOrder = {
  id: string;
  jobId: string;
  orderNumber: string | null;
  supplierName: string | null;
  createdAt: Date | string;
};
export type OrderRenumbering = { id: string; jobId: string; before: string | null; after: string };

/** Oldest first, with the old sequence breaking ties in imported timestamps. */
export function planOrderRenumbering(orders: NumberedOrder[]): OrderRenumbering[] {
  const sequence = (value: string | null) => Number(value?.match(/^(?:ORDER-|PO-)?(\d{1,9})(?:-|$)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...orders].sort((a, b) => a.jobId.localeCompare(b.jobId)
    || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    || sequence(a.orderNumber) - sequence(b.orderNumber) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  return sorted.map(order => {
    const n = (counts.get(order.jobId) ?? 0) + 1;
    counts.set(order.jobId, n);
    return {id: order.id, jobId: order.jobId, before: order.orderNumber,
      after: materialOrderReference(n, order.supplierName ?? "Supplier")};
  });
}

/** Update current references by stable order ID. Original file bytes, old
 * versions, receipt quantities, approval state and audit records are retained. */
export function renumberDocumentLinks(state: DocumentState, plan: OrderRenumbering[], now: string) {
  const byId = new Map(plan.map(row => [row.id, row]));
  const changed = state.documents.filter(doc => {
    const target = doc.packingSlip && byId.get(doc.packingSlip.orderId);
    return target && doc.packingSlip!.orderNumber !== target.after;
  });
  const generated = changed.filter(doc => /^Packing slip(?: -| for )/i.test(doc.name)
    && state.versions.some(v => v.id === doc.currentVersionId && /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(v.mimeType)));
  // Release old generated names before assigning new ones, including swaps.
  for (const doc of generated) doc.name = `Renumbering ${doc.id}`;
  for (const doc of changed) {
    const link = doc.packingSlip!;
    const target = byId.get(link.orderId)!;
    const old = link.orderNumber;
    link.orderNumber = target.after;
    if (doc.description.startsWith(`Packing slip for ${old}`))
      doc.description = `Packing slip for ${target.after}${doc.description.slice(`Packing slip for ${old}`.length)}`;
    if (generated.includes(doc)) renameLinkedSlip(state, doc, link);
    doc.updatedAt = now;
  }
  // Detection candidates cache current display references alongside order IDs.
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    const id = row.orderId ?? row.id;
    const target = typeof id === "string" ? byId.get(id) : undefined;
    if (target && typeof row.orderNumber === "string") row.orderNumber = target.after;
    Object.values(row).forEach(visit);
  }
  state.documents.forEach(visit);
  return changed.length;
}
