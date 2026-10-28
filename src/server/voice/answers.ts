/** Facts read from the app don't need a small model to invent a counting tool. */
export function inspectionAnswer(
  data: {
    name: unknown;
    totalItems: number;
    status?: unknown;
    notes?: unknown;
    items: Array<Record<string, unknown>>;
  },
  request: string,
) {
  if (!/\b(how many|what|show|status|read|tell|list the)\b/i.test(request))
    return;
  const label = typeof data.name === "string" ? data.name : "This list";
  const intro = `${label} has ${data.totalItems} line item${data.totalItems === 1 ? "" : "s"}.`;
  if (/\bnotes?\b/i.test(request) && typeof data.notes === "string")
    return `${label}: ${data.notes || "No notes recorded."}`.slice(0, 1200);
  if (/\bstatus\b/i.test(request) && typeof data.status === "string")
    return `${label} is ${data.status}. ${intro}`;
  if (
    /\bhow many\b/i.test(request) &&
    !/\b(received|remaining|outstanding|shipped|backordered|pieces)\b/i.test(
      request,
    )
  )
    return intro;
  const lines = data.items.slice(0, 5).map((item) => {
    const name = typeof item.name === "string" ? item.name : "Unnamed item";
    const quantity = Number(item.quantity);
    return `${name}: ${Number.isFinite(quantity) ? quantity : "unclear"} ordered${"receivedQuantity" in item ? `, ${Number(item.receivedQuantity) || 0} received` : ""}`;
  });
  return [
    intro,
    ...lines,
    data.totalItems > 5
      ? "Those are the first five. Open the order or list to see all items."
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);
}
