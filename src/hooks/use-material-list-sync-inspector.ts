"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { idbGetMeta } from "~/lib/offline-indexed-db";
import type { OfflineMaterialListMutation } from "~/lib/offline-material-list-mutations";

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

      return {
        queuedCount: mutations.length,
        queuedForListCount: mutationsForList.length,
        queuedTypes,
        syncing: syncingRows.some((row) => row.id === materialListId),
        activeItemCount: activeRows.length,
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
