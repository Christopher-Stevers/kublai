import { materialProgressStyle } from "~/lib/material-progress-style";
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
    numbers?.map((number) => ({
      id: number,
      number,
      complete: false,
      deliveredPercent: 0,
    })) ??
    [];
  return entries.map((order) => (
    <span
      key={order.id}
      aria-label={`${order.number}: ${order.complete ? "100% complete and verified" : "not fully complete and verified"}`}
      title={`${Math.round(order.deliveredPercent ?? 0)}% delivered${order.complete ? " · fully verified" : ""}`}
      style={materialProgressStyle(order.deliveredPercent ?? 0)}
      className="border-border text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium"
    >
      <CheckCircle2Icon className="h-3.5 w-3.5" />
      {order.number}
    </span>
  ));
}
