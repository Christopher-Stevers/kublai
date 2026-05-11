"use client";

import { useEffect } from "react";
import { useOfflineMaterialListSync } from "~/hooks/use-offline-material-list-sync";
import { cleanupStaleMaterialListSyncFlags } from "~/lib/offline-material-list-mutations";
import { clearSyncDebugTimeline } from "~/lib/offline-sync-debug-timeline";

export function OfflineSyncBootstrap() {
  useEffect(() => {
    clearSyncDebugTimeline();
    void cleanupStaleMaterialListSyncFlags();
  }, []);

  useOfflineMaterialListSync();
  return null;
}
