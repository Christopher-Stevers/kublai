"use client";

import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getActiveItemSyncStatuses,
  getOfflineMutationQueue,
  getSyncingMaterialListIds,
  OFFLINE_MATERIAL_LIST_SYNC_EVENT,
} from "~/lib/offline-material-list-mutations";
import { getOfflineMaterialList, getOfflineMaterialListIds } from "~/lib/offline-material-list";

type DebugSnapshot = {
  isOnline: boolean;
  queue: Awaited<ReturnType<typeof getOfflineMutationQueue>>;
  syncingMaterialListIds: string[];
  activeItemSyncStatuses: Awaited<ReturnType<typeof getActiveItemSyncStatuses>>;
  materialLists: Array<{
    id: string;
    updatedAt: string;
    pendingSync: boolean;
    pendingDeletedItemIds: string[];
    itemCount: number;
  }>;
};

const DEBUG_ENABLED = process.env.NODE_ENV !== "production";

async function loadSnapshot(isOnline: boolean): Promise<DebugSnapshot> {
  const [queue, syncingMaterialListIds, activeItemSyncStatuses, materialListIds] =
    await Promise.all([
      getOfflineMutationQueue(),
      getSyncingMaterialListIds(),
      getActiveItemSyncStatuses(),
      getOfflineMaterialListIds(),
    ]);

  const materialLists = await Promise.all(
    materialListIds.map(async (id) => {
      const envelope = await getOfflineMaterialList(id);
      return {
        id,
        updatedAt: envelope?.updatedAt ?? "",
        pendingSync: envelope?.pendingSync ?? false,
        pendingDeletedItemIds: envelope?.pendingDeletedItemIds ?? [],
        itemCount: envelope?.data.items.length ?? 0,
      };
    }),
  );

  return {
    isOnline,
    queue,
    syncingMaterialListIds,
    activeItemSyncStatuses,
    materialLists,
  };
}

export function OfflineSyncDebugPanel() {
  const isOnline = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);

  useEffect(() => {
    if (!DEBUG_ENABLED || typeof window === "undefined") return;

    const refresh = () => {
      void loadSnapshot(window.navigator.onLine).then(setSnapshot);
    };

    refresh();
    window.addEventListener(OFFLINE_MATERIAL_LIST_SYNC_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(OFFLINE_MATERIAL_LIST_SYNC_EVENT, refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [isOnline]);

  if (!DEBUG_ENABLED) return null;

  return (
    <div className="fixed right-3 bottom-3 z-50 max-w-[calc(100vw-1.5rem)] text-xs">
      {open && (
        <div className="mb-2 max-h-96 w-[min(36rem,calc(100vw-1.5rem))] overflow-auto rounded-lg border bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold">Offline Sync Debug</div>
            <Button size="sm" variant="outline" onClick={() => void loadSnapshot(isOnline).then(setSnapshot)}>
              Refresh
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </div>
      )}
      <Button
        size="sm"
        variant={snapshot?.queue.length || snapshot?.syncingMaterialListIds.length ? "default" : "outline"}
        onClick={() => setOpen((value) => !value)}
        className="shadow-lg"
      >
        Sync Debug
        {snapshot?.queue.length ? ` (${snapshot.queue.length})` : ""}
      </Button>
    </div>
  );
}
