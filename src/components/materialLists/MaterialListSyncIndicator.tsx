"use client";
import { Loader2Icon, Clock3Icon, CheckCircle2Icon } from "lucide-react";
import type { ReplicacheSyncStatus } from "~/hooks/use-replicache-material-list";
export function MaterialListSyncIndicator({
  status,
}: {
  status: ReplicacheSyncStatus;
}) {
  if (status === "syncing") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 ring-1 ring-blue-200"
        title="Syncing"
        aria-label="Syncing"
      >
        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-orange-900 ring-1 ring-orange-200"
        title="Pending sync"
        aria-label="Pending sync"
      >
        <Clock3Icon className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200"
      title="Synced"
      aria-label="Synced"
    >
      <CheckCircle2Icon className="h-3.5 w-3.5" />
    </span>
  );
}
