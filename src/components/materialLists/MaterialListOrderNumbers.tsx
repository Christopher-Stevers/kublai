import { CheckCircle2Icon } from "lucide-react";
import type { MaterialListOrderStatus } from "~/lib/material-list-order-status";

export function MaterialListOrderNumbers({
  orders,
  numbers,
}: {
  orders?: readonly MaterialListOrderStatus[];
  numbers?: readonly string[];
}) {
  const entries =
    orders ??
    numbers?.map((number) => ({ id: number, number, complete: false })) ??
    [];
  return entries.map((order) => (
    <span
      key={order.id}
      aria-label={`${order.number}: ${order.complete ? "100% complete and verified" : "not fully complete and verified"}`}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium " +
        (order.complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border bg-card text-foreground/80")
      }
    >
      <CheckCircle2Icon className="h-3.5 w-3.5" />
      {order.number}
    </span>
  ));
}
