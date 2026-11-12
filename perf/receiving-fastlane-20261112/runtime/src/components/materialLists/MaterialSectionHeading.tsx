import Link from "next/link";
import { orderStillWaiting, type WaitingItem } from "~/lib/order-waiting";
import { OrderWaitingWarning } from "./OrderWaitingWarning";

/** Divides a material list into its orders and the parts not ordered yet. */
export function MaterialSectionHeading({
  label,
  detail,
  href,
  count,
  orderId,
  sectionKey,
  waiting,
  className = "",
}: {
  label: string;
  detail?: string | null;
  href?: string;
  count: number;
  /** The open order under this heading; the list swaps in its receiving bar
   * once the heading scrolls up. */
  orderId?: string;
  sectionKey?: string;
  /** What the order still waits for once receiving has begun. */
  waiting?: WaitingItem[];
  className?: string;
}) {
  return (
    <div
      data-section-heading={orderId ?? ""}
      data-material-section={sectionKey}
      className={`flex items-center gap-3 ${className}`}
    >
      <h2 className="text-sm font-semibold">
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </h2>
      {waiting && (
        <OrderWaitingWarning className="-my-1 -ml-2" items={waiting} />
      )}
      {detail && (
        <span className="text-muted-foreground text-xs">{detail}</span>
      )}
      <span className="text-muted-foreground text-xs">
        {count} {count === 1 ? "part" : "parts"}
      </span>
      <div className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

type SectionItem = {
  sentOrderItemId?: string | null;
  sentOrder?: {
    id: string;
    number: string | null;
    status: string;
    quantity?: string | number | null;
    receivedQuantity?: string | number | null;
  } | null;
  descriptionSnapshot?: string | null;
  partDefinition?: { displayName?: string | null } | null;
  supplierPart?: { supplier?: { name: string } | null } | null;
};
export type MaterialSection<T> = {
  key: string;
  label: string | null;
  detail?: string | null;
  href?: string;
  ordered: boolean;
  /** Outstanding quantities are only back ordered after receiving has begun. */
  hasReceivedItems?: boolean;
  /** Parts on this list the order still waits for, once receiving began. */
  waiting?: WaitingItem[];
  /** The order these parts were sent on, when it is still open. */
  orderId?: string;
  items: T[];
};

/** The parts not ordered yet, then one group per order in the order they
 * first appear; one unlabelled group when nothing is ordered. */
export function materialSections<T extends SectionItem>(
  items: T[],
  materialListId: string,
): MaterialSection<T>[] {
  if (!items.some((item) => item.sentOrderItemId))
    return [{ key: "all", label: null, ordered: false, items }];
  const orders = new Map<string, MaterialSection<T>>();
  const notOrdered: T[] = [];
  for (const item of items) {
    if (!item.sentOrderItemId) {
      notOrdered.push(item);
      continue;
    }
    const order = item.sentOrder;
    const key = order ? `order:${order.id}` : "ordered";
    let section = orders.get(key);
    if (!section) {
      const supplier = item.supplierPart?.supplier?.name;
      section = {
        key,
        label: order ? (order.number ?? "Order") : "Ordered",
        detail:
          [supplier, order?.status === "cancelled" ? "Cancelled" : null]
            .filter(Boolean)
            .join(" · ") || null,
        href: order
          ? `/jobs/material-lists/${materialListId}?orderId=${encodeURIComponent(order.id)}`
          : undefined,
        ordered: true,
        orderId: order && order.status !== "cancelled" ? order.id : undefined,
        items: [],
      };
      orders.set(key, section);
    }
    section.items.push(item);
    if (order?.status !== "cancelled" && Number(order?.receivedQuantity) > 0) {
      section.hasReceivedItems = true;
    }
  }
  for (const section of orders.values()) {
    if (!section.hasReceivedItems) continue;
    const waiting = orderStillWaiting(
      section.items.flatMap((item) =>
        item.sentOrder?.quantity != null
          ? [
              {
                description:
                  item.partDefinition?.displayName ??
                  item.descriptionSnapshot ??
                  "Part",
                ordered: Number(item.sentOrder.quantity),
                received: Number(item.sentOrder.receivedQuantity ?? 0),
              },
            ]
          : [],
      ),
    );
    if (waiting.length) section.waiting = waiting;
  }
  return [
    ...(notOrdered.length
      ? [
          {
            key: "not-ordered",
            label: "Not ordered",
            ordered: false,
            items: notOrdered,
          },
        ]
      : []),
    ...orders.values(),
  ];
}

/** Saved extended prices include packaging and order-time pricing. */
export function materialSectionTotal(items: readonly { extendedPrice?: string | number | null; quantity: string | number; unitCost?: string | number | null }[]) {
  return items.reduce((sum, item) => {
    const extended = item.extendedPrice == null || item.extendedPrice === "" ? NaN : Number(item.extendedPrice);
    if (Number.isFinite(extended)) return sum + extended;
    const quantity = Number(item.quantity), cost = Number(item.unitCost ?? 0);
    return sum + (Number.isFinite(quantity) && Number.isFinite(cost) ? quantity * cost : 0);
  }, 0);
}
