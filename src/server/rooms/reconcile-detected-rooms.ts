import type { RoomPolygonShape } from "~/lib/room-shape";

export type ReconciledDetectedRoom = {
  name: string;
  shape: RoomPolygonShape;
};

export type ExistingDetectedRoom = {
  id: string;
  name: string;
  source: string;
};

export function planDetectedRoomReconciliation(
  existing: ExistingDetectedRoom[],
  detected: ReconciledDetectedRoom[],
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
      updates.push({ id: autoMatch.id, room });
      continue;
    }
    const manualMatch = existing.some(
      (candidate) =>
        candidate.source !== "auto" && normalize(candidate.name) === name,
    );
    if (!manualMatch) inserts.push(room);
  }

  return {
    updates,
    inserts,
    obsoleteAutoIds: existing
      .filter((room) => room.source === "auto" && !usedAutoIds.has(room.id))
      .map((room) => room.id),
  };
}
