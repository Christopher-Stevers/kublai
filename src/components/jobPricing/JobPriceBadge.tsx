export function JobPriceBadge({ status }: { status?: string }) {
  if (!status) return null;
  const unlisted = status === "unlisted";
  return (
    <span
      data-job-price-status={status}
      className={`inline-flex max-w-full rounded-md px-1.5 py-0.5 text-[11px] leading-snug ${unlisted ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"}`}
    >
      {unlisted
        ? "Not on job price list"
        : status === "estimated"
          ? "On job list · estimated price"
          : status === "confirmed"
            ? "On job list · confirmed price"
            : "On job list · price needed"}
    </span>
  );
}
