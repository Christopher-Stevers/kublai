export type ReceiptOrderItem = {
  id: string;
  description: string;
  sku: string | null;
  aliases: string[];
  ordered: number;
  received: number;
  verificationStatus: string;
  unit: string;
  piecesPerPack: number | null;
  individualUnit: string | null;
};
export type SlipLine = {
  page: number;
  evidence: string;
  orderItemId: string | null;
  shipped: number | null;
  backordered: number | null;
  unit: string | null;
  proposed: number | null;
  issues: string[];
};
export type SlipAnalysis = {
  runId: string;
  versionId: string;
  status: "processing" | "ready" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
  model?: string;
  items: ReceiptOrderItem[];
  lines: SlipLine[];
  warnings: string[];
  applied?: { at: string; by: string; quantities: Record<string, number> };
};
export function receiptUnit(unit: string | null | undefined) {
  const s = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  const groups: Record<string, string> = {
    each: "ea",
    pcs: "ea",
    pc: "ea",
    piece: "ea",
    pieces: "ea",
    feet: "ft",
    foot: "ft",
    inches: "in",
    inch: "in",
    boxes: "box",
    bx: "box",
    packs: "pack",
    pk: "pack",
    coils: "coil",
    rolls: "roll",
    lengths: "length",
    bags: "bag",
  };
  return groups[s] ?? s;
}
export function convertSlipQuantity(
  quantity: number,
  unit: string | null,
  item: ReceiptOrderItem,
) {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999)
    return null;
  const from = receiptUnit(unit),
    to = receiptUnit(item.unit);
  if (!from || !to) return null;
  if (from === to) return quantity;
  if (
    item.piecesPerPack &&
    item.piecesPerPack > 1 &&
    ["ea", "each"].includes((unit ?? "").toLowerCase())
  )
    return null;
  if (
    item.piecesPerPack &&
    item.piecesPerPack > 1 &&
    from === receiptUnit(item.individualUnit)
  )
    return Math.round((quantity / item.piecesPerPack) * 1e6) / 1e6;
  return null;
}
export function proposedReceipts(analysis: SlipAnalysis) {
  const amounts: Record<string, number> = {};
  for (const line of analysis.lines)
    if (line.orderItemId && line.proposed !== null)
      amounts[line.orderItemId] =
        Math.round(((amounts[line.orderItemId] ?? 0) + line.proposed) * 1e6) /
        1e6;
  return amounts;
}
export function receiptIssues(
  item: ReceiptOrderItem,
  quantity: number | undefined,
) {
  if (quantity === undefined)
    return ["Not confidently identified on this slip."];
  const total = item.received + quantity;
  if (total > item.ordered + 1e-6)
    return [
      `Exceeds order by ${Math.round((total - item.ordered) * 1e6) / 1e6} ${item.unit}.`,
    ];
  if (total < item.ordered - 1e-6)
    return [
      `${Math.round((item.ordered - total) * 1e6) / 1e6} ${item.unit} would still be outstanding.`,
    ];
  return [];
}
