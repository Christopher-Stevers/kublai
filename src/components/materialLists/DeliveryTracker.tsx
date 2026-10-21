"use client";
import { cn } from "~/lib/utils";
import type { ReceiptOrderItem, SlipAnalysis } from "~/lib/packing-slip-review";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Order-wide receiving progress across every delivery confirmed so far. */
export function DeliveryTracker({
  items,
  slips,
}: {
  items: ReceiptOrderItem[];
  slips: Array<{
    name: string;
    createdAt: string;
    packingSlipAnalysis?: SlipAnalysis;
  }>;
}) {
  const complete = items.filter(
    (i) => i.received >= i.ordered - 1e-6 && i.ordered > 0,
  ).length;
  const progress =
    items.reduce(
      (s, i) => s + (i.ordered > 0 ? Math.min(1, i.received / i.ordered) : 1),
      0,
    ) / Math.max(1, items.length);
  // Backorders as printed on the most recent read slip.
  const latest = [...slips]
    .filter((s) => s.packingSlipAnalysis?.status === "ready")
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0]?.packingSlipAnalysis;
  const backordered = new Map<string, number>();
  for (const line of latest?.lines ?? [])
    if (line.orderItemId && line.backordered)
      backordered.set(
        line.orderItemId,
        (backordered.get(line.orderItemId) ?? 0) + line.backordered,
      );
  const deliveries = slips
    .filter((s) => s.packingSlipAnalysis?.applied)
    .map((s) => ({ name: s.name, ...s.packingSlipAnalysis!.applied! }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer list-none">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium">Order receiving</span>
          <span className="text-muted-foreground text-xs">
            {complete} of {items.length} items fully received ·{" "}
            {deliveries.length}{" "}
            {deliveries.length === 1 ? "delivery" : "deliveries"} confirmed
          </span>
        </span>
        <span
          role="progressbar"
          aria-label="Order received"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="bg-muted mt-2 block h-2 overflow-hidden rounded-full"
        >
          <span
            className="block h-full bg-emerald-500"
            style={{ width: `${progress * 100}%` }}
          />
        </span>
      </summary>
      <ul className="mt-3 divide-y">
        {items.map((item) => {
          const left = round(item.ordered - item.received);
          const back = backordered.get(item.id);
          const [label, tone] =
            left < -1e-6
              ? [
                  `Over by ${-left} ${item.unit}`,
                  "text-red-700 dark:text-red-300",
                ]
              : left <= 1e-6
                ? ["Complete", "text-emerald-700 dark:text-emerald-300"]
                : item.received > 0
                  ? [
                      `${left} ${item.unit} outstanding`,
                      "text-sky-800 dark:text-sky-300",
                    ]
                  : ["Not received", "text-muted-foreground"];
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
            >
              <span className="min-w-0 flex-1">{item.description}</span>
              <span className="text-xs tabular-nums">
                {round(item.received)} / {item.ordered} {item.unit}
              </span>
              <span className={cn("text-xs sm:w-36 sm:text-right", tone)}>
                {label}
              </span>
              {back !== undefined && left > 1e-6 && (
                <span className="w-full text-xs text-sky-800 dark:text-sky-300">
                  {back} backordered on the latest slip
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {deliveries.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium">Deliveries</p>
          <ol className="text-muted-foreground space-y-0.5 text-xs">
            {deliveries.map((d) => (
              <li key={d.at}>
                {new Date(d.at).toLocaleDateString()} · {d.name} ·{" "}
                {Object.keys(d.quantities).length} items received
              </li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
}
