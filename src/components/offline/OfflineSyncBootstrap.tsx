"use client";

import { useAppOpenSync } from "~/hooks/use-app-open-sync";
import { useOfflineMaterialListSync } from "~/hooks/use-offline-material-list-sync";

export function OfflineSyncBootstrap() {
  useAppOpenSync();
  useOfflineMaterialListSync();
  return null;
}
