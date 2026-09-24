import { toPolygon, type RoomPolygonShape } from "~/lib/room-shape";
import { roomArea, roomOverlap } from "./supplementary-rooms";

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

/**
 * Two outlines describe the same room when they share at least this share of
 * the smaller one. Neighbours that only touch along a traced wall stay apart.
 */
const SAME_ROOM_OVERLAP = 0.3;

/** Shared area as a fraction of the smaller room (0 when either is empty). */
export function overlapShare(a: RoomPolygonShape, b: RoomPolygonShape) {
  const smaller = Math.min(roomArea(a), roomArea(b));
  if (smaller <= 0) return 0;
  const shared = roomOverlap(a, b);
  // Unmeasurable topology counts as the same room, so it is never duplicated.
  return Number.isFinite(shared) ? shared / smaller : 1;
}

function savedShape(room: ExistingDetectedRoom): RoomPolygonShape | null {
  if (!room.shape) return null;
  try {
    return toPolygon(room.shape as Parameters<typeof toPolygon>[0]);
  } catch {
    return null;
  }
}

/**
 * Matches detected rooms to saved rooms by location first. A name only
 * identifies a room when it is unique on both sides (e.g. "N201", "W/C 301");
 * plans often label many units with the same type name ("2 BEDROOM"), and
 * every one of those is a separate room.
 */
export function planDetectedRoomReconciliation(
  existing: ExistingDetectedRoom[],
  detected: ReconciledDetectedRoom[],
  options: { preserveExisting?: boolean } = {},
) {
  const normalize = (value: string) => value.trim().toLowerCase();
  const usedAutoIds = new Set<string>();
  const updates: Array<{ id: string; room: ReconciledDetectedRoom }> = [];
  const inserts: ReconciledDetectedRoom[] = [];
  const shapes = new Map(existing.map((room) => [room.id, savedShape(room)]));
  const countNames = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };
  const detectedNames = countNames(detected.map((room) => normalize(room.name)));
  const existingNames = countNames(existing.map((room) => normalize(room.name)));
  const isUniqueName = (name: string) =>
    detectedNames.get(name) === 1 && existingNames.get(name) === 1;

  const claim = (match: ExistingDetectedRoom, room: ReconciledDetectedRoom) => {
    // Refresh auto traces; manual rooms are never touched.
    if (match.source !== "auto") return;
    usedAutoIds.add(match.id);
    if (!options.preserveExisting) updates.push({ id: match.id, room });
  };

  for (const room of detected) {
    const name = normalize(room.name);
    const available = existing.filter(
      (candidate) => !usedAutoIds.has(candidate.id),
    );

    // 1. A unique name ("N201") is the same room even if it was moved by hand.
    const uniqueNameMatch = isUniqueName(name)
      ? available.find((candidate) => normalize(candidate.name) === name)
      : undefined;
    if (uniqueNameMatch) {
      claim(uniqueNameMatch, room);
      continue;
    }

    // 2. Otherwise, the saved room occupying the same place.
    let best: { room: ExistingDetectedRoom; share: number } | null = null;
    for (const candidate of available) {
      const shape = shapes.get(candidate.id);
      const share = shape ? overlapShare(room.shape, shape) : 0;
      if (share >= SAME_ROOM_OVERLAP && share > (best?.share ?? 0)) {
        best = { room: candidate, share };
      }
    }
    if (best) {
      claim(best.room, room);
      continue;
    }

    // 3. Saved rooms without an outline can only be matched by name.
    const unshapedMatch = available.find(
      (candidate) =>
        !shapes.get(candidate.id) && normalize(candidate.name) === name,
    );
    if (unshapedMatch) {
      claim(unshapedMatch, room);
      continue;
    }

    const repeatsInsert = inserts.some(
      (candidate) =>
        overlapShare(candidate.shape, room.shape) >= SAME_ROOM_OVERLAP,
    );
    if (!repeatsInsert) inserts.push(room);
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
