import { materialProgressStyle } from "~/lib/material-progress-style";
import { CheckCircle2Icon, Clock3Icon, SendIcon } from "lucide-react";
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
  return entries.map((order) => {
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
    const Icon =
      state === "verified"
        ? CheckCircle2Icon
        : state === "sent"
          ? SendIcon
          : Clock3Icon;
    return (
      <span
        key={order.id}
        data-order-state={state}
        aria-label={`${order.number}: ${label}`}
        title={`${order.number} · ${label}`}
        style={materialProgressStyle(
          state === "verified" ? 100 : state === "sent" ? 50 : 0,
        )}
        className="border-border text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium"
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {order.number}
      </span>
    );
  });
}
