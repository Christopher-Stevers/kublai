import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { jobFloors, roomDetectionJobs } from "~/server/db/schema";
import { processIdentity, sameProcess } from "./process-identity";

export type DetectionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ActiveDetection = {
  floorId: string;
  runId: string;
  status: "queued" | "running";
};
export const DETECT_QUEUE_LOCK = 72491833;
const WORKER_START_GRACE_MS = 15_000;
const MAX_RECOVERIES = 2;
export type QueueLogEntry = {
  at: number;
  message: string;
  event?: "queue-recovery";
};

function readLog(value: unknown): QueueLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry: unknown): entry is QueueLogEntry =>
      typeof entry === "object" &&
      entry !== null &&
      "at" in entry &&
      typeof entry.at === "number" &&
      "message" in entry &&
      typeof entry.message === "string",
  );
}

/** The upload confirmation can share its transaction: all sheets or none queue. */
export async function enqueueDetectJobs(
  floorIds: string[],
  organizationId: string,
  tx?: DetectionTx,
): Promise<ActiveDetection[]> {
  if (!tx)
    return db.transaction((transaction) =>
      enqueueDetectJobs(floorIds, organizationId, transaction),
    );
  const uniqueIds = [...new Set(floorIds)];
  if (!uniqueIds.length) return [];
  await tx.execute(sql`select pg_advisory_xact_lock(${DETECT_QUEUE_LOCK})`);
  const floors = await tx
    .select({ id: jobFloors.id })
    .from(jobFloors)
    .where(
      and(
        inArray(jobFloors.id, uniqueIds),
        eq(jobFloors.organizationId, organizationId),
      ),
    );
  if (floors.length !== uniqueIds.length)
    throw new Error("Drawing does not belong to this organization");
  // Preserve upload page order, including a batch inserted within one millisecond.
  const [tail] = await tx
    .select({ startedAt: roomDetectionJobs.startedAt })
    .from(roomDetectionJobs)
    .where(eq(roomDetectionJobs.status, "queued"))
    .orderBy(desc(roomDetectionJobs.startedAt))
    .limit(1);
  const now = Math.max(Date.now(), (tail?.startedAt.getTime() ?? 0) + 1);
  for (const [index, floorId] of uniqueIds.entries()) {
    const queuedAt = new Date(now + index);
    const values = {
      floorId,
      organizationId,
      runId: randomUUID(),
      status: "queued",
      startedAt: queuedAt,
      heartbeatAt: queuedAt,
      finishedAt: null,
      workerPid: null,
      workerBootId: null,
      workerStartTicks: null,
      error: null,
      result: null,
      log: [{ at: now, message: "Queued for room detection" }],
    };
    await tx
      .insert(roomDetectionJobs)
      .values(values)
      .onConflictDoUpdate({
        target: roomDetectionJobs.floorId,
        set: values,
        setWhere: notInArray(roomDetectionJobs.status, ["queued", "running"]),
      });
  }
  const rows = await tx
    .select({
      floorId: roomDetectionJobs.floorId,
      runId: roomDetectionJobs.runId,
      status: roomDetectionJobs.status,
    })
    .from(roomDetectionJobs)
    .where(
      and(
        inArray(roomDetectionJobs.floorId, uniqueIds),
        eq(roomDetectionJobs.organizationId, organizationId),
      ),
    );
  return uniqueIds.map((floorId) => {
    const row = rows.find((candidate) => candidate.floorId === floorId);
    if (!row || (row.status !== "queued" && row.status !== "running"))
      throw new Error("Room detection queue changed during enqueue");
    return { floorId: row.floorId, runId: row.runId, status: row.status };
  });
}

async function recoverLocked(tx: DetectionTx) {
  const running = await tx
    .select()
    .from(roomDetectionJobs)
    .where(eq(roomDetectionJobs.status, "running"))
    .for("update");
  for (const row of running) {
    const alive = row.workerPid
      ? row.workerBootId && row.workerStartTicks
        ? await sameProcess({
            pid: row.workerPid,
            bootId: row.workerBootId,
            startTicks: row.workerStartTicks,
          })
        : !!(await processIdentity(row.workerPid))
      : Date.now() - row.heartbeatAt.getTime() < WORKER_START_GRACE_MS;
    // A slow heartbeat alone never permits another worker to overlap a live one.
    if (alive) continue;
    const log = readLog(row.log);
    const retries = log.filter(
      (entry) => entry.event === "queue-recovery",
    ).length;
    const exhausted = retries >= MAX_RECOVERIES;
    const now = new Date();
    const message = exhausted
      ? "Room detection worker repeatedly stopped. Retry this drawing manually."
      : "Detection was interrupted. Requeued automatically.";
    await tx
      .update(roomDetectionJobs)
      .set({
        status: exhausted ? "error" : "queued",
        // Fence any delayed writes from the interrupted process/run.
        runId: exhausted ? row.runId : randomUUID(),
        startedAt: now,
        heartbeatAt: now,
        finishedAt: exhausted ? now : null,
        workerPid: null,
        workerBootId: null,
        workerStartTicks: null,
        error: exhausted ? message : null,
        result: null,
        log: [
          ...log,
          {
            at: now.getTime(),
            message,
            ...(exhausted ? {} : { event: "queue-recovery" as const }),
          },
        ],
      })
      .where(
        and(
          eq(roomDetectionJobs.floorId, row.floorId),
          eq(roomDetectionJobs.runId, row.runId),
          eq(roomDetectionJobs.status, "running"),
        ),
      );
  }
}

export async function recoverDetectJobs() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DETECT_QUEUE_LOCK})`);
    await recoverLocked(tx);
  });
}

/** Global concurrency is one, even with several Next processes/dispatchers. */
export async function claimNextDetectJob(): Promise<{
  floorId: string;
  runId: string;
} | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DETECT_QUEUE_LOCK})`);
    await recoverLocked(tx);
    const [running] = await tx
      .select({ floorId: roomDetectionJobs.floorId })
      .from(roomDetectionJobs)
      .where(eq(roomDetectionJobs.status, "running"))
      .limit(1);
    if (running) return null;
    const [queued] = await tx
      .select()
      .from(roomDetectionJobs)
      .where(eq(roomDetectionJobs.status, "queued"))
      .orderBy(asc(roomDetectionJobs.startedAt), asc(roomDetectionJobs.floorId))
      .limit(1)
      .for("update");
    if (!queued) return null;
    const now = new Date();
    await tx
      .update(roomDetectionJobs)
      .set({
        status: "running",
        startedAt: now,
        heartbeatAt: now,
        log: [
          ...readLog(queued.log),
          { at: now.getTime(), message: "Starting room detection…" },
        ],
      })
      .where(
        and(
          eq(roomDetectionJobs.floorId, queued.floorId),
          eq(roomDetectionJobs.runId, queued.runId),
          eq(roomDetectionJobs.status, "queued"),
        ),
      );
    return { floorId: queued.floorId, runId: queued.runId };
  });
}
