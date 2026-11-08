import type { SlipBox, ReceiptOrderItem } from "~/lib/packing-slip-review";
import { readTerraFallback } from "./terra-fallback";

/** Read one full-width row, retaining column headings as context. */
export async function detectSelectedLine(pages: Buffer[], page: number, box: SlipBox, orderId: string, item: ReceiptOrderItem) {
  if (!pages[page - 1]) throw Error("That page is not available.");
  const band = { x: 0, y: box.y, width: 1, height: box.height };
  const result = await readTerraFallback(pages, {
    orders: [{ id: orderId, orderNumber: "Selected order", supplier: null, items: [item] }],
    linkedOrderId: orderId, candidatePoolComplete: false,
    reasons: ["Reviewer selected one printed row. Read only this row; do not invent quantities from the order."],
    targetLineIndexes: [0],
    headers: [{ page, box: { x: 0, y: 0, width: 1, height: Math.min(0.18, box.y || 0.18) } }],
    earlierLines: [{ page, box: band, evidence: "Reviewer selected area", orderItemId: null, shipped: null, backordered: null, unit: null, issues: [] }],
  });
  const candidates = result.output.lines.filter(l => l.page === page &&
    l.box.y < band.y + band.height && l.box.y + l.box.height > band.y);
  if (candidates.length !== 1) throw Error(candidates.length ? "More than one line was found. Select a smaller area." : "No line was found in that area. Adjust the box and try again.");
  return { line: candidates[0]!, band };
}
