"use client";

import { useEffect } from "react";
import { useOfflineMaterialListSync } from "~/hooks/use-offline-material-list-sync";
import { clearSyncDebugTimeline } from "~/lib/offline-sync-debug-timeline";

export function OfflineSyncBootstrap() {
  useEffect(() => {
    clearSyncDebugTimeline();
  }, []);

  useOfflineMaterialListSync();
  return null;
}
