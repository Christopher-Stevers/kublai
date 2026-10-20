import { createHash } from "node:crypto";
import { detectTaggedRooms } from "./tagged/detect-tagged";
import { detectLayeredRooms } from "./doors/detect-layered";
import { BoundedCache } from "./bounded-cache";
import { processIdentity } from "./process-identity";
import { and, desc, eq, sql } from "drizzle-orm";

import { pointInPolygon, toPolygon, type RoomPoint } from "~/lib/room-shape";
import { db } from "~/server/db";
import {
  jobFloors,
  jobRooms,
  roomDetectionJobs,
  roomDetectionFeedback,
} from "~/server/db/schema";
import {
  buildFloorGraph,
  growRoom,
  type FloorGraph,
} from "~/server/rooms/floor-graph";
import {
  extractPdfLabels,
  extractPdfLinework,
  extractPdfRoomSeeds,
} from "~/server/rooms/pdf-walls";
import {
  detectAllSpaces,
  ALL_SPACES_VERSION,
} from "~/server/rooms/hybrid/all-spaces";
import {
  latestReviewDecisions,
  rejectedByReview,
  roomIoU,
  validReviewShape,
} from "~/server/rooms/review-memory";
import { physicalRoomSeeds } from "~/server/rooms/physical-labels";
import { sourceDrawingHash } from "~/server/rooms/drawing-hash";
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

export type DetectLogEntry = { at: number; message: string; event?: "queue-recovery" };
export { enqueueDetectJobs } from "./detect-queue";

export type DetectJobState = {
  floorId: string;
  runId: string;
  status: "queued" | "running" | "done" | "error";
  queuePosition?: number;
  error?: string;
  result?: DetectJobResult;
  startedAt: number;
  roomId?: string;
  /** Running commentary shown in the UI while the job works. */
  log: DetectLogEntry[];
};

const MAX_LOG_ENTRIES = 400;

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
  const state = toDetectJobState(row);
  if (row.status === "queued") {
    const [position] = await db.select({ count: sql<number>`count(*)::int` })
      .from(roomDetectionJobs).where(and(
        eq(roomDetectionJobs.status, "queued"),
        sql`(${roomDetectionJobs.startedAt}, ${roomDetectionJobs.floorId}) <= (${row.startedAt.toISOString()}::timestamptz, ${row.floorId}::uuid)`,
      ));
    state.queuePosition = position?.count ?? 1;
  }
  return state;
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
          WHERE item->>'event' = 'queue-recovery'
            OR position > jsonb_array_length(COALESCE(${roomDetectionJobs.log}, '[]'::jsonb)) + 1 - ${MAX_LOG_ENTRIES - 2}
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
  const changed = await db
    .update(roomDetectionJobs)
    .set({
      status: "error",
      error,
      workerPid: null,
      heartbeatAt: new Date(),
      finishedAt: new Date(),
    })
    .where(runPredicate(floorId, runId))
    .returning({ floorId: roomDetectionJobs.floorId });
  if (changed.length) console.error("[detect-job] error", floorId, error);
}

export type FloorSource = {
  floorId: string;
  jobId: string;
  imageUrl: string;
  pageNumber: number;
};

type FloorGraphEntry = {
  graph: FloorGraph;
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
  await log(
    `Grading walls and polygonizing bounded regions from ${linework.segments.length} segments…`,
  );
  const graph = buildFloorGraph(linework, { log });
  return {
    graph,
    imageUrl: source.imageUrl,
    builtAt: Date.now(),
  };
}

