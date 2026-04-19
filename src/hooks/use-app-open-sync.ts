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

        await Promise.all(
          getOfflineJobDetailIds().map(async (jobId) => {
            try {
              const [job, materialLists] = await Promise.all([
                utils.client.job.getJob.query({ jobId }),
                utils.client.materialList.listMaterialLists.query({ jobId }),
              ]);

              utils.job.getJob.setData({ jobId }, job);
              utils.materialList.listMaterialLists.setData({ jobId }, materialLists);
              setOfflineJobDetail(jobId, { job, materialLists });
            } catch (error) {
              console.error("Failed to sync cached job detail", jobId, error);
            }
          }),
        );

        await Promise.all(
          getOfflineMaterialListIds().map(async (materialListId) => {
            try {
              const materialList = await utils.client.materialList.getMaterialList.query({ materialListId });
              const cached = getOfflineMaterialList(materialListId);

              utils.materialList.getMaterialList.setData({ materialListId }, materialList);
              setOfflineMaterialList(materialListId, materialList, {
                pendingSync: cached?.pendingSync ?? false,
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

