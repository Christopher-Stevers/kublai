"use client";

import { useEffect, useState } from "react";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { env } from "~/env";

type DexieCloudSyncState = {
  configured: boolean;
  status: "disabled" | "not-started" | "syncing" | "in-sync" | "error";
  error?: string | null;
};

type DexieCloudRawSyncState = {
  phase?: string;
  error?: { message?: string } | null;
};

export function useDexieCloudSyncState(): DexieCloudSyncState {
  const [rawState, setRawState] = useState<DexieCloudRawSyncState | null>(null);
  const configured = Boolean(env.NEXT_PUBLIC_DEXIE_CLOUD_DATABASE_URL);

  useEffect(() => {
    if (!configured) return;
    const db = getOfflineDexieDb();
    if (!db) return;

    const subscription = db.cloud.syncState.subscribe((state) => {
      setRawState(state as DexieCloudRawSyncState);
    });

    void db.cloud.sync();

    return () => subscription.unsubscribe();
  }, [configured]);

  if (!configured) {
    return { configured: false, status: "disabled" };
  }

  if (!rawState) {
    return { configured: true, status: "not-started" };
  }

  if (rawState.error) {
    return {
      configured: true,
      status: "error",
      error: rawState.error.message ?? "Dexie Cloud sync failed",
    };
  }

  if (rawState.phase === "in-sync") {
    return { configured: true, status: "in-sync" };
  }

  return { configured: true, status: "syncing" };
}
