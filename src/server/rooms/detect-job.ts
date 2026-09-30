import { randomUUID } from "node:crypto";
import { BoundedCache } from "./bounded-cache";
import { processIdentity, sameProcess } from "./process-identity";
import { and, eq, ne, sql } from "drizzle-orm";

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
  type PdfLabel,
} from "~/server/rooms/pdf-walls";
import { detectSupplementaryRooms } from "~/server/rooms/supplementary-rooms";
import { planDetectedRoomReconciliation } from "~/server/rooms/reconcile-detected-rooms";
import { detectHybridRooms } from "~/server/rooms/hybrid/detect-hybrid";
import { labelOutlines } from "~/server/rooms/hybrid/mask-outline";
import { renderPdfPageWithoutText } from "~/server/rooms/hybrid/render-page";
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
  runId: string;
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
    runId: row.runId,
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
  const workerAlive =
    (!row.workerPid && Date.now() - row.startedAt.getTime() < 15_000) ||
    (!!row.workerPid && (!row.workerStartTicks || !row.workerBootId) &&
      !!(await processIdentity(row.workerPid))) ||
    (await sameProcess({
      pid: row.workerPid ?? -1,
      startTicks: row.workerStartTicks ?? "",
      bootId: row.workerBootId ?? "",
    }));
  if (
    row.status === "running" &&
    (!workerAlive || Date.now() - row.heartbeatAt.getTime() >= JOB_STALE_MS)
  ) {
    await failDetectJob(
      floorId,
      "Room detection worker stopped before completing",
      row.runId,
    );
    return getDetectJob(floorId);
  }
  return toDetectJobState(row);
}

export async function beginDetectJob(
  floorId: string,
  organizationId: string,
): Promise<string | null> {
  const running = await db
    .select({ floorId: roomDetectionJobs.floorId })
    .from(roomDetectionJobs)
    .where(eq(roomDetectionJobs.status, "running"));
  for (const job of running) await getDetectJob(job.floorId);
  const now = new Date();
  const runId = randomUUID();
  return db.transaction(async (tx) => {
    // Admission is serialized across HTTP processes and organizations.
    await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
    const active = await tx
      .select({ floorId: roomDetectionJobs.floorId })
      .from(roomDetectionJobs)
      .where(eq(roomDetectionJobs.status, "running"));
    if (active.length >= 2) return null;
    const values = {
      floorId,
      organizationId,
      runId,
      status: "running",
      startedAt: now,
      heartbeatAt: now,
      finishedAt: null,
      workerPid: null,
      workerBootId: null,
      workerStartTicks: null,
      error: null,
      result: null,
      log: [],
    };
    const [row] = await tx
      .insert(roomDetectionJobs)
      .values(values)
      .onConflictDoUpdate({
        target: roomDetectionJobs.floorId,
        set: values,
        setWhere: ne(roomDetectionJobs.status, "running"),
      })
      .returning({ runId: roomDetectionJobs.runId });
    return row?.runId ?? null;
  });
}

function runPredicate(floorId: string, runId: string) {
  return and(
    eq(roomDetectionJobs.floorId, floorId),
    eq(roomDetectionJobs.runId, runId),
    eq(roomDetectionJobs.status, "running"),
  );
}

async function appendDetectLog(
  floorId: string,
  message: string,
  runId: string,
) {
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
    .where(runPredicate(floorId, runId));
}

export async function setDetectWorkerPid(
  floorId: string,
  workerPid: number,
  runId: string,
) {
  const identity = await processIdentity(workerPid);
  await db
    .update(roomDetectionJobs)
    .set({
      workerPid,
      workerBootId: identity?.bootId,
      workerStartTicks: identity?.startTicks,
      heartbeatAt: new Date(),
    })
    .where(runPredicate(floorId, runId));
}

type DetectionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function finishDetectJob(
  tx: DetectionTx,
  floorId: string,
  result: DetectJobResult,
  runId: string,
) {
  const entry = {
    at: Date.now(),
    message: `Done: ${result.added} added, ${result.updated} updated, ${result.removed} removed`,
  };
  await tx
    .update(roomDetectionJobs)
    .set({
      status: "done",
      result,
      error: null,
      workerPid: null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
      log: sql`${roomDetectionJobs.log} || ${JSON.stringify([entry])}::jsonb`,
    })
    .where(runPredicate(floorId, runId));
}

