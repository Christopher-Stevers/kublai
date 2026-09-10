import { and, eq, lt, ne, or, sql } from "drizzle-orm";

import { pointInPolygon, toPolygon, type RoomPoint } from "~/lib/room-shape";
import { db } from "~/server/db";
import { jobFloors, jobRooms, roomDetectionJobs } from "~/server/db/schema";
import {
  buildFloorGraph,
  detectFloorRooms,
  growRoom,
  type FloorGraph,
} from "~/server/rooms/floor-graph";
import {
  extractPdfLabels,
  extractPdfLinework,
  extractPdfRoomSeeds,
  type PdfRoomSeed,
} from "~/server/rooms/pdf-walls";
import { planDetectedRoomReconciliation } from "~/server/rooms/reconcile-detected-rooms";
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

type DetectedRoom = {
  name: string;
  shape: ReturnType<typeof toPolygon>;
};

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
const JOB_STALE_MS = 20 * 60_000;

function toDetectJobState(
  row: typeof roomDetectionJobs.$inferSelect,
): DetectJobState {
  const result = row.result as DetectJobResult | null;
  return {
    floorId: row.floorId,
    status: row.status as DetectJobState["status"],
    ...(row.error ? { error: row.error } : {}),
    ...(result ? { result } : {}),
    startedAt: row.startedAt.getTime(),
    log: (row.log as DetectLogEntry[]) ?? [],
  };
}

export async function getDetectJob(
  floorId: string,
): Promise<DetectJobState | null> {
  const [row] = await db
    .select()
    .from(roomDetectionJobs)
    .where(eq(roomDetectionJobs.floorId, floorId))
    .limit(1);
  if (!row) return null;
  let workerAlive = true;
  if (row.status === "running" && row.workerPid) {
    try {
      process.kill(row.workerPid, 0);
    } catch {
      workerAlive = false;
    }
  }
  if (
    row.status === "running" &&
    (!workerAlive || Date.now() - row.heartbeatAt.getTime() >= JOB_STALE_MS)
  ) {
    await failDetectJob(
      floorId,
      "Room detection worker stopped before completing",
    );
    return getDetectJob(floorId);
  }
  return toDetectJobState(row);
}

export async function beginDetectJob(
  floorId: string,
  organizationId: string,
): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - JOB_STALE_MS);
  const [row] = await db
    .insert(roomDetectionJobs)
    .values({
      floorId,
      organizationId,
      status: "running",
      startedAt: now,
      heartbeatAt: now,
      finishedAt: null,
      workerPid: null,
      error: null,
      result: null,
      log: [],
    })
    .onConflictDoUpdate({
      target: roomDetectionJobs.floorId,
      set: {
        organizationId,
        status: "running",
        startedAt: now,
        heartbeatAt: now,
        finishedAt: null,
        workerPid: null,
        error: null,
        result: null,
        log: [],
      },
      setWhere: or(
        ne(roomDetectionJobs.status, "running"),
        lt(roomDetectionJobs.heartbeatAt, staleBefore),
      ),
    })
    .returning({ floorId: roomDetectionJobs.floorId });
  return Boolean(row);
}

async function appendDetectLog(floorId: string, message: string) {
  const entry: DetectLogEntry = { at: Date.now(), message };
  await db
    .update(roomDetectionJobs)
    .set({
      heartbeatAt: new Date(),
      log: sql`(
        SELECT COALESCE(jsonb_agg(item ORDER BY position), '[]'::jsonb)
        FROM (
          SELECT item, position
          FROM jsonb_array_elements(
            COALESCE(${roomDetectionJobs.log}, '[]'::jsonb) ||
            ${JSON.stringify([entry])}::jsonb
          ) WITH ORDINALITY AS entries(item, position)
          ORDER BY position DESC
          LIMIT ${MAX_LOG_ENTRIES}
        ) recent
      )`,
    })
    .where(eq(roomDetectionJobs.floorId, floorId));
}

export async function setDetectWorkerPid(floorId: string, workerPid: number) {
  await db
    .update(roomDetectionJobs)
    .set({ workerPid, heartbeatAt: new Date() })
    .where(
      and(
        eq(roomDetectionJobs.floorId, floorId),
        eq(roomDetectionJobs.status, "running"),
      ),
    );
}

async function finishDetectJob(floorId: string, result: DetectJobResult) {
  await db
    .update(roomDetectionJobs)
    .set({
      status: "done",
      result,
      error: null,
      workerPid: null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
    })
    .where(eq(roomDetectionJobs.floorId, floorId));
  console.log("[detect-job] done", floorId, result);
}

