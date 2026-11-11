import {
  RECEIVING_READING_MAX_LINES,
  RECEIVING_READING_ENTRY_BUDGET,
} from "./tier-one-cache-budget";
export const RECEIVING_READING_NAMESPACE = "receiving-order:";
export type ReceivingOrderReading = {
  version: 1;
  orderId: string;
  materialListId: string;
  jobId: string;
  orderNumber: string | null;
  supplierName: string | null;
  savedAt: number;
  totalLines: number;
  lines: {
    id: string;
    description: string | null;
    sku: string | null;
    ordered: string;
  }[];
};
type Order = {
  id: string;
  jobId?: string | null;
  materialListId: string | null;
  orderNumber: string | null;
  supplier: { name: string } | null;
  items: {
    id: string;
    descriptionSnapshot: string | null;
    supplierSkuSnapshot: string | null;
    quantity: string;
  }[];
};
export function makeReceivingOrderReading(
  order: Order,
  jobId: string,
): ReceivingOrderReading | null {
  if (!jobId || order.jobId !== jobId || !order.materialListId) return null;
  const value: ReceivingOrderReading = {
    version: 1,
    orderId: order.id,
    materialListId: order.materialListId,
    jobId: order.jobId,
    orderNumber: order.orderNumber,
    supplierName: order.supplier?.name ?? null,
    savedAt: Date.now(),
    totalLines: order.items.length,
    lines: order.items.slice(0, RECEIVING_READING_MAX_LINES).map((row) => ({
      id: row.id,
      description: row.descriptionSnapshot,
      sku: row.supplierSkuSnapshot,
      ordered: row.quantity,
    })),
  };
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    RECEIVING_READING_ENTRY_BUDGET
    ? value
    : null;
}
export function isReceivingOrderReading(
  value: unknown,
  scope: { orderId: string; materialListId: string; jobId: string },
): value is ReceivingOrderReading {
  if (!value || typeof value !== "object") return false;
  const row = value as ReceivingOrderReading;
  const allowed = [
    "version",
    "orderId",
    "materialListId",
    "jobId",
    "orderNumber",
    "supplierName",
    "savedAt",
    "totalLines",
    "lines",
  ];
  return (
    Object.keys(row).every((key) => allowed.includes(key)) &&
    row.version === 1 &&
    row.orderId === scope.orderId &&
    row.materialListId === scope.materialListId &&
    row.jobId === scope.jobId &&
    (row.orderNumber === null || typeof row.orderNumber === "string") &&
    (row.supplierName === null || typeof row.supplierName === "string") &&
    Number.isFinite(row.savedAt) &&
    Number.isInteger(row.totalLines) &&
    row.totalLines >= 0 &&
    Array.isArray(row.lines) &&
    row.lines.length <= RECEIVING_READING_MAX_LINES &&
    row.lines.length <= row.totalLines &&
    row.lines.every(
      (line) =>
        line &&
        typeof line === "object" &&
        Object.keys(line).every((key) =>
          ["id", "description", "sku", "ordered"].includes(key),
        ) &&
        typeof line.id === "string" &&
        typeof line.ordered === "string" &&
        (line.description === null || typeof line.description === "string") &&
        (line.sku === null || typeof line.sku === "string"),
    ) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      RECEIVING_READING_ENTRY_BUDGET
  );
}

export const RECEIVING_ACCOUNT_CHANGED_MESSAGE =
  "The account changed. Reopen this order.";
/** Exact read operation contract, not a blanket interpretation of CONFLICT. */
export function isReceivingAccountMismatch(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    message?: unknown;
    code?: unknown;
    data?: { code?: unknown };
    shape?: { data?: { code?: unknown } };
  };
  return (
    value.message === RECEIVING_ACCOUNT_CHANGED_MESSAGE &&
    (value.data?.code ?? value.shape?.data?.code ?? value.code) === "CONFLICT"
  );
}
