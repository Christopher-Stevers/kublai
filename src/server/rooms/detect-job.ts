import { and, eq } from "drizzle-orm";

import { pointInPolygon, toPolygon, type RoomPoint } from "~/lib/room-shape";
import { db } from "~/server/db";
import { jobRooms } from "~/server/db/schema";
import {
  detectAllRoomsFromFloorImage,
  refineDetectedRooms,
  type AiDetectedRoom,
} from "~/server/rooms/detect-ai";
import {
  assignRooms,
  buildFloorGraph,
  growRoom,
  type FloorGraph,
} from "~/server/rooms/floor-graph";
import {
  extractPdfLabels,
  extractPdfLinework,
  extractPdfRoomSeeds,
  type PdfRoomSeed,
} from "~/server/rooms/pdf-walls";
import { snapPolygonToWalls } from "~/server/rooms/snap-walls";
import {
  JOB_ROOM_FILE_PUBLIC_PREFIX,
  getPdfKeyForFloorImage,
  getSourcePageFromFloorImage,
  readJobRoomFile,
} from "~/server/rooms/storage";

export type DetectJobResult = {
  added: number;
  updated: number;
  removed: number;
  total: number;
  roomId?: string;
};

export type DetectLogEntry = { at: number; message: string };

export type DetectJobState = {
  floorId: string;
  status: "running" | "done" | "error";
  error?: string;
  result?: DetectJobResult;
  startedAt: number;
  roomId?: string;
  /** Running commentary shown in the UI while the job works. */
  log: DetectLogEntry[];
};

const MAX_LOG_ENTRIES = 400;
const jobs = new Map<string, DetectJobState>();

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
    log: [],
  });
  return true;
}

function logDetect(floorId: string, message: string) {
  const current = jobs.get(floorId);
  if (current) {
    current.log.push({ at: Date.now(), message });
    if (current.log.length > MAX_LOG_ENTRIES) {
      current.log.splice(0, current.log.length - MAX_LOG_ENTRIES);
    }
  }
  console.log("[detect-job]", floorId, message);
}

function finishDetectJob(floorId: string, result: DetectJobResult) {
  const current = jobs.get(floorId);
  jobs.set(floorId, {
    floorId,
    status: "done",
    result,
    startedAt: current?.startedAt ?? Date.now(),
    roomId: result.roomId ?? current?.roomId,
    log: current?.log ?? [],
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
    log: current?.log ?? [],
  });
  console.error("[detect-job] error", floorId, error);
}

export type FloorSource = {
  floorId: string;
  jobId: string;
  imageUrl: string;
  pageNumber: number;
};

type FloorGraphEntry = {
  graph: FloorGraph;
  seeds: PdfRoomSeed[];
  imageUrl: string;
  builtAt: number;
};

const GRAPH_TTL_MS = 30 * 60_000;
const graphs = new Map<string, FloorGraphEntry>();
const pendingGraphs = new Map<string, Promise<FloorGraphEntry>>();

function storageKeyFor(imageUrl: string) {
  const prefix = `${JOB_ROOM_FILE_PUBLIC_PREFIX}/`;
  if (!imageUrl.startsWith(prefix)) {
    throw new Error("Floor image is missing");
  }
  return imageUrl.slice(prefix.length);
}

async function buildFloorGraphEntry(
  source: FloorSource,
  log: (message: string) => void,
): Promise<FloorGraphEntry> {
  const storageKey = storageKeyFor(source.imageUrl);
  const pdf = await readJobRoomFile(
    getPdfKeyForFloorImage(storageKey, source.jobId),
  );
  const pdfPage = getSourcePageFromFloorImage(storageKey) ?? source.pageNumber;
  log(`Reading vector linework from PDF page ${pdfPage}`);
  const linework = await extractPdfLinework(pdf, pdfPage);
  log(
    `Linework: ${linework.segments.length} segments, ${linework.arcs.length} arcs` +
      (linework.layers.length
        ? `, layers: ${linework.layers.slice(0, 6).join(", ")}`
        : ", no layer data"),
  );
  const labels = await extractPdfLabels(pdf, pdfPage);
  const seeds = extractPdfRoomSeeds(labels);
  log(
    `Labels: ${labels.length} text runs → ${seeds.length} room/unit labels` +
      (seeds.length
        ? ` (${seeds
            .slice(0, 8)
            .map((seed) => seed.name)
            .join(", ")}${seeds.length > 8 ? ", …" : ""})`
        : ""),
  );
  const graph = buildFloorGraph(linework, { log });
  return { graph, seeds, imageUrl: source.imageUrl, builtAt: Date.now() };
}

