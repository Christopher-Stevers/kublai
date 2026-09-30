// Runs only against a disposable restored database; never point this at production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
if (
  !process.env.RELIABILITY_TEST_DB ||
  !process.env.DATABASE_URL?.includes("/reliability_test")
)
  throw new Error("Disposable reliability_test database required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(
    await readFile("drizzle/0039_reliability_revisions.sql", "utf8"),
  );
  const [job] = await sql`SELECT id, "organizationId" FROM kublai_job LIMIT 1`;
  assert.ok(job, "Restored fixture job");
  const count = async (kind: string, scope: string) =>
    (
      await sql`SELECT revision::text FROM kublai_sync_revision WHERE kind=${kind} AND scope=${scope}`
    )[0]?.revision ?? "0";
  const before = await count("material-lists", job.organizationId);
  await sql`UPDATE kublai_job SET name = name || ' test' WHERE id = ${job.id}`;
  assert.notEqual(await count("material-lists", job.organizationId), before);
  assert.equal(
    await count("material-lists", randomUUID()),
    "0",
    "Unrelated org is not invalidated",
  );
  const committed = await count("material-lists", job.organizationId);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(
        "UPDATE kublai_job SET name = name || ' rollback' WHERE id = $1",
        [job.id],
      );
      throw Error("rollback");
    });
  } catch {
    /* expected */
  }
  assert.equal(
    await count("material-lists", job.organizationId),
    committed,
    "Counters roll back with source writes",
  );
  const [item] =
    await sql`SELECT qi.id, q."organizationId" FROM kublai_quote_item qi JOIN kublai_quote q ON q.id = qi."quoteId" LIMIT 1`;
  assert.ok(item);
  const childBefore = await count("material-lists", item.organizationId);
  await sql`DELETE FROM kublai_quote_item WHERE id = ${item.id}`;
  assert.notEqual(
    await count("material-lists", item.organizationId),
    childBefore,
    "Child deletion resolves parent org",
  );
  const globalBefore = await count("catalogue", "*");
  await sql`UPDATE kublai_unit SET "displayName" = "displayName" || ' test' WHERE id = (SELECT id FROM kublai_unit LIMIT 1)`;
  assert.notEqual(
    await count("catalogue", "*"),
    globalBefore,
    "Shared metadata invalidates all organizations",
  );
  const {
    beginDetectJob,
    failDetectJob,
    getDetectJob,
    setDetectWorkerPid,
    runQueuedDetectJob,
  } = await import("../src/server/rooms/detect-job");
  await sql`UPDATE kublai_room_detection_job SET status = 'error'`;
  const floors =
    await sql`SELECT id, "organizationId" FROM kublai_job_floor LIMIT 3`;
  assert.equal(floors.length, 3, "Three fixture floors");
  const first = await beginDetectJob(floors[0]!.id, floors[0]!.organizationId);
  assert.ok(first);
  await setDetectWorkerPid(floors[0]!.id, process.pid, first);
  const second = await beginDetectJob(floors[1]!.id, floors[1]!.organizationId);
  assert.ok(second);
  assert.equal(
    await beginDetectJob(floors[2]!.id, floors[2]!.organizationId),
    null,
    "Global concurrency limit",
  );
  await failDetectJob(floors[0]!.id, "stopped", first);
  const replacement = await beginDetectJob(
    floors[0]!.id,
    floors[0]!.organizationId,
  );
  assert.ok(replacement);
  assert.notEqual(replacement, first);
  await failDetectJob(floors[0]!.id, "late old failure", first);
  await setDetectWorkerPid(floors[0]!.id, 99999999, first);
  await runQueuedDetectJob(floors[0]!.id, "standard", first);
  const current = await getDetectJob(floors[0]!.id);
  assert.equal(current?.runId, replacement);
  assert.equal(current?.status, "running");
  await sql`UPDATE kublai_room_detection_job SET "startedAt" = now() - interval '20 seconds', "workerPid" = NULL WHERE "floorId" = ${floors[0]!.id}`;
  assert.equal((await getDetectJob(floors[0]!.id))?.status, "error", "Crashed launch reservation recovers after its grace period");
  const third = await beginDetectJob(floors[2]!.id, floors[2]!.organizationId); assert.ok(third);
  await setDetectWorkerPid(floors[2]!.id, process.pid, third);
  await sql`UPDATE kublai_room_detection_job SET "workerStartTicks" = 'impossible-old-start' WHERE "floorId" = ${floors[2]!.id}`;
  assert.equal((await getDetectJob(floors[2]!.id))?.status, "error", "A reused PID does not keep an old worker alive");
  console.log(
    "Worker integration checks passed: concurrency admission, stale exit fencing, stale PID update, stale launch",
  );
  const { startDetectWorker } = await import("../src/server/rooms/detect-worker-process");
  const native = await beginDetectJob(floors[2]!.id, floors[2]!.organizationId); assert.ok(native);
  const [workerFloor] = await sql`SELECT "jobId" FROM kublai_job_floor WHERE id = ${floors[2]!.id}`;
  await sql`UPDATE kublai_job_floor SET "imageUrl" = ${`/api/job-rooms/files/${workerFloor!.jobId}/${randomUUID()}/floor-1.webp`} WHERE id = ${floors[2]!.id}`;
  const [beforeRooms] = await sql`SELECT count(*)::int AS count FROM kublai_job_room`;
  await startDetectWorker(floors[2]!.id, "standard", native);
  const deadline = Date.now() + 20000;
  let nativeState = await getDetectJob(floors[2]!.id);
  while (nativeState?.status === "running" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100)); nativeState = await getDetectJob(floors[2]!.id);
  }
  assert.equal(nativeState?.status, "error");
  assert.match(nativeState?.error ?? "", /ENOENT/, "Worker reached the PDF reader inside its resource-bounded launcher");
  const [afterRooms] = await sql`SELECT count(*)::int AS count FROM kublai_job_room`;
  assert.equal(afterRooms!.count, beforeRooms!.count, "Failed worker leaves saved rooms unchanged");
  console.log("Native worker launch, deadline/cgroup setup and failure reporting passed");
  await sql`TRUNCATE kublai_size CASCADE`;
  assert.notEqual(await count("catalogue", "*"), globalBefore);
  console.log(
    "Revision integration checks passed: direct updates, isolation, rollback, child delete, shared metadata, truncate",
  );
} finally {
  await sql.end();
}
process.exit(0);
