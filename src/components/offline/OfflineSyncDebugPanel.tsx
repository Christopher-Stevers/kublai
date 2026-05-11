"use client";

import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  clearSyncDebugTimeline,
  getSyncDebugTimeline,
  SYNC_DEBUG_TIMELINE_EVENT,
  type SyncDebugEvent,
} from "~/lib/offline-sync-debug-timeline";
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
  timeline: SyncDebugEvent[];
  materialLists: Array<{
    id: string;
    updatedAt: string;
    pendingSync: boolean;
    pendingDeletedItemIds: string[];
    itemCount: number;
  }>;
};

const DEBUG_ENABLED = process.env.NODE_ENV !== "production";
const DEBUG_BUNDLE_STAMP = "sync-debug-dev-2026-05-10-2119";
const DEBUG_BUNDLE_LOADED_AT = new Date().toISOString();

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
    timeline: getSyncDebugTimeline(),
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
    window.addEventListener(SYNC_DEBUG_TIMELINE_EVENT, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(OFFLINE_MATERIAL_LIST_SYNC_EVENT, refresh);
      window.removeEventListener(SYNC_DEBUG_TIMELINE_EVENT, refresh);
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
            <div>
              <div className="font-semibold">Offline Sync Debug</div>
              <div className="text-[11px] text-gray-500">Watch the sticky notes move.</div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearSyncDebugTimeline();
                  void loadSnapshot(isOnline).then(setSnapshot);
                }}
              >
                Clear flow
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadSnapshot(isOnline).then(setSnapshot)}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="mb-3 space-y-2 rounded border bg-gray-50 p-2 text-[11px] text-gray-700">
            <div className="grid gap-2 sm:grid-cols-3">
              <div><span className="font-semibold">Online:</span> {snapshot?.isOnline ? "yes" : "no"}</div>
              <div><span className="font-semibold">Outbox:</span> {snapshot?.queue.length ?? 0} sticky note(s)</div>
              <div><span className="font-semibold">Syncing lists:</span> {snapshot?.syncingMaterialListIds.length ?? 0}</div>
            </div>
            <div className="rounded bg-white px-2 py-1 font-mono text-[10px] text-gray-500">
              Bundle: {DEBUG_BUNDLE_STAMP} · loaded {new Date(DEBUG_BUNDLE_LOADED_AT).toLocaleTimeString()}
            </div>
          </div>

          <div className="mb-3 space-y-2">
            <div className="font-semibold">Flow chart</div>
            <div className="space-y-1">
              {(snapshot?.timeline.length ? snapshot.timeline : []).slice(-35).map((event, index, events) => (
                <div key={event.id} className="flex gap-2">
                  <div className="flex w-5 flex-col items-center">
                    <div
                      className={`mt-0.5 h-4 w-4 rounded-full border ${
                        event.status === "success"
                          ? "border-emerald-500 bg-emerald-100"
                          : event.status === "warning"
                            ? "border-amber-500 bg-amber-100"
                            : event.status === "error"
                              ? "border-red-500 bg-red-100"
                              : "border-blue-500 bg-blue-100"
                      }`}
                    />
                    {index < events.length - 1 ? <div className="h-full min-h-3 w-px bg-gray-300" /> : null}
                  </div>
                  <div className="min-w-0 flex-1 rounded border bg-white p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{event.message}</div>
                      <div className="text-[10px] text-gray-400">{new Date(event.at).toLocaleTimeString()}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
                      <span>step: {event.phase}</span>
                      {event.queueLength !== undefined ? <span>outbox: {event.queueLength}</span> : null}
                      {event.materialListId ? <span>list: {event.materialListId.slice(0, 8)}…</span> : null}
                      {event.mutationIds?.length ? <span>notes: {event.mutationIds.length}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
              {!snapshot?.timeline.length ? (
                <div className="rounded border border-dashed p-3 text-gray-500">
                  No sync steps recorded yet. Change a quantity or remove a part and this will fill in live.
                </div>
              ) : null}
            </div>
          </div>

          <details>
            <summary className="cursor-pointer font-semibold">Raw debugger data</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </details>
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
