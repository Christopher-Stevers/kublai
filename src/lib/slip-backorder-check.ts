import { receivingQuantity } from "./receiving-quantity-display";

/** Compare printed columns in their original unit, before any pack conversion. */
export function slipBackorderCheck(row: {
  ordered: number | null | undefined;
  shipped: number | null | undefined;
  backordered?: number | null;
  unit?: string | null;
}) {
  const { ordered, shipped, backordered } = row;
  if (ordered == null || shipped == null || !Number.isFinite(ordered) ||
      !Number.isFinite(shipped) || shipped < 0 || ordered <= shipped) return null;
  const shortage = Math.round((ordered - shipped) * 1e6) / 1e6;
  const quantity = (n: number) => receivingQuantity(n, row.unit ?? "");
  if (backordered == null || !Number.isFinite(backordered)) return {
    ok: false,
    label: `${quantity(shortage)} short — BO quantity not found or unreadable. Check the slip.`,
  };
  if (Math.abs(shortage - backordered) < 1e-6) return {
    ok: true,
    label: `BO ${quantity(backordered)} accounts for the shortage.`,
  };
  return { ok: false,
    label: `BO mismatch: ${quantity(shortage)} short, but the slip shows BO ${quantity(backordered)}. Check with the supplier.`,
  };
}
