import { cn } from "~/lib/utils";

/** Placeholder block shown while content loads. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  );
}

/** Page title plus a card of list rows, matching the app's list pages. */
function ListPageSkeleton({
  rows = 5,
  label,
  className,
}: {
  rows?: number;
  /** Announced to screen readers, e.g. "Loading orders". */
  label: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-[70vw]" />
      </div>
      <div className="bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-9 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stacked form-field placeholders for settings-style cards. */
function FormSkeleton({ fields = 4, label }: { fields?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export { Skeleton, ListPageSkeleton, FormSkeleton };