export async function failDetectJob(
  floorId: string,
  error: string,
  runId: string,
) {
  await db
    .update(roomDetectionJobs)
    .set({
      status: "error",
      error,
      workerPid: null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
    })
    .where(runPredicate(floorId, runId));
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
  labels: PdfLabel[];
  linework: Awaited<ReturnType<typeof extractPdfLinework>>;
  imageUrl: string;
  builtAt: number;
};

const GRAPH_TTL_MS = 30 * 60_000;
const graphs = new BoundedCache<FloorGraphEntry>(
  4,
  48 * 1024 * 1024,
  GRAPH_TTL_MS,
  1,
);
const graphSweep = setInterval(() => graphs.sweep(), 60_000);
graphSweep.unref();

function storageKeyFor(imageUrl: string) {
  const prefix = `${JOB_ROOM_FILE_PUBLIC_PREFIX}/`;
  if (!imageUrl.startsWith(prefix)) {
    throw new Error("Floor image is missing");
  }
  return imageUrl.slice(prefix.length);
}

async function buildFloorGraphEntry(
  source: FloorSource,
  log: (message: string) => void | Promise<void>,
): Promise<FloorGraphEntry> {
  const storageKey = storageKeyFor(source.imageUrl);
  await log("Opening floor PDF…");
  const pdf = await readJobRoomFile(
    getPdfKeyForFloorImage(storageKey, source.jobId),
  );
  const pdfPage = getSourcePageFromFloorImage(storageKey) ?? source.pageNumber;
  await log(`Reading vector linework from PDF page ${pdfPage}…`);
  const linework = await extractPdfLinework(pdf, pdfPage);
  await log(
    `Linework: ${linework.segments.length} segments, ${linework.arcs.length} arcs` +
      (linework.layers.length
        ? `, layers: ${linework.layers.slice(0, 6).join(", ")}`
        : ", no layer data"),
  );
  await log(`Reading text labels on page ${pdfPage}…`);
  const labels = await extractPdfLabels(pdf, pdfPage);
  const seeds = extractPdfRoomSeeds(labels);
  await log(
    `Labels: ${labels.length} text runs → ${seeds.length} room/unit labels` +
      (seeds.length
        ? ` (${seeds
            .slice(0, 8)
            .map((seed) => seed.name)
            .join(", ")}${seeds.length > 8 ? ", …" : ""})`
        : ""),
  );
  await log(
    `Grading walls and polygonizing bounded regions from ${linework.segments.length} segments…`,
  );
  const graph = buildFloorGraph(linework, { log });
  return {
    graph,
    seeds,
    labels,
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
  log: (message: string) => void | Promise<void> = () => undefined,
): Promise<FloorGraphEntry> {
  const key = `${source.floorId}:${source.imageUrl}:${source.pageNumber}`;
  return graphs.get(
    key,
    () => buildFloorGraphEntry(source, log),
    (entry) =>
      Buffer.byteLength(
        JSON.stringify(entry, (_key, value: unknown) =>
          value instanceof Map ? [...value.entries()] : value,
        ),
      ) * 3,
  );
}

export function invalidateFloorGraph(floorId: string) {
  graphs.invalidatePrefix(`${floorId}:`);
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
  runId: string;
}) {
  const log = async (message: string) => {
    console.log("[detect-job]", input.floorId, message);
    await appendDetectLog(input.floorId, message, input.runId);
  };
  try {
    await log("Starting room detection…");
    const source: FloorSource = {
      floorId: input.floorId,
      jobId: input.jobId,
      imageUrl: input.imageUrl,
      pageNumber: input.pageNumber,
    };
    const { graph, seeds, labels, linework } = await getFloorGraph(source, log);
    let detected: DetectedRoom[] = [];
    if (graph.faces.length === 0) {
      await log("No bounded regions were found in the PDF wall geometry");
    } else if (seeds.length === 0) {
      await log("No room or unit labels were found in the PDF text layer");
    } else {
      const saved = await db
        .select()
        .from(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, input.floorId),
            eq(jobRooms.organizationId, input.organizationId),
          ),
        );
      // A repeat is supplementary, not a regeneration of approved outlines.
      // In particular, never feed expanded labels into suite ownership.
      if (saved.some((room) => room.source === "auto")) {
        detected = saved.map((room) => ({
          name: room.name,
          shape: toPolygon(room.shape as Parameters<typeof toPolygon>[0]),
        }));
        await log(
          `Preserving ${saved.length} saved rooms as the immutable baseline`,
        );
      } else {
        const traced = await detectFloorRooms(linework, seeds, log, graph);
        detected = traced.rooms.map((room) => ({
          name: room.name,
          shape: room.shape,
        }));
      }
      await log(`Deterministic wall pass traced ${detected.length} rooms`);
      const supplemental = await detectSupplementaryRooms(
        linework,
        labels,
        detected,
        graph,
        log,
      );
      detected = [...detected, ...supplemental.rooms];
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
    await log(`Saving ${detected.length} rooms…`);
    const result = await db.transaction(async (tx) => {
      const [lease] = await tx
        .select()
        .from(roomDetectionJobs)
        .where(runPredicate(input.floorId, input.runId))
        .for("update");
      if (!lease) throw new Error("Room detection was superseded");
      const [source] = await tx
        .select()
        .from(jobFloors)
        .where(eq(jobFloors.id, input.floorId))
        .for("update");
      if (
        source?.imageUrl !== input.imageUrl ||
        source.pageNumber !== input.pageNumber
      )
        throw new Error(
          "Floor drawing changed during detection; run detection again",
        );
      const existing = await tx
        .select()
        .from(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, input.floorId),
            eq(jobRooms.organizationId, input.organizationId),
          ),
        );
      const plan = planDetectedRoomReconciliation(existing, detected, {
        preserveExisting: true,
      });
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

      const result = {
        added: plan.inserts.length,
        updated: plan.updates.length,
        removed: plan.obsoleteAutoIds.length,
        total: existing.length + plan.inserts.length,
      };
      await finishDetectJob(tx, input.floorId, result, input.runId);
      return result;
    });

    await log(
      `Done: ${result.added} added, ${result.updated} updated, ${result.removed} old traces removed`,
    );
  } catch (error) {
    await failDetectJob(
      input.floorId,
      error instanceof Error
        ? error.message
        : "Deterministic room detection failed",
      input.runId,
    );
    throw error;
  }
}

