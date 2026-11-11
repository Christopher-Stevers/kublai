import type { DrawingOfflineStore } from "./drawing-offline";
import type { RouterOutputs } from "~/trpc/react";

type Overview = RouterOutputs["rooms"]["getJobRooms"];
type Floor = RouterOutputs["rooms"]["getFloorRooms"];
type LegacyOverview = Omit<Overview, "floors"> & {
  floors: Array<
    Omit<Overview["floors"][number], "roomCount"> & { roomCount?: number }
  >;
};

export const roomOverviewKey = (jobId: string) => `room-overview:${jobId}`;
export const roomFloorKey = (jobId: string, floorId: string) =>
  `room-floor:${jobId}:${floorId}`;

/** Exact selected-floor read; never expands to a legacy all-floor payload. */
export async function readCurrentRoomFloorSnapshot(
  store: DrawingOfflineStore,
  key: string,
): Promise<Floor | null> {
  const floorId = key.split(":")[2];
  if (!floorId) return null;
  const current = await store.readSnapshot<Floor>(key);
  return current?.id === floorId ? current : null;
}

/** Old explicit downloads stored all floors together. Read them only offline. */
export async function readRoomOverviewSnapshot(
  store: DrawingOfflineStore,
  key: string,
): Promise<Overview | null> {
  const current = await store.readSnapshot<Overview>(key);
  if (current) return current;
  const jobId = key.slice("room-overview:".length);
  const legacy = await store.readSnapshot<LegacyOverview>(
    `room-sheets:${jobId}`,
  );
  if (!legacy) return null;
  return {
    ...legacy,
    floors: legacy.floors.map((floor) => ({
      ...floor,
      roomCount: floor.rooms.filter(
        (room) =>
          room.reviewStatus !== "rejected" &&
          room.reviewStatus !== "superseded",
      ).length,
      rooms: [],
    })),
  };
}

export async function readRoomFloorSnapshot(
  store: DrawingOfflineStore,
  key: string,
): Promise<Floor | null> {
  const current = await store.readSnapshot<Floor>(key);
  if (current) return current;
  const [, jobId, floorId] = key.split(":");
  if (!floorId) return null;
  const legacy = await store.readSnapshot<LegacyOverview>(
    `room-sheets:${jobId}`,
  );
  const floor = legacy?.floors.find((floor) => floor.id === floorId);
  return floor
    ? {
        ...floor,
        rooms: floor.rooms.filter(
          (room) =>
            room.reviewStatus !== "rejected" &&
            room.reviewStatus !== "superseded",
        ),
      }
    : null;
}
