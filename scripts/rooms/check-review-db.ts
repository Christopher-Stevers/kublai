import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { registerHooks } from "node:module";
if (
  !process.env.RELIABILITY_TEST_DB ||
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/reliability_test" ||
  new URL(process.env.DATABASE_URL).hostname !== "" ||
  !process.env.PGHOST?.startsWith("/tmp/")
)
  throw Error("Disposable database required");
// The caller supplies an authenticated fixture context. Never call a live identity
// provider from this isolated database test; fail if context creation is attempted.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@clerk/nextjs/server")
      return {
        url: 'data:text/javascript,export async function auth(){throw Error("Unexpected auth call")};export async function currentUser(){throw Error("Unexpected identity call")}',
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [isolation] =
    await sql`SELECT current_database() AS name, inet_server_addr() AS address`;
  assert.equal(isolation?.name, "reliability_test");
  assert.equal(isolation?.address, null, "Disposable Unix socket required");
  await sql.unsafe(
    await readFile("drizzle/0040_room_review_feedback.sql", "utf8"),
  );
  await sql.unsafe(
    await readFile("drizzle/0041_room_completeness_review.sql", "utf8"),
  );
  const { db } = await import("../../src/server/db");
  const { roomsRouter } = await import("../../src/server/api/routers/rooms");
  const [user] =
    await sql`select * from kublai_user u where "organizationId" is not null and exists (select 1 from kublai_job_floor f where f."organizationId" = u."organizationId") limit 1`;
  assert.ok(user);
  const [floor] =
    await sql`select * from kublai_job_floor where "organizationId"=${user.organizationId} limit 1`;
  assert.ok(floor);
  // Work on a new floor in the restored database so unrelated pending rooms
  // cannot influence the approval/confirmation and rerun assertions.
  const fixtureFloor = randomUUID();
  await sql`insert into kublai_job_floor(id,"organizationId","jobId","floorPlanId","pageNumber",name,"imageUrl",width,height,"createdAt","updatedAt") values(${fixtureFloor},${user.organizationId},${floor.jobId},${floor.floorPlanId},9876,'Review fixture',${floor.imageUrl},200,160,now(),now())`;
  floor.id = fixtureFloor;
  floor.pageNumber = 9876;
  const context = {
    db,
    user: {
      ...user,
      role: "admin",
      accountType: "managing",
      organizationAccessStatus: "approved",
    },
    userId: user.id,
    headers: new Headers(),
  };
  const api = roomsRouter.createCaller(context as never);
  const id = randomUUID(),
    shape = { type: "bbox" as const, x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
  await sql`insert into kublai_job_room(id,"organizationId","jobId","floorId",name,shape,source,"createdAt","updatedAt")values(${id},${user.organizationId},${floor.jobId},${floor.id},'Review test',${sql.json(shape)},'auto',now(),now())`;
  const stamp = async () =>
    (
      await sql`select "updatedAt" from kublai_job_room where id=${id}`
    )[0]!.updatedAt.getTime();
  const initial = await stamp();
  await api.reviewRoom({
    roomId: id,
    decision: "approved",
    expectedUpdatedAt: initial,
  });
  assert.equal(
    (
      await sql`select "reviewStatus",confirmed from kublai_job_room where id=${id}`
    )[0]!.confirmed,
    true,
  );
  await assert.rejects(
    api.reviewRoom({
      roomId: id,
      decision: "rejected",
      expectedUpdatedAt: initial,
    }),
    /changed/,
  );
  await api.reviewRoom({
    roomId: id,
    decision: "rejected",
    reason: "not-space",
    expectedUpdatedAt: await stamp(),
  });
  assert.equal(
    (await sql`select "reviewStatus" from kublai_job_room where id=${id}`)[0]!
      .reviewStatus,
    "rejected",
  );
  assert.equal(
    (
      await sql`select detection from kublai_room_detection_feedback where "roomId"=${id} and decision='rejected' order by "createdAt" desc limit 1`
    )[0]!.detection.reviewReason,
    "not-space",
  );
  await api.reviewRoom({
    roomId: id,
    decision: "pending",
    expectedUpdatedAt: await stamp(),
  });
  const savedEdit = await api.updateRoom({
    roomId: id,
    shape: { ...shape, w: 0.12 },
  });
  assert.equal(
    savedEdit.updatedAt,
    await stamp(),
    "Edit response returns its exact saved CAS version",
  );
  assert.equal(
    (await sql`select source from kublai_job_room where id=${id}`)[0]!.source,
    "manual",
  );
  const [count] =
    await sql`select count(*) from kublai_room_detection_feedback where "roomId"=${id}`;
  assert.equal(Number(count!.count), 4);
  await assert.rejects(
    api.updateRoom({
      roomId: id,
      name: "Stale rename",
      expectedUpdatedAt: initial,
    }),
    /changed/,
  );
  const crossed = {
    type: "polygon" as const,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.3 },
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.1 },
    ],
  };
  await assert.rejects(
    api.updateRoom({
      roomId: id,
      shape: crossed,
      expectedUpdatedAt: await stamp(),
    }),
    /invalid boundaries/,
  );
  await sql`update kublai_job_room set shape=${sql.json(crossed)} where id=${id}`;
  await assert.rejects(
    api.reviewRoom({
      roomId: id,
      decision: "approved",
      expectedUpdatedAt: await stamp(),
    }),
    /boundaries are invalid/,
  );
  await sql`update kublai_job_room set shape=${sql.json(shape)},"reviewStatus"='superseded' where id=${id}`;
  await assert.rejects(
    api.reviewRoom({
      roomId: id,
      decision: "approved",
      expectedUpdatedAt: await stamp(),
    }),
    /superseded/,
  );
  await assert.rejects(
    api.updateRoom({
      roomId: id,
      name: "Old proposal",
      expectedUpdatedAt: await stamp(),
    }),
    /superseded/,
  );
  await sql`update kublai_job_room set "reviewStatus"='pending' where id=${id}`;
  const other = roomsRouter.createCaller({
    ...context,
    user: { ...context.user, organizationId: randomUUID() },
  } as never);
  await assert.rejects(
    other.reviewRoom({
      roomId: id,
      decision: "approved",
      expectedUpdatedAt: await stamp(),
    }),
    /NOT_FOUND|Not found|not found/,
  );
  const standard = roomsRouter.createCaller({
    ...context,
    user: { ...context.user, accountType: "standard", role: "worker" },
  } as never);
  await assert.rejects(
    standard.reviewRoom({
      roomId: id,
      decision: "approved",
      expectedUpdatedAt: await stamp(),
    }),
    /FORBIDDEN|Forbidden/,
  );
  const { enqueueDetectJobs, saveCompleteCandidates, setDetectWorkerPid } =
    await import("../../src/server/rooms/detect-job");
  const { claimNextDetectJob } =
    await import("../../src/server/rooms/detect-queue");
  const claimFixture = async (floorId: string, organizationId: string) => {
    await enqueueDetectJobs([floorId], organizationId);
    const claimed = await claimNextDetectJob();
    assert.equal(
      claimed?.floorId,
      floorId,
      "Fixture obtains the global worker slot",
    );
    assert.ok(claimed);
    await setDetectWorkerPid(floorId, process.pid, claimed.runId);
    return claimed.runId;
  };
  const { toPolygon } = await import("../../src/lib/room-shape");
  await sql`update kublai_room_detection_job set status='error'`;
  const candidate = (x: number, name: string) => ({
    name,
    shape: toPolygon({ ...shape, x }),
    detection: {
      version: "test",
      basis: "walls-without-label",
      areaFraction: 0.01,
      requiresReview: true,
    },
  });
  const { sourceDrawingHash } =
    await import("../../src/server/rooms/drawing-hash");
  const fixtureDrawingHash = await sourceDrawingHash({
    imageUrl: String(floor.imageUrl),
    jobId: String(floor.jobId),
  });
  assert.ok(
    fixtureDrawingHash,
    "Restored floor has its actual private PDF source",
  );
  const candidates = [
    candidate(0.2, "Keep"),
    candidate(0.5, "Reject"),
    candidate(0.7, "Correct"),
  ];
  const save = async () => {
    const runId = await claimFixture(floor.id, user.organizationId);
    assert.ok(runId);
    return saveCompleteCandidates(
      {
        floorId: floor.id,
        jobId: floor.jobId,
        organizationId: user.organizationId,
        imageUrl: floor.imageUrl,
        pageNumber: floor.pageNumber,
        runId,
      },
      candidates,
      fixtureDrawingHash,
    );
  };
  await sql`delete from kublai_job_room where id=${id}`;
  const fencedRun = await claimFixture(floor.id, user.organizationId);
  assert.ok(fencedRun);
  await assert.rejects(
    saveCompleteCandidates(
      {
        floorId: floor.id,
        jobId: randomUUID(),
        organizationId: user.organizationId,
        imageUrl: floor.imageUrl,
        pageNumber: floor.pageNumber,
        runId: fencedRun,
      },
      candidates,
      fixtureDrawingHash,
    ),
    /Drawing changed/,
  );
  await assert.rejects(
    saveCompleteCandidates(
      {
        floorId: floor.id,
        jobId: floor.jobId,
        organizationId: user.organizationId,
        imageUrl: floor.imageUrl,
        pageNumber: floor.pageNumber,
        runId: fencedRun,
      },
      candidates,
      "outdated-drawing-content",
    ),
    /Drawing contents changed/,
  );
  assert.equal(
    (
      await sql`select count(*)::int as count from kublai_job_room where "floorId"=${floor.id}`
    )[0]!.count,
    0,
    "Rejected source snapshots must not persist proposals",
  );
  await sql`update kublai_room_detection_job set status='error' where "floorId"=${floor.id}`;
  const first = await save();
  assert.equal(first.added, 3);
  const proposals =
    await sql`select * from kublai_job_room where "floorId"=${floor.id} order by name`;
  const keep = proposals.find((r) => r.name === "Keep")!,
    reject = proposals.find((r) => r.name === "Reject")!,
    correct = proposals.find((r) => r.name === "Correct")!;
  await assert.rejects(
    api.confirmFloor({ floorId: floor.id, completenessChecked: true }),
    /Approve or disapprove/,
  );
  await api.reviewRoom({
    roomId: keep.id,
    decision: "approved",
    expectedUpdatedAt: keep.updatedAt.getTime(),
  });
  await api.reviewRoom({
    roomId: reject.id,
    decision: "rejected",
    expectedUpdatedAt: reject.updatedAt.getTime(),
  });
  await api.updateRoom({
    roomId: correct.id,
    shape: { ...shape, x: 0.7, w: 0.13 },
  });
  const again = await save();
  assert.equal(again.added, 0);
  assert.equal(again.suppressed, 1);
  const saved =
    await sql`select * from kublai_job_room where "floorId"=${floor.id}`;
  assert.equal(saved.find((r) => r.id === keep.id)!.reviewStatus, "approved");
  assert.equal(saved.find((r) => r.id === reject.id)!.reviewStatus, "rejected");
  assert.equal(saved.find((r) => r.id === correct.id)!.shape.w, 0.13);
  assert.equal(saved.find((r) => r.id === correct.id)!.source, "manual");
  await api.reviewRoom({
    roomId: correct.id,
    decision: "approved",
    expectedUpdatedAt: saved
      .find((r) => r.id === correct.id)!
      .updatedAt.getTime(),
  });
  await assert.rejects(
    api.confirmFloor({ floorId: floor.id }),
    /Check the entire floor/,
  );
  await enqueueDetectJobs([floor.id], user.organizationId);
  await assert.rejects(
    api.deleteAllRooms({ floorId: floor.id }),
    /Wait for room detection/,
  );
  await assert.rejects(
    api.deleteFloor({ floorId: floor.id }),
    /Wait for room detection/,
  );
  await assert.rejects(
    api.copyFloor({ floorId: floor.id }),
    /Wait for room detection/,
  );
  await assert.rejects(
    api.confirmFloor({ floorId: floor.id, completenessChecked: true }),
    /Wait for room detection/,
  );
  const activeRun = await claimFixture(floor.id, user.organizationId);
  assert.ok(activeRun);
  await assert.rejects(
    api.deleteAllRooms({ floorId: floor.id }),
    /Wait for room detection/,
  );
  await assert.rejects(
    api.deleteFloor({ floorId: floor.id }),
    /Wait for room detection/,
  );
  await assert.rejects(
    api.confirmFloor({ floorId: floor.id, completenessChecked: true }),
    /Wait for room detection/,
  );
  await sql`update kublai_room_detection_job set status='done' where "floorId"=${floor.id}`;
  await api.confirmFloor({ floorId: floor.id, completenessChecked: true });
  const [attested] =
    await sql`select "completenessReviewedAt","confirmedAt" from kublai_job_floor where id=${floor.id}`;
  assert.ok(attested!.completenessReviewedAt instanceof Date);
  assert.equal(
    attested!.completenessReviewedAt.getTime(),
    attested!.confirmedAt.getTime(),
  );
  assert.equal(
    (await sql`select status from kublai_job_floor where id=${floor.id}`)[0]!
      .status,
    "confirmed",
  );
  assert.equal(
    (await sql`select confirmed from kublai_job_room where id=${reject.id}`)[0]!
      .confirmed,
    false,
  );
  const [confirmationEvidence] =
    await sql`select detection from kublai_room_detection_feedback where "roomId"=${keep.id} and decision='approved' order by "createdAt" desc limit 1`;
  assert.equal(confirmationEvidence!.detection.drawingHash, fixtureDrawingHash);
  assert.equal(confirmationEvidence!.detection.completenessAttested, true);
  const [manualProvenance] =
    await sql`select detection from kublai_job_room where id=${correct.id}`;
  assert.equal(manualProvenance!.detection.drawingHash, fixtureDrawingHash);
  await api.deleteAllRooms({ floorId: floor.id });
  const [reset] =
    await sql`select status,"completenessReviewedAt" from kublai_job_floor where id=${floor.id}`;
  assert.equal(reset!.completenessReviewedAt, null);
  await assert.rejects(
    api.confirmFloor({ floorId: floor.id, completenessChecked: true }),
    /at least one room/,
  );
  console.log(
    "Topology, source fencing, stale edits, nonempty completeness and active-run confirmation checks passed",
  );
  console.log(
    "Reruns retain approvals and corrected boundaries, suppress disapprovals, and require review before floor confirmation",
  );
  console.log(
    "Review persistence, stale edits, corrections, organization and role isolation passed",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end();
  process.exit(process.exitCode ?? 0);
}
