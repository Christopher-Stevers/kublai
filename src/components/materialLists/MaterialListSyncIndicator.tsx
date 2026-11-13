"use client";
import { Loader2Icon, Clock3Icon, CheckCircle2Icon } from "lucide-react";
import type { ReplicacheSyncStatus } from "~/hooks/use-replicache-material-list";
import { syncStatusLabel, useSyncSessionStatus } from "~/hooks/use-sync-session-status";
import { AlertCircleIcon } from "lucide-react";
export function MaterialListSyncIndicator({
  status: itemStatus,
}: {
  status: ReplicacheSyncStatus;
}) {
  const status = useSyncSessionStatus(itemStatus);
  if (status === "sign-in-required" || status === "connection-error") return <span
    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-900 ring-1 ring-amber-200"
    title={syncStatusLabel(status)} aria-label={syncStatusLabel(status)}
  ><AlertCircleIcon className="h-3.5 w-3.5" /></span>;
  if (status === "syncing") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20"
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
