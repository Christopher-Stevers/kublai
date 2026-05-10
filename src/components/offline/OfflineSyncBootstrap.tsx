"use client";

import { useOfflineMaterialListSync } from "~/hooks/use-offline-material-list-sync";

export function OfflineSyncBootstrap() {
  useOfflineMaterialListSync();
  return null;
}
