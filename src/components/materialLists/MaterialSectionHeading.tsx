/** Divides a material list into ordered parts and parts not ordered yet. */
export function MaterialSectionHeading({
  label,
  count,
  className = "",
}: {
  label: string;
  count: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <h2 className="text-sm font-semibold">{label}</h2>
      <span className="text-muted-foreground text-xs">
        {count} {count === 1 ? "part" : "parts"}
      </span>
      <div className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

/** Ordered parts first, then the rest; one unlabelled group when nothing is ordered. */
export function materialSections<T extends { sentOrderItemId?: string | null }>(
  items: T[],
) {
  const ordered = items.filter((item) => item.sentOrderItemId);
  if (!ordered.length) return [{ key: "all", label: null, items }];
  const notOrdered = items.filter((item) => !item.sentOrderItemId);
  return [
    { key: "ordered", label: "Ordered", items: ordered },
    ...(notOrdered.length
      ? [{ key: "not-ordered", label: "Not ordered", items: notOrdered }]
      : []),
  ];
}
