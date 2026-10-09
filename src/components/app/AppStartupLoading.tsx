import Image from "next/image";

import { Skeleton } from "~/components/ui/skeleton";
import { APP_NAME } from "~/constants/app";

function JobCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <Skeleton className="h-6 w-2/3" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-3 h-4 w-full" />
      </div>
    </div>
  );
}

// Mirrors the dashboard header and job grid so the first paint does not jump.
export function AppStartupLoading() {
  return (
    <div
      data-app-startup-loading
      role="status"
      aria-label="Loading"
      className="min-h-dvh bg-canvas text-foreground"
    >
      <div className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-card px-3 sm:h-16 sm:px-6">
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Image
            src="/foremanhq/icon-dark-v2-32.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          {APP_NAME}
        </div>
        <Skeleton className="h-9 w-9" />
      </div>

      <main className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Skeleton className="h-8 w-40" />
              <Skeleton className="mt-3 h-4 w-64 max-w-[70vw]" />
            </div>
            <Skeleton className="h-11 w-full sm:w-32" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <JobCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
