"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "~/trpc/react";
import {
  getOfflineMutationQueue,
  type OfflineMaterialListMutation,
} from "~/lib/offline-material-list-mutations";
import { getOfflineMaterialList, setOfflineMaterialList } from "~/lib/offline-material-list";

const QUEUE_STORAGE_KEY = "foremanhq.offline.material-list.queue";

function clearQueue() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(QUEUE_STORAGE_KEY);
}

function setQueue(queue: OfflineMaterialListMutation[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export function useOfflineMaterialListSync() {
  const queryClient = useQueryClient();
  const utils = api.useUtils();
  const syncingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = async () => {
      if (syncingRef.current || !window.navigator.onLine) return;

      const queue = getOfflineMutationQueue();
      if (queue.length === 0) return;

      syncingRef.current = true;

      const remaining: OfflineMaterialListMutation[] = [];
      const touchedMaterialLists = new Set<string>();

      try {
        for (const mutation of queue) {
          try {
            switch (mutation.type) {
              case "updateItemQuantity":
                await utils.client.materialList.updateMaterialListItem.mutate({
                  itemId: mutation.itemId,
                  quantity: mutation.quantity,
                });
                touchedMaterialLists.add(mutation.materialListId);
                break;
              case "removeItem":
                await utils.client.materialList.removeMaterialListItem.mutate({
                  itemId: mutation.itemId,
                });
                touchedMaterialLists.add(mutation.materialListId);
                break;
              case "renameMaterialList":
                await utils.client.materialList.updateMaterialListName.mutate({
                  materialListId: mutation.materialListId,
                  name: mutation.name,
                });
                touchedMaterialLists.add(mutation.materialListId);
                break;
            }
          } catch (error) {
            console.error("Failed to replay offline material list mutation", mutation, error);
            remaining.push(mutation);
          }
        }

        if (remaining.length === 0) {
          clearQueue();
        } else {
          setQueue(remaining);
        }

        for (const materialListId of touchedMaterialLists) {
          await queryClient.invalidateQueries({
            queryKey: [["materialList", "getMaterialList"], { input: { materialListId }, type: "query" }],
          });

          const refreshed = await utils.client.materialList.getMaterialList.query({ materialListId });
          const cached = getOfflineMaterialList(materialListId);
          if (refreshed) {
            setOfflineMaterialList(materialListId, refreshed, { pendingSync: false });
          } else if (cached?.data) {
            setOfflineMaterialList(materialListId, cached.data, { pendingSync: remaining.some((item) => item.materialListId === materialListId) });
          }
        }
      } finally {
        syncingRef.current = false;
      }
    };

    void sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [queryClient, utils]);
}