/**
 * Floor graphs are expensive (PDF parse + polygonize). Cache geometry for
 * repeated manual tracing; text anchors are unnecessary for this path.
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

// Retain old method names for queued/cached clients; all live jobs use reviewed persistence.
export type DetectMethod = "standard" | "hybrid" | "complete";
const HYBRID_LONG_SIDE = 5000;

export async function saveCompleteCandidates(
  input: {
    floorId: string;
    organizationId: string;
    jobId: string;
    imageUrl: string;
    pageNumber: number;
    runId: string;
  },
  candidates: ReturnType<typeof detectAllSpaces>["rooms"],
  drawingHash: string,
) {
  return db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(roomDetectionJobs)
      .where(runPredicate(input.floorId, input.runId))
      .for("update");
    if (!lease || lease.organizationId !== input.organizationId)
      throw new Error("Room detection was superseded");
    const [source] = await tx
      .select()
      .from(jobFloors)
      .where(eq(jobFloors.id, input.floorId))
      .for("update");
    if (
      source?.organizationId !== input.organizationId ||
      source.jobId !== input.jobId ||
      source.imageUrl !== input.imageUrl ||
      source.pageNumber !== input.pageNumber
    )
      throw new Error("Drawing changed during detection");
    if (
      (await sourceDrawingHash({
        imageUrl: input.imageUrl,
        jobId: input.jobId,
      })) !== drawingHash
    )
      throw new Error("Drawing contents changed during detection");
    const existing = await tx
      .select()
      .from(jobRooms)
      .where(
        and(
          eq(jobRooms.floorId, input.floorId),
          eq(jobRooms.organizationId, input.organizationId),
        ),
      )
      .for("update");
    const events = await tx
      .select()
      .from(roomDetectionFeedback)
      .where(
        and(
          eq(roomDetectionFeedback.floorId, input.floorId),
          eq(roomDetectionFeedback.organizationId, input.organizationId),
        ),
      )
      .orderBy(desc(roomDetectionFeedback.createdAt));
    const decisions = latestReviewDecisions(
      events,
      `${input.imageUrl}:${input.pageNumber}`,
    );
    const protectedRooms = existing.filter(
      (room) =>
        room.reviewStatus !== "rejected" &&
        room.reviewStatus !== "superseded" &&
        (room.confirmed ||
          room.source !== "auto" ||
          room.reviewStatus === "approved"),
    );
    const pending = existing.filter(
      (room) =>
        room.source === "auto" &&
        !room.confirmed &&
        room.reviewStatus === "pending",
    );
    const matched = new Set<string>();
    let added = 0,
      updated = 0,
      suppressed = 0;
    for (const room of candidates) {
      if (rejectedByReview(room.shape, decisions, drawingHash)) {
        suppressed++;
        continue;
      }
      if (
        protectedRooms.some(
          (r) =>
            roomIoU(
              room.shape,
              toPolygon(r.shape as Parameters<typeof toPolygon>[0]),
            ) >= 0.5,
        )
      )
        continue;
      const match = pending
        .filter((r) => !matched.has(r.id))
        .map((r) => ({
          r,
          iou: roomIoU(
            room.shape,
            toPolygon(r.shape as Parameters<typeof toPolygon>[0]),
          ),
        }))
        .sort((a, b) => b.iou - a.iou)[0];
      const detection = {
        ...room.detection,
        invalidGeometry: !validReviewShape(room.shape),
        runId: input.runId,
        drawingHash,
        version: ALL_SPACES_VERSION,
      };
      if (match && match.iou >= 0.5) {
        matched.add(match.r.id);
        updated++;
        await tx
          .update(jobRooms)
          .set({
            name: room.name,
            shape: room.shape,
            detection,
            reviewStatus: "pending",
            updatedAt: new Date(),
          })
          .where(eq(jobRooms.id, match.r.id));
      } else {
        added++;
        await tx.insert(jobRooms).values({
          organizationId: input.organizationId,
          jobId: input.jobId,
          floorId: input.floorId,
          name: room.name,
          shape: room.shape,
          detection,
          source: "auto",
          reviewStatus: "pending",
          confirmed: false,
          sortOrder: existing.length + added,
        });
      }
    }
    const superseded = pending.filter((r) => !matched.has(r.id));
    for (const old of superseded)
      await tx
        .update(jobRooms)
        .set({
          reviewStatus: "superseded",
          confirmed: false,
          updatedAt: new Date(),
        })
        .where(eq(jobRooms.id, old.id));
    if (added || updated)
      await tx
        .update(jobFloors)
        .set({
          status: "detected",
          confirmedAt: null,
          completenessReviewedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobFloors.id, input.floorId));
    const final = {
      added,
      updated,
      removed: 0,
      total: protectedRooms.length + added + updated,
    };
    await finishDetectJob(tx, input.floorId, final, input.runId);
    return { ...final, suppressed, superseded: superseded.length };
  });
}

/** Text-independent discovery: every enclosed candidate is explicitly unapproved. */
export async function runCompleteDetectAllRooms(input: {
  floorId: string;
  organizationId: string;
  jobId: string;
  imageUrl: string;
  floorStatus: string;
  pageNumber: number;
  runId: string;
}) {
  const log = async (message: string) => {
    console.log("[detect-job:complete]", input.floorId, message);
    await appendDetectLog(input.floorId, message, input.runId);
  };
  try {
    await log(
      "Finding all enclosed spaces, including unlabeled rooms and corridors…",
    );
    const storageKey = storageKeyFor(input.imageUrl);
    const pdf = await readJobRoomFile(
      getPdfKeyForFloorImage(storageKey, input.jobId),
    );
    const drawingHash = createHash("sha256").update(pdf).digest("hex");
    const pdfPage = getSourcePageFromFloorImage(storageKey) ?? input.pageNumber;
    // Best: a CAD export that kept its layers. Real walls and doors give one
    // room per unit and per common space (corridors, lobbies by door count).
    const pdfKey = getPdfKeyForFloorImage(storageKey, input.jobId);
    const savedLinework = pdfKey.endsWith("/plan.pdf")
      ? () => readJobRoomFile(pdfKey.replace(/plan\.pdf$/, `pipes-${pdfPage}-v1.json`))
      : undefined;
    const layered = await detectLayeredRooms(pdf, pdfPage, savedLinework).catch((error) => {
      console.error("[detect-job:layered]", error);
      return null;
    });
    if (layered?.rooms.length) {
      await log(
        `Read walls and doors from the drawing's CAD layers: ${layered.stats.doors} doors, ${layered.stats.commonSpaces} common spaces (corridors, lobbies, stairs, service rooms) and ${layered.stats.units} units. All need review.`,
      );
      const saved = await saveCompleteCandidates(input, layered.rooms, drawingHash);
      console.log("[detect-job:layered] saved", JSON.stringify(saved));
      invalidateFloorGraph(input.floorId);
      return;
    }
    // Otherwise: unit-level rooms from the drawing's room tags and heavy walls.
    // Sheets without room tags fall back to the label-free space finder below.
    const tagged = await detectTaggedRooms(pdf, pdfPage).catch((error) => {
      console.error("[detect-job:tagged]", error);
      return null;
    });
    if (tagged && tagged.stats.roomTags >= 3 && tagged.rooms.length) {
      await log(
        `Read ${tagged.stats.roomTags} room tags and found ${tagged.rooms.length} rooms (${tagged.unlabeledCount} without a tag). All need review.`,
      );
      if (tagged.rejectedSeeds.length)
        await log(
          `${tagged.rejectedSeeds.length} tagged rooms could not be enclosed: ${tagged.rejectedSeeds.map((r) => r.name).filter(Boolean).slice(0, 12).join(", ")}. Check these before confirming.`,
        );
      const saved = await saveCompleteCandidates(input, tagged.rooms, drawingHash);
      console.log("[detect-job:tagged] saved", JSON.stringify(saved));
      invalidateFloorGraph(input.floorId);
      return;
    }
    const seeds = physicalRoomSeeds(
      extractPdfRoomSeeds(await extractPdfLabels(pdf, pdfPage)),
    );
    await log(
      `Reading wall geometry independently of ${seeds.length} recognized labels…`,
    );
    const page = await renderPdfPageWithoutText(pdf, pdfPage, HYBRID_LONG_SIDE);
    const result = detectAllSpaces(page.rgba, page.width, page.height, seeds);
    await log(
      `Found ${result.rooms.length} space candidates, including ${result.unlabeledCount} without a label. All need review.`,
    );
    if (result.rejectedSeeds.length)
      await log(
        `${result.rejectedSeeds.length} label positions could not be enclosed. Check the drawing for missing spaces before confirming.`,
      );
    if (!result.rooms.length)
      throw new Error(
        "No enclosed space could be traced. This drawing needs manual tracing or a different wall model.",
      );
    const saved = await saveCompleteCandidates(
      input,
      result.rooms,
      drawingHash,
    );
    console.log("[detect-job:complete] saved", JSON.stringify(saved));
    invalidateFloorGraph(input.floorId);
  } catch (error) {
    await failDetectJob(
      input.floorId,
      error instanceof Error ? error.message : "Space detection failed",
      input.runId,
    );
  }
}

export async function runQueuedDetectJob(
  floorId: string,
  _method: DetectMethod,
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
  // Old queued/cached clients also use reviewed persistence. Legacy algorithm
  // modules remain available to offline benchmarks and tracing only.
  const run = runCompleteDetectAllRooms;
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