export type DetectMethod = "standard" | "hybrid";

/** Render size for the hybrid detector: door ≈ 0.95% of this ≈ 48 px. */
const HYBRID_LONG_SIDE = 5000;

/**
 * Experimental: Astra's density-guided hybrid detector. Updates this
 * floor's unconfirmed auto-detected rooms where it finds them again and adds
 * new rooms; it never deletes, and confirmed or hand-drawn rooms are never
 * changed.
 */
export async function runHybridDetectAllRooms(input: {
  floorId: string;
  organizationId: string;
  jobId: string;
  imageUrl: string;
  floorStatus: string;
  pageNumber: number;
  runId: string;
}) {
  const log = async (message: string) => {
    console.log("[detect-job:hybrid]", input.floorId, message);
    await appendDetectLog(input.floorId, message, input.runId);
  };
  try {
    await log("Starting new (beta) room detection…");
    const storageKey = storageKeyFor(input.imageUrl);
    const pdf = await readJobRoomFile(
      getPdfKeyForFloorImage(storageKey, input.jobId),
    );
    const pdfPage = getSourcePageFromFloorImage(storageKey) ?? input.pageNumber;
    const seeds = extractPdfRoomSeeds(await extractPdfLabels(pdf, pdfPage));
    await log(`Found ${seeds.length} room/unit labels on page ${pdfPage}`);
    if (!seeds.length)
      throw new Error(
        "No room or unit labels were found in the PDF text layer",
      );

    await log("Rendering the sheet without text…");
    const page = await renderPdfPageWithoutText(pdf, pdfPage, HYBRID_LONG_SIDE);
    await log(`Tracing walls and rooms at ${page.width}×${page.height} px…`);
    const result = detectHybridRooms(page.rgba, page.width, page.height, seeds);
    const door = 0.0095 * Math.max(page.width, page.height);
    const outlines = labelOutlines(result.labels, page.width, {
      epsilon: Math.max(2, door / 10),
      minAreaPx: Math.round((door * 0.8) ** 2),
    });
    await log(
      `Traced ${outlines.length} rooms from ${seeds.length} labels` +
        (result.rejectedSeeds.length
          ? `; ${result.rejectedSeeds.length} labels skipped (${result.rejectedSeeds
              .slice(0, 6)
              .map(
                (r) =>
                  `${seeds[r.seedIndex]!.name}: ${r.reason === "on-wall" ? "no open floor nearby" : "outside the building"}`,
              )
              .join(", ")})`
          : "") +
        (result.partitionedComponents
          ? `; ${result.partitionedComponents} shared spaces split between labels (review these)`
          : ""),
    );
    const detected: DetectedRoom[] = outlines.map((outline) => ({
      name: seeds[outline.label - 1]!.name,
      shape: toPolygon({
        type: "polygon",
        points: outline.points.map((p) => ({
          x: p.x / page.width,
          y: p.y / page.height,
        })),
      }),
    }));
    if (!detected.length)
      throw new Error("Could not trace any rooms from this floor plan");

    await log(
      `Saving ${detected.length} rooms (nothing is deleted; confirmed and hand-drawn rooms are kept)…`,
    );
    const saved = await db.transaction(async (tx) => {
      const [lease] = await tx
        .select()
        .from(roomDetectionJobs)
        .where(runPredicate(input.floorId, input.runId))
        .for("update");
      if (!lease) throw new Error("Room detection was superseded");
      const [source] = await tx
        .select()
        .from(jobFloors)
        .where(eq(jobFloors.id, input.floorId))
        .for("update");
      if (
        source?.imageUrl !== input.imageUrl ||
        source.pageNumber !== input.pageNumber
      )
        throw new Error(
          "Floor drawing changed during detection; run detection again",
        );
      const existing = await tx
        .select()
        .from(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, input.floorId),
            eq(jobRooms.organizationId, input.organizationId),
          ),
        );
      // Only unconfirmed auto rooms may be replaced; everything else is treated
      // as hand-made so it is neither updated nor removed.
      const plan = planDetectedRoomReconciliation(
        existing.map((room) => ({
          id: room.id,
          name: room.name,
          source: room.source === "auto" && !room.confirmed ? "auto" : "manual",
          shape: room.shape,
        })),
        detected,
      );
      const now = new Date();
      for (const update of plan.updates) {
        await tx
          .update(jobRooms)
          .set({
            name: update.room.name,
            shape: update.room.shape,
            updatedAt: now,
          })
          .where(eq(jobRooms.id, update.id));
      }
      for (const [index, room] of plan.inserts.entries()) {
        await tx.insert(jobRooms).values({
          organizationId: input.organizationId,
          jobId: input.jobId,
          floorId: input.floorId,
          name: room.name,
          source: "auto",
          confirmed: false,
          shape: room.shape,
          sortOrder: existing.length + index,
        });
      }
      // Beta never deletes: rooms it did not reproduce stay as they were.
      const result = {
        added: plan.inserts.length,
        updated: plan.updates.length,
        removed: 0,
        total: existing.length + plan.inserts.length,
      };
      await finishDetectJob(tx, input.floorId, result, input.runId);
      return result;
    });
    invalidateFloorGraph(input.floorId);
    await log(
      `Done: ${saved.added} added, ${saved.updated} updated; existing rooms it did not find were left unchanged`,
    );
  } catch (error) {
    await failDetectJob(
      input.floorId,
      error instanceof Error ? error.message : "New room detection failed",
      input.runId,
    );
  }
}

export async function runQueuedDetectJob(
  floorId: string,
  method: DetectMethod,
  runId: string,
) {
  const job = await getDetectJob(floorId);
  if (job?.status !== "running" || job.runId !== runId) return;
  const [floor] = await db
    .select()
    .from(jobFloors)
    .where(eq(jobFloors.id, floorId))
    .limit(1);
  if (!floor) {
    await failDetectJob(floorId, "Floor no longer exists", runId);
    return;
  }
  await setDetectWorkerPid(floorId, process.pid, runId);
  const run =
    method === "hybrid"
      ? runHybridDetectAllRooms
      : runDeterministicDetectAllRooms;
  const heartbeat = setInterval(() => {
    void db
      .update(roomDetectionJobs)
      .set({ heartbeatAt: new Date() })
      .where(runPredicate(floorId, runId))
      .catch((error) => console.error("[detect-heartbeat]", error));
  }, 5000);
  heartbeat.unref();
  try {
    await run({
      floorId: floor.id,
      runId,
      organizationId: floor.organizationId,
      jobId: floor.jobId,
      imageUrl: floor.imageUrl,
      floorStatus: floor.status,
      pageNumber: floor.pageNumber,
    });
  } finally {
    clearInterval(heartbeat);
  }
}
