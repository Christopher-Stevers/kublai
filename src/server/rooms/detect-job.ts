import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { jobRooms } from "~/server/db/schema";
import {
  detectAllRoomsFromFloorImage,
  refineDetectedRooms,
  selectRoomPolygonsFromFaces,
  type AiDetectedRoom,
  type RoomFaceTarget,
} from "~/server/rooms/detect-ai";
import {
  extractPdfLabels,
  extractPdfRoomSeeds,
  extractPdfWalls,
  type PdfRoomSeed,
} from "~/server/rooms/pdf-walls";
import {
  facesContainingPoint,
  polygonizeWalls,
  unionRoomFaces,
} from "~/server/rooms/polygonize-walls";
import { snapPolygonToWalls } from "~/server/rooms/snap-walls";
import {
  JOB_ROOM_FILE_PUBLIC_PREFIX,
  getJobFloorPlanPdfKey,
  readJobRoomFile,
} from "~/server/rooms/storage";

export type DetectJobResult = {
  added: number;
  updated: number;
  removed: number;
  total: number;
  roomId?: string;
};

export type DetectJobState = {
  floorId: string;
  status: "running" | "done" | "error";
  error?: string;
  result?: DetectJobResult;
  startedAt: number;
  roomId?: string;
};

const jobs = new Map<string, DetectJobState>();

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const output: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        output[index] = await fn(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function groupRoomSeeds(seeds: PdfRoomSeed[]) {
  const groups: PdfRoomSeed[][] = [];
  const smallUnits = seeds
    .filter((seed) => seed.kind === "unit" && (seed.areaSqFt ?? 0) <= 500)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const largeUnits = seeds.filter(
    (seed) => seed.kind === "unit" && (seed.areaSqFt ?? 0) > 500,
  );
  for (const seed of largeUnits) groups.push([seed]);

  let current: PdfRoomSeed[] = [];
  for (const seed of smallUnits) {
    const previous = current[current.length - 1];
    const continuesRow =
      previous &&
      Math.abs(previous.y - seed.y) <= 0.025 &&
      Math.abs(previous.x - seed.x) <= 0.085 &&
      current.length < 4;
    if (!continuesRow && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(seed);
  }
  if (current.length) groups.push(current);

  return groups;
}

export function getDetectJob(floorId: string): DetectJobState | null {
  return jobs.get(floorId) ?? null;
}

export function beginDetectJob(floorId: string, roomId?: string): boolean {
  const existing = jobs.get(floorId);
  if (existing?.status === "running") {
    if (Date.now() - existing.startedAt < 300_000) return false;
  }
  jobs.set(floorId, {
    floorId,
    status: "running",
    startedAt: Date.now(),
    roomId,
  });
  return true;
}

function finishDetectJob(floorId: string, result: DetectJobResult) {
  const current = jobs.get(floorId);
  jobs.set(floorId, {
    floorId,
    status: "done",
    result,
    startedAt: current?.startedAt ?? Date.now(),
    roomId: result.roomId ?? current?.roomId,
  });
  console.log("[detect-job] done", floorId, result);
}

function failDetectJob(floorId: string, error: string) {
  const current = jobs.get(floorId);
  jobs.set(floorId, {
    floorId,
    status: "error",
    error,
    startedAt: current?.startedAt ?? Date.now(),
    roomId: current?.roomId,
  });
  console.error("[detect-job] error", floorId, error);
}

export async function runAiDetectAllRooms(input: {
  floorId: string;
  organizationId: string;
  jobId: string;
  imageUrl: string;
  floorStatus: string;
  pageNumber: number;
}) {
  try {
    const prefix = `${JOB_ROOM_FILE_PUBLIC_PREFIX}/`;
    if (!input.imageUrl.startsWith(prefix)) {
      throw new Error("Floor image is missing");
    }
    const storageKey = input.imageUrl.slice(prefix.length);
    const image = await readJobRoomFile(storageKey);
    const pdf = await readJobRoomFile(getJobFloorPlanPdfKey(input.jobId));
    const walls = await extractPdfWalls(pdf, input.pageNumber);
    const labels = await extractPdfLabels(pdf, input.pageNumber);
    const seeds = extractPdfRoomSeeds(labels);
    const polygons = polygonizeWalls(walls);
    let detected: AiDetectedRoom[] = [];

    if (polygons.length > 0 && seeds.length > 0) {
      const groups = groupRoomSeeds(seeds);
      const ownershipTargets: RoomFaceTarget[] = seeds
        .filter((seed) => seed.kind === "unit")
        .map((seed) => ({
          id: `${seed.name}@${seed.x.toFixed(4)},${seed.y.toFixed(4)}`,
          name: seed.name,
          point: { x: seed.x, y: seed.y },
        }));
      const batches = await mapPool(groups, 3, async (group) => {
        const targets = group.map(
          (seed) =>
            ownershipTargets.find(
              (target) =>
                target.name === seed.name &&
                target.point.x === seed.x &&
                target.point.y === seed.y,
            )!,
        );
        try {
          return await selectRoomPolygonsFromFaces(
            image,
            targets,
            polygons,
            ownershipTargets,
          );
        } catch (error) {
          console.warn(
            "[detect-job] face selection failed",
            group.map((seed) => seed.name).join(", "),
            error instanceof Error ? error.message : error,
          );
          return targets.flatMap((target) => {
            const shape = unionRoomFaces(
              facesContainingPoint(polygons, target.point),
              target.point,
            );
            return shape ? [{ name: target.name, shape }] : [];
          });
        }
      });
      const exactRooms = seeds
        .filter((seed) => seed.kind === "room")
        .flatMap((seed) => {
          const point = { x: seed.x, y: seed.y };
          const shape = unionRoomFaces(
            facesContainingPoint(polygons, point),
            point,
          );
          return shape ? [{ name: seed.name, shape }] : [];
        });
      detected = [...batches.flat(), ...exactRooms].slice(0, 40);
    }

    if (detected.length === 0) {
      const coarse = await detectAllRoomsFromFloorImage(image);
      const refined = await refineDetectedRooms(image, coarse);
      detected = refined.flatMap((room) => {
        if (walls.length < 12) return [room];
        const snapped = snapPolygonToWalls(room.shape.points, walls);
        return snapped ? [{ ...room, shape: snapped }] : [];
      });
    }
    console.log(
      "[detect-job] faces",
      polygons.length,
      "seeds",
      seeds.length,
      "detected",
      detected.length,
      "walls",
      walls.length,
    );
    if (detected.length === 0) {
      throw new Error("Could not trace any rooms from this floor plan");
    }
    const existing = await db
      .select()
      .from(jobRooms)
      .where(
        and(
          eq(jobRooms.floorId, input.floorId),
          eq(jobRooms.organizationId, input.organizationId),
        ),
      );
    const normalizeName = (value: string) => value.trim().toLowerCase();
    const usedIds = new Set<string>();
    let added = 0;
    let updated = 0;
    const now = new Date();

    for (const [index, room] of detected.entries()) {
      const match = existing.find(
        (item) =>
          !usedIds.has(item.id) &&
          normalizeName(item.name) === normalizeName(room.name),
      );
      if (match) {
        usedIds.add(match.id);
        await db
          .update(jobRooms)
          .set({
            shape: room.shape,
            updatedAt: now,
          })
          .where(eq(jobRooms.id, match.id));
        updated += 1;
        continue;
      }
      await db.insert(jobRooms).values({
        organizationId: input.organizationId,
        jobId: input.jobId,
        floorId: input.floorId,
        name: room.name,
        source: "auto",
        confirmed: input.floorStatus === "confirmed",
        shape: room.shape,
        sortOrder: existing.length + index,
      });
      added += 1;
    }

    finishDetectJob(input.floorId, {
      added,
      updated,
      removed: 0,
      total: detected.length,
    });
  } catch (error) {
    failDetectJob(
      input.floorId,
      error instanceof Error ? error.message : "AI room detection failed",
    );
    throw error;
  }
}
