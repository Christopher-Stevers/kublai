"use client";
import { useCallback } from "react";
import type { DrawingOfflineStore } from "~/lib/drawing-offline";
import { isDeviceReadDenial } from "~/lib/device-query-cache";
import {
  readCurrentRoomFloorSnapshot,
  readRoomFloorSnapshot,
  roomFloorKey,
} from "~/lib/room-snapshots";
import type { RouterOutputs } from "~/trpc/react";
import { useDrawingSnapshot } from "./useDrawingSnapshot";

type Floor = RouterOutputs["rooms"]["getFloorRooms"];
/** Only the selected floor is read; online recovery never loads legacy all-floor data. */
export function useRoomFloorSnapshot(
  jobId: string,
  floorId: string | null,
  live: Floor | undefined,
  error: unknown,
  online: boolean,
) {
  const read = useCallback(
    (store: DrawingOfflineStore, key: string) => {
      if (!floorId) return Promise.resolve(null);
      return online
        ? readCurrentRoomFloorSnapshot(store, key)
        : readRoomFloorSnapshot(store, key);
    },
    [floorId, online],
  );
  return useDrawingSnapshot(roomFloorKey(jobId, floorId ?? ""), live, read, {
    localFirst: Boolean(floorId),
    accessRevoked: isDeviceReadDenial(error),
  });
}