export async function failDetectJob(floorId: string, error: string) {
  await db
    .update(roomDetectionJobs)
    .set({
      status: "error",
      error,
      workerPid: null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(roomDetectionJobs.floorId, floorId),
        eq(roomDetectionJobs.status, "running"),
      ),
    );
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
  linework: Awaited<ReturnType<typeof extractPdfLinework>>;
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
  return {
    graph,
    seeds,
    linework,
    imageUrl: source.imageUrl,
    builtAt: Date.now(),
  };
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

export async function runDeterministicDetectAllRooms(input: {
  floorId: string;
  organizationId: string;
  jobId: string;
  imageUrl: string;
  floorStatus: string;
  pageNumber: number;
}) {
  let pendingLogWrite = Promise.resolve();
  const log = (message: string) => {
    console.log("[detect-job]", input.floorId, message);
    pendingLogWrite = pendingLogWrite
      .catch(() => undefined)
      .then(() => appendDetectLog(input.floorId, message));
  };
  try {
    const source: FloorSource = {
      floorId: input.floorId,
      jobId: input.jobId,
      imageUrl: input.imageUrl,
      pageNumber: input.pageNumber,
    };
    const { graph, seeds, linework } = await getFloorGraph(source, log);
    let detected: DetectedRoom[] = [];
    if (graph.faces.length === 0) {
      log("No bounded regions were found in the PDF wall geometry");
    } else if (seeds.length === 0) {
      log("No room or unit labels were found in the PDF text layer");
    } else {
      log(`Assigning ${seeds.length} labels to wall-bounded spaces`);
      detected = detectFloorRooms(linework, seeds, log, graph).rooms.map(
        (room) => ({
          name: room.name,
          shape: room.shape,
        }),
      );
      log(`Deterministic wall pass traced ${detected.length} rooms`);
    }
    console.log(
      "[detect-job] deterministic",
      "faces",
      graph.faces.length,
      "seeds",
      seeds.length,
      "detected",
      detected.length,
      "walls",
      graph.stats.strong,
    );
    if (detected.length === 0) {
      throw new Error("Could not trace any rooms from this floor plan");
    }
    log(`Saving ${detected.length} rooms`);
    await pendingLogWrite;
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, input.floorId),
            eq(jobRooms.organizationId, input.organizationId),
          ),
        );
      const plan = planDetectedRoomReconciliation(existing, detected);
      const now = new Date();

      for (const update of plan.updates) {
        await tx
          .update(jobRooms)
          .set({ shape: update.room.shape, updatedAt: now })
          .where(eq(jobRooms.id, update.id));
      }
      for (const [index, room] of plan.inserts.entries()) {
        await tx.insert(jobRooms).values({
          organizationId: input.organizationId,
          jobId: input.jobId,
          floorId: input.floorId,
          name: room.name,
          source: "auto",
          confirmed: input.floorStatus === "confirmed",
          shape: room.shape,
          sortOrder: existing.length + index,
        });
      }
      for (const roomId of plan.obsoleteAutoIds) {
        await tx.delete(jobRooms).where(eq(jobRooms.id, roomId));
      }

      return {
        added: plan.inserts.length,
        updated: plan.updates.length,
        removed: plan.obsoleteAutoIds.length,
        total: detected.length,
      };
    });

    log(
      `Done: ${result.added} added, ${result.updated} updated, ${result.removed} old traces removed`,
    );
    await pendingLogWrite;
    await finishDetectJob(input.floorId, result);
  } catch (error) {
    await pendingLogWrite.catch(() => undefined);
    await failDetectJob(
      input.floorId,
      error instanceof Error
        ? error.message
        : "Deterministic room detection failed",
    );
    throw error;
  }
}

export async function runQueuedDetectJob(floorId: string) {
  const job = await getDetectJob(floorId);
  if (job?.status !== "running") return;
  const [floor] = await db
    .select()
    .from(jobFloors)
    .where(eq(jobFloors.id, floorId))
    .limit(1);
  if (!floor) {
    await failDetectJob(floorId, "Floor no longer exists");
    return;
  }
  await setDetectWorkerPid(floorId, process.pid);
  await runDeterministicDetectAllRooms({
    floorId: floor.id,
    organizationId: floor.organizationId,
    jobId: floor.jobId,
    imageUrl: floor.imageUrl,
    floorStatus: floor.status,
    pageNumber: floor.pageNumber,
  });
}
