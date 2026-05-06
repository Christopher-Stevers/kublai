"use client";

import { useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import {
  getOfflineCatalogueSnapshot,
  setOfflineCatalogueSnapshot,
} from "~/lib/offline-catalogue";
import { getOfflineJobDetailIds, setOfflineJobDetail, setOfflineJobsList } from "~/lib/offline-jobs";
import {
  getOfflineMaterialList,
  getOfflineMaterialListIds,
  setOfflineMaterialList,
} from "~/lib/offline-material-list";
import { getOfflineMutationQueue } from "~/lib/offline-material-list-mutations";

const MIN_SYNC_INTERVAL_MS = 30_000;

export function useAppOpenSync() {
  const utils = api.useUtils();
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = async () => {
      if (syncingRef.current || !window.navigator.onLine) return;

      const now = Date.now();
      if (now - lastSyncAtRef.current < MIN_SYNC_INTERVAL_MS) return;

      syncingRef.current = true;
      lastSyncAtRef.current = now;

      try {
        const [jobs, catalogs, materials, categories, allUnits, parts] = await Promise.all([
          utils.client.job.listJobs.query(),
          utils.client.catalogue.getCatalogs.query(),
          utils.client.catalogue.getMaterials.query(),
          utils.client.catalogue.getCategoryTree.query(),
          utils.client.catalogue.getAllUnits.query(),
          utils.client.catalogue.searchParts.query({}),
        ]);

        utils.job.listJobs.setData(undefined, jobs);
        utils.catalogue.getCatalogs.setData(undefined, catalogs);
        utils.catalogue.getMaterials.setData(undefined, materials);
        utils.catalogue.getCategoryTree.setData(undefined, categories);
        utils.catalogue.getAllUnits.setData(undefined, allUnits);
        utils.catalogue.searchParts.setData({}, parts);

        setOfflineJobsList(jobs);
        setOfflineCatalogueSnapshot({
          catalogs,
          materials,
          categories,
          allUnits,
          parts,
        });

        const jobIdsToCache = Array.from(
          new Set([...jobs.map((job) => job.id), ...getOfflineJobDetailIds()]),
        );
        const materialListIdsToCache = new Set<string>();

        for (const jobId of jobIdsToCache) {
          try {
            const job = await utils.client.job.getJob.query({ jobId });
            const materialLists = await utils.client.materialList.listMaterialLists.query({ jobId });

            for (const materialList of materialLists) {
              materialListIdsToCache.add(materialList.id);
            }

            utils.job.getJob.setData({ jobId }, job);
            utils.materialList.listMaterialLists.setData({ jobId }, materialLists);
            setOfflineJobDetail(jobId, { job, materialLists }, { notify: false });
          } catch (error) {
            console.error("Failed to sync cached job detail", jobId, error);
          }
        }

        const materialListIds = Array.from(
          new Set([...Array.from(materialListIdsToCache), ...(await getOfflineMaterialListIds())]),
        );
        await Promise.all(
          materialListIds.map(async (materialListId) => {
            try {
              const materialList = await utils.client.materialList.getMaterialList.query({ materialListId });
              const cached = await getOfflineMaterialList(materialListId);

              if (cached?.pendingSync && cached.data) {
                const queue = await getOfflineMutationQueue();
                const hasQueuedChangesForList = queue.some(
                  (mutation) => mutation.materialListId === materialListId,
                );
                const hasPendingDeletedItems =
                  (cached.pendingDeletedItemIds?.length ?? 0) > 0;

                if (!hasQueuedChangesForList && !hasPendingDeletedItems) {
                  utils.materialList.getMaterialList.setData({ materialListId }, materialList);
                  await setOfflineMaterialList(materialListId, materialList, {
                    pendingSync: false,
                  });
                  return;
                }

                utils.materialList.getMaterialList.setData(
                  { materialListId },
                  cached.data as typeof materialList,
                );
                return;
              }

              utils.materialList.getMaterialList.setData({ materialListId }, materialList);
              await setOfflineMaterialList(materialListId, materialList, {
                pendingSync: false,
              });
            } catch (error) {
              console.error("Failed to sync cached material list", materialListId, error);
            }
          }),
        );
      } catch (error) {
        const lastCatalogueSync = getOfflineCatalogueSnapshot();
        console.error("Failed to perform app-open sync", {
          error,
          lastCatalogueSyncAt: lastCatalogueSync?.updatedAt ?? null,
        });
      } finally {
        syncingRef.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void sync();
      }
    };

    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [utils]);
}
