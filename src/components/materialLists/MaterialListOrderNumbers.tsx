import { materialProgressStyle } from "~/lib/material-progress-style";
import { ShoppingCartIcon } from "lucide-react";
import type { MaterialListOrderStatus } from "~/lib/material-list-order-status";

/** Ordered pills are blue and fill green as items are verified. Until the
 * order is fully verified a thin blue ring stays inside the edge, so even a
 * nearly full pill reads as not done. */
function sentStyle(deliveredPercent: number) {
  return {
    ...materialProgressStyle(deliveredPercent, "blue"),
    boxShadow: "inset 0 0 0 2px rgb(59 130 246 / 0.85)",
  };
}

export function MaterialListOrderNumbers({
  orders,
  numbers,
}: {
  orders?: readonly MaterialListOrderStatus[];
  numbers?: readonly string[];
}) {
  const entries =
    orders ??
    numbers?.map((number) => ({
      id: number,
      number,
      complete: false,
      deliveredPercent: 0,
    })) ??
    [];
  if (entries.length === 0) return null;
  return (
    <div role="group" aria-label="Orders" className="flex items-start gap-2">
      <ShoppingCartIcon aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {entries.map((order) => {
          const state = order.complete
            ? "verified"
            : "state" in order
              ? (order.state ?? "sent")
              : "sent";
          const label =
            state === "verified"
              ? "fully verified"
              : state === "sent"
                ? "sent, awaiting full verification"
                : "not sent";
          return (
            <span
              key={order.id}
              data-order-state={state}
              aria-label={`${order.number}: ${label}`}
              title={`${order.number} · ${label}${
                state === "sent" && order.deliveredPercent > 0
                  ? ` · ${Math.min(99, Math.round(order.deliveredPercent))}% received`
                  : ""
              }`}
              style={
                state === "verified"
                  ? materialProgressStyle(100)
                  : state === "sent"
                    ? sentStyle(order.deliveredPercent)
                    : materialProgressStyle(0)
              }
              className="border-border text-foreground inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium"
            >
              {Array.from(order.number).length > 12
                ? `${Array.from(order.number).slice(0, 11).join("")}…`
                : order.number}
            </span>
          );
        })}
      </div>
    </div>
  );
}
