"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { idbGetMeta } from "~/lib/offline-indexed-db";
import {
  ACTIVE_ITEM_SYNC_STATUS_TTL_MS,
  type OfflineMaterialListMutation,
} from "~/lib/offline-material-list-mutations";

const PULL_CURSOR_META_KEY = "material-list-sync-pull-cursor";

type SyncInspectorSnapshot = {
  queuedCount: number;
  queuedForListCount: number;
  queuedTypes: Record<string, number>;
  syncing: boolean;
  activeItemCount: number;
  lastPullCursor: string | null;
  oldestQueuedAt: string | null;
};

export function useMaterialListSyncInspector(materialListId: string) {
  const snapshot = useLiveQuery(
    async (): Promise<SyncInspectorSnapshot | null> => {
      const db = getOfflineDexieDb();
      if (!db) return null;

      const [queueRows, syncingRows, activeRows, lastPullCursor] = await Promise.all([
        db.mutationQueue.orderBy("order").toArray(),
        db.syncingMaterialLists.toArray(),
        db.activeItemSync.where("materialListId").equals(materialListId).toArray(),
        idbGetMeta<string | null>(PULL_CURSOR_META_KEY, null),
      ]);

      const mutations = queueRows.map((row) => row.value as OfflineMaterialListMutation);
      const mutationsForList = mutations.filter(
        (mutation) => mutation.materialListId === materialListId,
      );
      const queuedTypes: Record<string, number> = {};

      for (const mutation of mutationsForList) {
        queuedTypes[mutation.type] = (queuedTypes[mutation.type] ?? 0) + 1;
      }

      const oldestQueuedAt = mutationsForList
        .map((mutation) => mutation.queuedAt)
        .filter(Boolean)
        .sort()[0] ?? null;

      const now = Date.now();
      const freshActiveRows = activeRows.filter(
        (row) =>
          typeof row.updatedAt === "number" &&
          now - row.updatedAt <= ACTIVE_ITEM_SYNC_STATUS_TTL_MS,
      );
      const freshSyncingIds = syncingRows
        .filter((row) => typeof row.updatedAt === "number" && now - row.updatedAt <= 2 * 60 * 1000)
        .map((row) => row.id);

      return {
        queuedCount: mutations.length,
        queuedForListCount: mutationsForList.length,
        queuedTypes,
        // A stale syncing row should never keep the badge spinning after the outbox is empty.
        syncing: mutationsForList.length > 0 && freshSyncingIds.includes(materialListId),
        activeItemCount: freshActiveRows.length,
        lastPullCursor,
        oldestQueuedAt,
      };
    },
    [materialListId],
  ) as SyncInspectorSnapshot | null | undefined;

  return useMemo(
    () =>
      snapshot ?? {
        queuedCount: 0,
        queuedForListCount: 0,
        queuedTypes: {},
        syncing: false,
        activeItemCount: 0,
        lastPullCursor: null,
        oldestQueuedAt: null,
      },
    [snapshot],
  );
}
