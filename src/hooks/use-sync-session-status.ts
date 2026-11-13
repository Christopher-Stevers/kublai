"use client";
import { useSyncExternalStore } from "react";
import { getSyncSessionStatus, subscribeSyncSession } from "~/lib/sync-session";
import type { ReplicacheSyncStatus } from "./use-replicache-material-list";

export function useSyncSessionStatus(status: ReplicacheSyncStatus) {
  const session = useSyncExternalStore(subscribeSyncSession, getSyncSessionStatus, () => "ready" as const);
  return session === "ready" ? status : session === "refreshing" ? "syncing" : session;
}
export function syncStatusLabel(status: ReturnType<typeof useSyncSessionStatus>) {
  return status === "sign-in-required" ? "Sign in again to sync"
    : status === "connection-error" ? "Sync couldn’t finish"
    : status === "syncing" ? "Syncing" : status === "pending" ? "Pending sync" : "Synced";
}
