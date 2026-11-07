// Runs only against a disposable restored database; never point this at production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
if (
  !process.env.RELIABILITY_TEST_DB ||
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/reliability_test" ||
  new URL(process.env.DATABASE_URL).hostname !== "" ||
  !process.env.PGHOST?.startsWith("/tmp/")
)
  throw new Error("Disposable reliability_test database required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [isolation] =
    await sql`SELECT current_database() AS name, inet_server_addr() AS address`;
  assert.equal(isolation?.name, "reliability_test");
  assert.equal(isolation?.address, null, "Disposable Unix socket required");
  await sql.unsafe(
    await readFile("drizzle/0039_reliability_revisions.sql", "utf8"),
  );
  const [job] =
    await sql`SELECT id, "organizationId" FROM kublai_job j WHERE (SELECT count(*) FROM kublai_job_floor f WHERE f."organizationId" = j."organizationId") >= 3 LIMIT 1`;
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
  const { enqueueDetectJobs, claimNextDetectJob, recoverDetectJobs } =
    await import("../src/server/rooms/detect-queue");
  const {
    failDetectJob,
    getDetectJob,
    setDetectWorkerPid,
    runQueuedDetectJob,
  } = await import("../src/server/rooms/detect-job");
  const { db } = await import("../src/server/db");
  const { processIdentity } =
    await import("../src/server/rooms/process-identity");
  const identity = await processIdentity();
  assert.ok(identity);
  const floors = await sql<{ id: string; organizationId: string }[]>`
    SELECT id, "organizationId" FROM kublai_job_floor
    WHERE "organizationId" = ${job.organizationId} ORDER BY id LIMIT 3`;
  assert.equal(floors.length, 3, "Three fixture floors in one organization");
  const floorIds = floors.map((floor) => floor.id);
  const resetQueue = () => sql`DELETE FROM kublai_room_detection_job`;
  const queueRows = () => sql`
    SELECT * FROM kublai_room_detection_job ORDER BY "startedAt", "floorId"`;
  const makeDead = (floorId: string) => sql`
    UPDATE kublai_room_detection_job
    SET "workerPid" = 2147483647, "workerBootId" = 'missing', "workerStartTicks" = 'missing',
        "startedAt" = now() - interval '1 minute', "heartbeatAt" = now() - interval '1 minute'
    WHERE "floorId" = ${floorId}`;
  const [savedBefore] =
    await sql`SELECT count(*)::int AS count FROM kublai_job_room`;
  await resetQueue();

  // Concurrent overlapping HTTP batches deduplicate in the same advisory-lock
  // transaction, even though each call uses the application's connection pool.
  await Promise.all([
    enqueueDetectJobs([floorIds[0]!, floorIds[1]!], job.organizationId),
    enqueueDetectJobs([floorIds[1]!, floorIds[2]!], job.organizationId),
    enqueueDetectJobs([floorIds[0]!, floorIds[2]!], job.organizationId),
  ]);
  const enqueued = await queueRows();
  assert.equal(enqueued.length, 3);
  assert.ok(enqueued.every((entry) => entry.status === "queued"));
  const oldTokens = new Map(
    enqueued.map((entry) => [entry.floorId, entry.runId]),
  );
  await enqueueDetectJobs(floorIds, job.organizationId);
  assert.ok(
    (await queueRows()).every(
      (entry) => oldTokens.get(entry.floorId) === entry.runId,
    ),
    "Repeated batches retain their existing runs",
  );

  // Queued work can wait overnight without being mistaken for a dead worker.
  await sql`UPDATE kublai_room_detection_job SET "startedAt" = now() - interval '2 days', "heartbeatAt" = now() - interval '2 days' WHERE "floorId" = ${floorIds[2]!}`;
  await recoverDetectJobs();
  assert.equal((await getDetectJob(floorIds[2]!))?.status, "queued");
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => claimNextDetectJob()),
  );
  const claimed = claims.filter((entry) => entry !== null);
  assert.equal(
    claimed.length,
    1,
    "Only one claim wins across concurrent dispatchers",
  );
  const first = claimed[0]!;
  assert.equal(first.floorId, floorIds[2], "Oldest queued work starts first");
  assert.equal((await getDetectJob(first.floorId))?.status, "running");
  await setDetectWorkerPid(first.floorId, process.pid, first.runId);
  await sql`UPDATE kublai_room_detection_job SET "heartbeatAt" = now() - interval '2 days' WHERE "floorId" = ${first.floorId}`;
  await recoverDetectJobs();
  assert.equal(
    (await getDetectJob(first.floorId))?.status,
    "running",
    "A live worker keeps its slot even if synchronous native work delays heartbeat",
  );
  assert.equal(await claimNextDetectJob(), null);
  await enqueueDetectJobs([first.floorId], job.organizationId);
  assert.equal(
    (await getDetectJob(first.floorId))?.runId,
    first.runId,
    "Submitting a running floor is idempotent",
  );

  // One failed floor frees capacity and does not discard the rest of the batch.
  await failDetectJob(first.floorId, "Simulated detector failure", first.runId);
  const second = await claimNextDetectJob();
  assert.ok(second);
  assert.notEqual(second.floorId, first.floorId);
  await setDetectWorkerPid(second.floorId, process.pid, second.runId);
  await failDetectJob(
    second.floorId,
    "Simulated second completion",
    second.runId,
  );
  const third = await claimNextDetectJob();
  assert.ok(third);
  assert.notEqual(third.floorId, first.floorId);
  assert.notEqual(third.floorId, second.floorId);
  await failDetectJob(third.floorId, "Simulated third completion", third.runId);
  assert.equal(await claimNextDetectJob(), null);

  // A new user retry gets a fresh run; a late old process cannot fail, attach
  // its PID to, or execute the replacement.
  await enqueueDetectJobs([first.floorId], job.organizationId);
  const replacement = await claimNextDetectJob();
  assert.ok(replacement);
  assert.notEqual(replacement.runId, first.runId);
  await setDetectWorkerPid(replacement.floorId, process.pid, replacement.runId);
  await failDetectJob(first.floorId, "Late stale worker error", first.runId);
  await setDetectWorkerPid(first.floorId, 2147483647, first.runId);
  await runQueuedDetectJob(first.floorId, "complete", first.runId);
  const current = await getDetectJob(first.floorId);
  assert.equal(current?.runId, replacement.runId);
  assert.equal(current?.status, "running");
  const [fenced] =
    await sql`SELECT "workerPid" FROM kublai_room_detection_job WHERE "floorId" = ${first.floorId}`;
  assert.equal(fenced?.workerPid, process.pid);

  // A detached process that died after the HTTP request ended is recovered.
  await makeDead(replacement.floorId);
  await recoverDetectJobs();
  const recovered = await getDetectJob(replacement.floorId);
  assert.equal(recovered?.status, "queued");
  assert.notEqual(recovered?.runId, replacement.runId);
  await failDetectJob(
    replacement.floorId,
    "Late exit after recovery",
    replacement.runId,
  );
  assert.equal((await getDetectJob(replacement.floorId))?.status, "queued");
  const afterRecovery = await claimNextDetectJob();
  assert.ok(afterRecovery);
  await setDetectWorkerPid(
    afterRecovery.floorId,
    process.pid,
    afterRecovery.runId,
  );
  await sql`UPDATE kublai_room_detection_job SET "workerStartTicks" = 'reused-pid' WHERE "floorId" = ${afterRecovery.floorId}`;
  await recoverDetectJobs();
  assert.equal(
    (await getDetectJob(afterRecovery.floorId))?.status,
    "queued",
    "PID reuse cannot hold an old lease",
  );
  const finalAttempt = await claimNextDetectJob();
  assert.ok(finalAttempt);
  await makeDead(finalAttempt.floorId);
  await recoverDetectJobs();
  assert.equal(
    (await getDetectJob(finalAttempt.floorId))?.status,
    "error",
    "Repeated process crashes are bounded rather than retried forever",
  );

  // Lost launch reservations recover only after the startup grace period.
  await resetQueue();
  await enqueueDetectJobs([floorIds[0]!], job.organizationId);
  const launching = await claimNextDetectJob();
  assert.ok(launching);
  await recoverDetectJobs();
  assert.equal((await getDetectJob(launching.floorId))?.status, "running");
  await sql`UPDATE kublai_room_detection_job SET "startedAt" = now() - interval '1 minute', "heartbeatAt" = now() - interval '1 minute' WHERE "floorId" = ${launching.floorId}`;
  await recoverDetectJobs();
  assert.equal((await getDetectJob(launching.floorId))?.status, "queued");

  // An accepted batch and its floor metadata must commit or roll back together.
  await resetQueue();
  await assert.rejects(
    db.transaction(async (tx) => {
      await enqueueDetectJobs(floorIds, job.organizationId, tx);
      throw new Error("rollback-queue-fixture");
    }),
    /rollback-queue-fixture/,
  );
  assert.equal((await queueRows()).length, 0);
  await assert.rejects(enqueueDetectJobs([randomUUID()], job.organizationId));
  assert.equal(
    (await queueRows()).length,
    0,
    "Invalid floor leaves no orphan queue row",
  );
  await assert.rejects(enqueueDetectJobs([floorIds[0]!], randomUUID()));
  await assert.rejects(
    enqueueDetectJobs([floorIds[0]!, randomUUID()], job.organizationId),
  );
  assert.equal(
    (await queueRows()).length,
    0,
    "Mixed invalid batch is atomic and tenant-scoped",
  );
  const deletedFloor = randomUUID();
  await sql`INSERT INTO kublai_job_floor (id, "organizationId", "jobId", "floorPlanId", "pageNumber", name, "imageUrl", width, height, status, "createdAt", "updatedAt")
    SELECT ${deletedFloor}, "organizationId", "jobId", "floorPlanId", 987654, 'Queue deletion fixture', "imageUrl", width, height, 'detected', now(), now()
    FROM kublai_job_floor WHERE id = ${floorIds[0]!}`;
  await enqueueDetectJobs([deletedFloor], job.organizationId);
  await sql`DELETE FROM kublai_job_floor WHERE id = ${deletedFloor}`;
  assert.equal(
    await claimNextDetectJob(),
    null,
    "Deleting a parent floor cascades the waiting queue entry",
  );
  const [savedAfter] =
    await sql`SELECT count(*)::int AS count FROM kublai_job_room`;
  assert.equal(
    savedAfter?.count,
    savedBefore?.count,
    "Queue failures and recovery do not change saved room outlines",
  );
  console.log(
    "Queue integration checks passed: concurrent batches/claims, FIFO, global single worker, idempotence, failure advancement, retry fencing, PID identity, bounded crash recovery, startup grace, rollback and outline preservation",
  );
  // Exercise the real shell/cgroup/flock path against a deliberately absent PDF.
  // Keep this queue empty otherwise: the exit callback may dispatch the next row.
  await resetQueue();
  await enqueueDetectJobs([floorIds[2]!], job.organizationId);
  const native = await claimNextDetectJob();
  assert.ok(native);
  const [workerFloor] =
    await sql`SELECT "jobId" FROM kublai_job_floor WHERE id = ${native.floorId}`;
  await sql`UPDATE kublai_job_floor SET "imageUrl" = ${`/api/job-rooms/files/${workerFloor!.jobId}/${randomUUID()}/floor-1.webp`} WHERE id = ${native.floorId}`;
  const { startDetectWorker } =
    await import("../src/server/rooms/detect-worker-process");
  // dotenv treats any nonempty override option (even "false") as enabled.
  // Preserve the disposable URL inherited by the native worker.
  delete process.env.DOTENV_CONFIG_OVERRIDE;
  await startDetectWorker(native.floorId, "complete", native.runId);
  const deadline = Date.now() + 20000;
  let nativeState = await getDetectJob(native.floorId);
  while (nativeState?.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    nativeState = await getDetectJob(native.floorId);
  }
  assert.equal(nativeState?.status, "error");
  assert.match(
    nativeState?.error ?? "",
    /ENOENT/,
    "Native resource-bounded worker reached the isolated missing-PDF fixture",
  );
  const [nativeRooms] =
    await sql`SELECT count(*)::int AS count FROM kublai_job_room`;
  assert.equal(
    nativeRooms?.count,
    savedBefore?.count,
    "Native launch failure preserves all room outlines",
  );
  await resetQueue();
  console.log(
    "Native worker integration passed: queued claim, inherited flock, resource-bounded launcher, missing-PDF failure and saved-room preservation",
  );
  await sql`TRUNCATE kublai_size CASCADE`;
  assert.notEqual(await count("catalogue", "*"), globalBefore);
  console.log(
    "Revision integration checks passed: direct updates, isolation, rollback, child delete, shared metadata, truncate",
  );
} finally {
  await sql.end();
}
process.exit(0);
