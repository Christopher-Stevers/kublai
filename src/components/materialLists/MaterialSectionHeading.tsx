import Link from "next/link";

/** Divides a material list into its orders and the parts not ordered yet. */
export function MaterialSectionHeading({
  label,
  detail,
  href,
  count,
  className = "",
}: {
  label: string;
  detail?: string | null;
  href?: string;
  count: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <h2 className="text-sm font-semibold">
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </h2>
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
  sentOrder?: { id: string; number: string | null; status: string } | null;
  supplierPart?: { supplier?: { name: string } | null } | null;
};
export type MaterialSection<T> = {
  key: string;
  label: string | null;
  detail?: string | null;
  href?: string;
  ordered: boolean;
  items: T[];
};

/** One group per order, in the order they first appear, then the parts not
 * ordered yet; one unlabelled group when nothing is ordered. */
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
          ? `/dashboard/material-lists/${materialListId}?orderId=${encodeURIComponent(order.id)}`
          : undefined,
        ordered: true,
        items: [],
      };
      orders.set(key, section);
    }
    section.items.push(item);
  }
  return [
    ...orders.values(),
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
  ];
}
