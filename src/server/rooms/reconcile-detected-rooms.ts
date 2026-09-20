import { toPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import { roomOverlap } from "./supplementary-rooms";

export type ReconciledDetectedRoom = {
  name: string;
  shape: RoomPolygonShape;
};

export type ExistingDetectedRoom = {
  id: string;
  name: string;
  source: string;
  shape?: unknown;
};

export function planDetectedRoomReconciliation(
  existing: ExistingDetectedRoom[],
  detected: ReconciledDetectedRoom[],
  options: { preserveExisting?: boolean } = {},
) {
  const normalize = (value: string) => value.trim().toLowerCase();
  const usedAutoIds = new Set<string>();
  const updates: Array<{ id: string; room: ReconciledDetectedRoom }> = [];
  const inserts: ReconciledDetectedRoom[] = [];

  for (const room of detected) {
    const name = normalize(room.name);
    const autoMatch = existing.find(
      (candidate) =>
        candidate.source === "auto" &&
        !usedAutoIds.has(candidate.id) &&
        normalize(candidate.name) === name,
    );
    if (autoMatch) {
      usedAutoIds.add(autoMatch.id);
      if (!options.preserveExisting) updates.push({ id: autoMatch.id, room });
      continue;
    }
    const manualMatch = existing.some(
      (candidate) =>
        candidate.source !== "auto" && normalize(candidate.name) === name,
    );
    const overlapsSaved =
      options.preserveExisting &&
      existing.some((candidate) => {
        if (!candidate.shape) return false;
        try {
          return (
            roomOverlap(
              room.shape,
              toPolygon(candidate.shape as Parameters<typeof toPolygon>[0]),
            ) > 1e-10
          );
        } catch {
          return true;
        }
      });
    const repeatedAddition =
      options.preserveExisting &&
      inserts.some(
        (candidate) =>
          normalize(candidate.name) === name ||
          roomOverlap(candidate.shape, room.shape) > 1e-10,
      );
    if (!manualMatch && !overlapsSaved && !repeatedAddition) inserts.push(room);
  }

  return {
    updates,
    inserts,
    obsoleteAutoIds: options.preserveExisting
      ? []
      : existing
          .filter((room) => room.source === "auto" && !usedAutoIds.has(room.id))
          .map((room) => room.id),
  };
}