/**
 * Floor graphs are expensive (PDF parse + polygonize) and reused by both the
 * full detection run and click-to-grow, so keep them per floor for a while.
 */
export async function getFloorGraph(
  source: FloorSource,
  log: (message: string) => void = () => undefined,
): Promise<FloorGraphEntry> {
  const cached = graphs.get(source.floorId);
  if (
    cached &&
    cached.imageUrl === source.imageUrl &&
    Date.now() - cached.builtAt < GRAPH_TTL_MS
  ) {
    log("Using cached wall graph for this floor");
    return cached;
  }
  const pending = pendingGraphs.get(source.floorId);
  if (pending) return pending;
  const promise = buildFloorGraphEntry(source, log)
    .then((entry) => {
      graphs.set(source.floorId, entry);
      return entry;
    })
    .finally(() => pendingGraphs.delete(source.floorId));
  pendingGraphs.set(source.floorId, promise);
  return promise;
}

export function invalidateFloorGraph(floorId: string) {
  graphs.delete(floorId);
}

/** Face ids whose centroid sits inside any of the given saved room shapes. */
export function facesTakenByRooms(
  graph: FloorGraph,
  rooms: Array<{ shape: unknown }>,
) {
  const polygons = rooms.map((room) =>
    toPolygon(room.shape as Parameters<typeof toPolygon>[0]),
  );
  return graph.faces
    .filter((face) =>
      polygons.some((polygon) => pointInPolygon(face.centroid, polygon)),
    )
    .map((face) => face.id);
}

export async function growRoomOnFloor(input: {
  source: FloorSource;
  include: RoomPoint[];
  exclude: RoomPoint[];
  otherRooms: Array<{ shape: unknown }>;
}) {
  const { graph } = await getFloorGraph(input.source);
  const taken = facesTakenByRooms(graph, input.otherRooms);
  return growRoom(graph, {
    include: input.include,
    exclude: input.exclude,
    taken,
  });
}

export async function runAiDetectAllRooms(input: {
  floorId: string;
  organizationId: string;
  jobId: string;
  imageUrl: string;
  floorStatus: string;
  pageNumber: number;
}) {
  const log = (message: string) => logDetect(input.floorId, message);
  try {
    const storageKey = storageKeyFor(input.imageUrl);
    const source: FloorSource = {
      floorId: input.floorId,
      jobId: input.jobId,
      imageUrl: input.imageUrl,
      pageNumber: input.pageNumber,
    };
    let detected: AiDetectedRoom[] = [];
    let wallCount = 0;

    const { graph, seeds } = await getFloorGraph(source, log);
    wallCount = graph.stats.strong;

    if (graph.faces.length > 0 && seeds.length > 0) {
      log(`Assigning ${seeds.length} labels to wall-bounded spaces`);
      const rooms = assignRooms(graph, seeds, log);
      detected = rooms.map((room) => ({ name: room.name, shape: room.shape }));
      log(`Deterministic pass traced ${detected.length} rooms`);
    } else if (seeds.length === 0) {
      log("No unit/room labels in the PDF text layer");
    } else {
      log("No bounded regions from the vector linework");
    }

    if (detected.length === 0) {
      log("Falling back to image-based detection (no vector rooms found)");
      const image = await readJobRoomFile(storageKey);
      const coarse = await detectAllRoomsFromFloorImage(image);
      log(`Image pass proposed ${coarse.length} rooms, refining`);
      const refined = await refineDetectedRooms(image, coarse);
      const walls = (
        await extractPdfLinework(
          await readJobRoomFile(getPdfKeyForFloorImage(storageKey, input.jobId)),
          getSourcePageFromFloorImage(storageKey) ?? input.pageNumber,
        )
      ).segments;
      detected = refined.flatMap((room) => {
        if (walls.length < 12) return [room];
        const snapped = snapPolygonToWalls(room.shape.points, walls);
        return snapped ? [{ ...room, shape: snapped }] : [];
      });
      log(`Image pass kept ${detected.length} rooms after wall snapping`);
    }
    console.log(
      "[detect-job] faces",
      graph.faces.length,
      "seeds",
      seeds.length,
      "detected",
      detected.length,
      "walls",
      wallCount,
    );
    if (detected.length === 0) {
      throw new Error("Could not trace any rooms from this floor plan");
    }
    log(`Saving ${detected.length} rooms`);
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

    log(`Done: ${added} added, ${updated} updated`);
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
