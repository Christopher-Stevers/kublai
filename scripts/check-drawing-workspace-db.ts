/** Run only against a disposable, schema-initialized local database. No production data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDrawingAttachment } from "../src/server/drawings/attachments";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/server/db/schema";
import { drawingSaveSchema } from "../src/lib/drawing-workspace";
import {
  archiveDrawingEntity,
  assertSheetsNotReferenced,
  commentDrawingEntity,
  favoriteDrawing,
  getDrawingWorkspace,
  listDrawingWorkspace,
  saveDrawingEntity,
  saveDrawingMetadata,
  setDrawingCurrentVersion,
  watchDrawing,
} from "../src/server/drawings/service";
import {
  drawingNotificationInbox,
  readDrawingNotification,
} from "../src/server/drawings/notifications";
import { drainDrawingPush } from "../src/server/drawings/push-worker";
const url = process.env.DRAWING_WORKSPACE_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set DRAWING_WORKSPACE_TEST_DATABASE_URL to an isolated test database",
  );
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  !parsed.pathname.startsWith("/test_drawings_")
)
  throw new Error("Refusing a non-local or non-test drawing database");
const sql = postgres(url, { max: 8 });
const db = drizzle(sql, { schema });
const org = randomUUID(),
  foreignOrg = randomUUID();
const job = randomUUID(),
  otherJob = randomUUID(),
  foreignJob = randomUUID();
const set = randomUUID(),
  otherSet = randomUUID(),
  foreignSet = randomUUID();
const sheet = randomUUID(),
  source = randomUUID(),
  otherSheet = randomUUID(),
  foreignSheet = randomUUID();
const manager = `manager_${randomUUID()}`,
  worker = `worker_${randomUUID()}`,
  assignee = `assignee_${randomUUID()}`,
  stranger = `stranger_${randomUUID()}`,
  outsider = `outsider_${randomUUID()}`;
const admin = { db, userId: manager },
  field = { db, userId: worker },
  assigned = { db, userId: assignee },
  strangerCtx = { db, userId: stranger };
let checks = 0;
const ok = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
};
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(
    promise,
    (error: unknown) =>
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code,
  );
  checks++;
}
const markup = {
  sourceSheetId: sheet,
  type: "line",
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.8, y: 0.8 },
  ],
  stroke: "#ff0000",
  width: 2,
};
function mark(overrides: Record<string, unknown> = {}) {
  return drawingSaveSchema.parse({
    sheetId: sheet,
    id: randomUUID(),
    kind: "markup",
    visibility: "private",
    expectedRevision: 0,
    data: markup,
    ...overrides,
  });
}
try {
  await sql`insert into kublai_organization (id,name,"createdAt") values (${org},'Drawing test',now()),(${foreignOrg},'Other organization',now())`;
  for (const [id, orgId, role] of [
    [manager, org, "admin"],
    [worker, org, "worker"],
    [assignee, org, "worker"],
    [stranger, org, "worker"],
    [outsider, foreignOrg, "admin"],
  ])
    await sql`insert into kublai_user (id,name,email,role,"organizationId","organizationAccessStatus","createdAt","updatedAt") values (${id!},'Tester',${id! + "@example.test"},${role!},${orgId!},'approved',now(),now())`;
  for (const [id, orgId] of [
    [job, org],
    [otherJob, org],
    [foreignJob, foreignOrg],
  ])
    await sql`insert into kublai_job (id,name,"organizationId","createdAt") values (${id!},'Drawing test',${orgId!},now())`;
  for (const [id, jobId, orgId] of [
    [set, job, org],
    [otherSet, otherJob, org],
    [foreignSet, foreignJob, foreignOrg],
  ])
    await sql`insert into kublai_job_drawing_set (id,"jobId","organizationId",name) values (${id!},${jobId!},${orgId!},'Set')`;
  for (const [id, setId, jobId, orgId] of [
    [sheet, set, job, org],
    [source, set, job, org],
    [otherSheet, otherSet, otherJob, org],
    [foreignSheet, foreignSet, foreignJob, foreignOrg],
  ])
    await sql`insert into kublai_job_drawing_sheet (id,"setId","jobId","organizationId",name,"imageUrl",width,height) values (${id!},${setId!},${jobId!},${orgId!},'A101',${`/api/job-rooms/files/${jobId}/${id}/page-1.png`},1000,800)`;
  const initial = await getDrawingWorkspace(field, sheet);
  ok(
    initial.entities.length === 0 &&
      initial.metadata.revision === 0 &&
      initial.actor.id === worker,
    "initial state",
  );
  await rejects(
    getDrawingWorkspace({ db, userId: outsider }, sheet),
    "NOT_FOUND",
  );
  await rejects(
    saveDrawingEntity({ db, userId: outsider }, mark()),
    "NOT_FOUND",
  );
  await rejects(
    saveDrawingEntity(field, mark({ visibility: "published" })),
    "FORBIDDEN",
  );
  await rejects(
    saveDrawingEntity(admin, mark({ expectedUserId: worker })),
    "CONFLICT",
  );
  const own = await saveDrawingEntity(field, mark());
  ok(
    (await getDrawingWorkspace(field, sheet)).entities.length === 1,
    "owner sees private",
  );
  ok(
    (await getDrawingWorkspace(admin, sheet)).entities.length === 0,
    "manager cannot see private",
  );
  ok(
    (await getDrawingWorkspace(admin, sheet)).activity.length === 0,
    "private activity hidden",
  );
  await rejects(
    saveDrawingEntity(admin, mark({ id: own.id, expectedRevision: 1 })),
    "NOT_FOUND",
  );
  await rejects(
    commentDrawingEntity(admin, {
      sheetId: sheet,
      id: own.id,
      expectedRevision: 1,
      body: "no",
    }),
    "NOT_FOUND",
  );
  const concurrent = await Promise.allSettled([
    saveDrawingEntity(
      field,
      mark({
        id: own.id,
        expectedRevision: 1,
        data: { ...markup, text: "device A" },
      }),
    ),
    saveDrawingEntity(
      field,
      mark({
        id: own.id,
        expectedRevision: 1,
        data: { ...markup, text: "device B" },
      }),
    ),
  ]);
  ok(
    concurrent.filter((x) => x.status === "fulfilled").length === 1 &&
      concurrent.filter((x) => x.status === "rejected").length === 1,
    "exactly one stale writer wins",
  );
  const saved = (await getDrawingWorkspace(field, sheet)).entities.find(
    (x) => x.id === own.id,
  )!;
  ok(saved.revision === 2, "no lost update");
  await Promise.all(
    Array.from({ length: 5 }, () => saveDrawingEntity(field, mark())),
  );
  ok(
    (await getDrawingWorkspace(field, sheet)).entities.length === 6,
    "parallel independent creations retained",
  );
  await rejects(
    saveDrawingEntity(
      field,
      mark({ data: { ...markup, sourceSheetId: otherSheet } }),
    ),
    "BAD_REQUEST",
  );
  await rejects(
    saveDrawingEntity(
      field,
      mark({ data: { ...markup, targetSheetId: foreignSheet } }),
    ),
    "BAD_REQUEST",
  );
  await rejects(
    saveDrawingEntity(
      field,
      mark({
        data: {
          ...markup,
          href: `/api/drawings/attachments/${otherJob}/${randomUUID()}`,
        },
      }),
    ),
    "BAD_REQUEST",
  );
  await rejects(
    saveDrawingEntity(
      field,
      mark({
        data: {
          ...markup,
          href: `/api/job-rooms/files/${otherJob}/${otherSheet}/plan.pdf`,
        },
      }),
    ),
    "BAD_REQUEST",
  );

  const replayInput = mark({ expectedUserId: worker });
  const replayFirst = await saveDrawingEntity(field, replayInput);
  const activityBeforeReplay = await sql<
    { n: number }[]
  >`select count(*)::int n from kublai_drawing_workspace_activity where "sheetId"=${sheet}`;
  const replayed = await saveDrawingEntity(field, replayInput);
  ok(
    replayed.id === replayFirst.id && replayed.revision === 1,
    "lost create response replays idempotently",
  );
  ok(
    (
      await sql<
        { n: number }[]
      >`select count(*)::int n from kublai_drawing_workspace_activity where "sheetId"=${sheet}`
    )[0]!.n === activityBeforeReplay[0]!.n,
    "replay does not duplicate activity or notification enqueue",
  );
  await rejects(
    saveDrawingEntity(
      field,
      mark({ ...replayInput, data: { ...markup, text: "different payload" } }),
    ),
    "CONFLICT",
  );
  const replayEdit = mark({
    ...replayInput,
    expectedRevision: 1,
    data: { ...markup, text: "Saved change" },
  });
  await saveDrawingEntity(field, replayEdit);
  ok(
    (await saveDrawingEntity(field, replayEdit)).revision === 2,
    "lost edit response replays same private revision",
  );
  await rejects(saveDrawingEntity(field, replayInput), "CONFLICT");
  const fileLink = await saveDrawingEntity(
    field,
    mark({
      data: {
        ...markup,
        href: `/api/job-rooms/files/${job}/${sheet}/plan.pdf`,
      },
    }),
  );
  ok(
    fileLink.kind === "markup" && fileLink.data.href?.includes(job),
    "actual same-job file route accepted",
  );
  const published = await saveDrawingEntity(
    admin,
    mark({ visibility: "published" }),
  );
  const comment = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: published.id,
    expectedRevision: 1,
    body: "Field observation",
  });
  ok(
    comment.comments[0]?.authorId === worker && comment.revision === 2,
    "field comment saved atomically",
  );
  const issueInput = drawingSaveSchema.parse({
    sheetId: sheet,
    id: randomUUID(),
    kind: "issue",
    visibility: "published",
    expectedRevision: 0,
    data: {
      sourceSheetId: sheet,
      type: "rfi",
      point: { x: 0.3, y: 0.4 },
      title: "Beam",
      assigneeId: assignee,
    },
  });
  const issue = await saveDrawingEntity(field, issueInput);
  assert.equal(issue.kind, "issue");
  const answered = await saveDrawingEntity(
    assigned,
    drawingSaveSchema.parse({
      ...issueInput,
      id: issue.id,
      expectedRevision: 1,
      data: { ...issue.data, status: "answered", body: "Confirmed" },
    }),
  );
  ok(
    answered.revision === 2 && answered.authorId === worker,
    "assignee answers without claiming authorship",
  );
  await rejects(
    saveDrawingEntity(
      strangerCtx,
      drawingSaveSchema.parse({
        ...issueInput,
        id: issue.id,
        expectedRevision: 2,
        data: { ...issue.data, status: "closed" },
      }),
    ),
    "FORBIDDEN",
  );
  await rejects(
    saveDrawingEntity(
      assigned,
      drawingSaveSchema.parse({
        ...issueInput,
        id: issue.id,
        expectedRevision: 2,
        data: { ...answered.data, title: "Retitled" },
      }),
    ),
    "FORBIDDEN",
  );
  await rejects(
    saveDrawingEntity(
      field,
      drawingSaveSchema.parse({
        ...issueInput,
        id: randomUUID(),
        data: { ...issue.data, assigneeId: outsider },
      }),
    ),
    "BAD_REQUEST",
  );

  const priorCwd = process.cwd(),
    attachmentRoot = await mkdtemp(
      path.join(tmpdir(), "drawing-attachment-test-"),
    );
  try {
    process.chdir(attachmentRoot);
    const file = await writeDrawingAttachment({
      jobId: job,
      sheetId: sheet,
      authorId: worker,
      name: "Test.pdf",
      bytes: Buffer.from("%PDF-1.4\nTest fixture"),
    });
    const attachedInput = drawingSaveSchema.parse({
      ...issueInput,
      id: randomUUID(),
      visibility: "private",
      data: {
        ...issue.data,
        assigneeId: null,
        links: [{ label: "Test", url: file.url }],
      },
    });
    await rejects(saveDrawingEntity(admin, attachedInput), "NOT_FOUND");
    const attached = await saveDrawingEntity(field, attachedInput);
    await rejects(
      saveDrawingEntity(admin, { ...attachedInput, id: randomUUID() }),
      "NOT_FOUND",
    );
    await saveDrawingEntity(field, {
      ...attachedInput,
      expectedRevision: attached.revision,
      visibility: "published",
    });
    const sharedCopy = await saveDrawingEntity(admin, {
      ...attachedInput,
      id: randomUUID(),
    });
    ok(
      sharedCopy.kind === "issue",
      "visible published attachment can be reused without exposing unpublished uploads",
    );
    await rejects(
      saveDrawingEntity(
        field,
        drawingSaveSchema.parse({
          ...attachedInput,
          id: randomUUID(),
          data: {
            ...attachedInput.data,
            links: [
              {
                label: "Missing",
                url: `/api/drawings/attachments/${job}/${randomUUID()}`,
              },
            ],
          },
        }),
      ),
      "NOT_FOUND",
    );
  } finally {
    process.chdir(priorCwd);
    await rm(attachmentRoot, { recursive: true, force: true });
  }
  const version = drawingSaveSchema.parse({
    sheetId: sheet,
    id: randomUUID(),
    kind: "version",
    visibility: "published",
    expectedRevision: 0,
    expectedMetadataRevision: 0,
    data: { sourceSheetId: source, label: "Revision B" },
  });
  await saveDrawingEntity(admin, version);
  let workspace = await getDrawingWorkspace(admin, sheet);
  ok(
    workspace.metadata.currentSourceSheetId === source &&
      workspace.metadata.revision === 1,
    "new version current atomically",
  );
  await rejects(
    saveDrawingEntity(
      admin,
      drawingSaveSchema.parse({ ...version, id: randomUUID() }),
    ),
    "CONFLICT",
  );
  await rejects(
    setDrawingCurrentVersion(admin, {
      sheetId: sheet,
      sourceSheetId: otherSheet,
      expectedRevision: 1,
    }),
    "BAD_REQUEST",
  );
  await rejects(assertSheetsNotReferenced(db, [source]), "CONFLICT");
  await assertSheetsNotReferenced(db, [sheet, source]);
  checks++;
  const pendingInput = drawingSaveSchema.parse({
    sheetId: sheet,
    id: randomUUID(),
    kind: "review",
    visibility: "published",
    expectedRevision: 0,
    expectedMetadataRevision: 1,
    data: { sourceSheetId: source, status: "pending", reviewerId: assignee },
  });
  const pending = await saveDrawingEntity(admin, pendingInput);
  const decision = drawingSaveSchema.parse({
    ...pendingInput,
    id: randomUUID(),
    expectedMetadataRevision: 2,
    data: {
      sourceSheetId: source,
      status: "approved",
      reviewerId: assignee,
      requestId: pending.id,
    },
  });
  await rejects(saveDrawingEntity(strangerCtx, decision), "FORBIDDEN");
  await saveDrawingEntity(assigned, decision);
  workspace = await getDrawingWorkspace(admin, sheet);
  ok(
    workspace.metadata.status === "approved" &&
      workspace.metadata.revision === 3,
    "only assigned reviewer approves current revision",
  );
  await rejects(
    saveDrawingEntity(
      assigned,
      drawingSaveSchema.parse({
        ...decision,
        id: randomUUID(),
        expectedMetadataRevision: 3,
      }),
    ),
    "CONFLICT",
  );
  await rejects(
    saveDrawingEntity(
      admin,
      drawingSaveSchema.parse({
        ...decision,
        id: randomUUID(),
        expectedMetadataRevision: 3,
        data: { sourceSheetId: sheet, status: "approved" },
      }),
    ),
    "CONFLICT",
  );
  const restored = await setDrawingCurrentVersion(admin, {
    sheetId: sheet,
    sourceSheetId: sheet,
    expectedRevision: 3,
  });
  ok(
    restored.revision === 4 &&
      restored.status === "draft" &&
      restored.scale === null,
    "restoring source clears obsolete approval and calibration",
  );
  await rejects(
    saveDrawingMetadata(admin, {
      sheetId: sheet,
      expectedRevision: 3,
      data: { ...workspace.metadata, title: "stale" },
    }),
    "CONFLICT",
  );
  await rejects(
    saveDrawingMetadata(field, {
      sheetId: sheet,
      expectedRevision: 4,
      data: { ...workspace.metadata, title: "unauthorized" },
    }),
    "FORBIDDEN",
  );
  await saveDrawingMetadata(admin, {
    sheetId: sheet,
    expectedRevision: 4,
    data: {
      ...workspace.metadata,
      title: "Updated",
      scale: { unitsPerSheetWidth: 80, unit: "ft" },
    },
  });
  await favoriteDrawing(field, { sheetId: sheet, favorite: true });
  ok(
    (await getDrawingWorkspace(field, sheet)).favorite &&
      !(await getDrawingWorkspace(admin, sheet)).favorite,
    "favorites account-scoped",
  );
  const listing = await listDrawingWorkspace(field, job);
  ok(
    listing.find((item) => item.sheetId === sheet)?.favorite,
    "list includes favorite",
  );
  ok(
    listing.find((item) => item.sheetId === sheet)?.metadata.title ===
      "Updated",
    "list includes metadata",
  );
  const managerListing = await listDrawingWorkspace(admin, job);
  ok(
    managerListing.find((item) => item.sheetId === sheet)?.markupCount === 1,
    "summary does not leak private mark counts",
  );
  await archiveDrawingEntity(field, {
    sheetId: sheet,
    id: own.id,
    expectedRevision: 2,
  });
  ok(
    !(await getDrawingWorkspace(admin, sheet)).entities.some(
      (x) => x.id === own.id,
    ),
    "archived private data remains private",
  );

  // Fake subscriptions plus injected sender: no DNS or push provider calls are made.
  const deviceA = randomUUID(),
    deviceB = randomUUID();
  await sql`insert into kublai_chat_push_subscription (id,"userId",endpoint,p256dh,auth,"revokeTokenHash") values
    (${deviceA},${assignee},${`https://fcm.googleapis.com/fake/${deviceA}`},'fake','fake','fake'),
    (${deviceB},${stranger},${`https://fcm.googleapis.com/fake/${deviceB}`},'fake','fake','fake')`;
  await watchDrawing(strangerCtx, { sheetId: sheet, watching: true });
  await watchDrawing(field, { sheetId: sheet, watching: true });
  ok(
    (await getDrawingWorkspace(strangerCtx, sheet)).watching,
    "sheet watch persists per account",
  );
  const notifyInput = drawingSaveSchema.parse({
    ...issueInput,
    id: randomUUID(),
    data: { ...issue.data, title: "Notification fixture" },
  });
  const notifyIssue = await saveDrawingEntity(field, notifyInput);
  const recipients =
    await sql`select "recipientId" from kublai_drawing_notification where "entityId"=${notifyIssue.id}`;
  ok(
    recipients.length === 2 &&
      recipients.every((row) => row.recipientId !== worker),
    "transactional recipients: assignee and watcher, never actor",
  );
  const sent: string[] = [];
  const configuration = {
    publicKey: "fake",
    privateKey: "fake",
    subject: "mailto:test@example.test",
  };
  const deps = {
    db,
    configuration,
    send: async (
      _delivery: unknown,
      _configuration: unknown,
      payload: string,
    ) => {
      sent.push(payload);
    },
  };
  await Promise.all([drainDrawingPush(deps), drainDrawingPush(deps)]);
  ok(sent.length === 2, "concurrent workers send each device only once");
  await drainDrawingPush(deps);
  ok(sent.length === 2, "settled deliveries are not replayed");
  ok(
    sent.every(
      (payload) =>
        !payload.includes("Notification fixture") &&
        payload.includes("job-drawing") &&
        payload.includes("account"),
    ),
    "push payload is generic and account-bound",
  );
  let latest = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: notifyIssue.id,
    expectedRevision: 1,
    body: "Update",
  });
  const inbox = await drawingNotificationInbox(strangerCtx, job);
  const notice = inbox.find(
    (row) =>
      row.entityId === notifyIssue.id && row.revision === latest.revision,
  )!;
  await readDrawingNotification(field, notice.id);
  ok(
    (
      await sql`select "readAt" from kublai_drawing_notification where id=${notice.id}`
    )[0]!.readAt === null,
    "cannot mark another person's notification read",
  );
  await readDrawingNotification(strangerCtx, notice.id);
  await drainDrawingPush(deps);
  ok(
    sent.length === 3,
    "reading in-app suppresses only that account's pending push",
  );
  await watchDrawing(strangerCtx, { sheetId: sheet, watching: false });
  latest = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: notifyIssue.id,
    expectedRevision: latest.revision,
    body: "Unwatched",
  });
  const retryDeps = {
    ...deps,
    send: async () => {
      throw Object.assign(new Error("Fake rate limit"), { statusCode: 429 });
    },
  };
  await drainDrawingPush(retryDeps);
  const [retry] = await sql<
    {
      id: string;
      outcome: string;
      attempts: number;
      completedAt: Date | null;
    }[]
  >`select o.* from kublai_drawing_push_outbox o join kublai_drawing_notification n on n.id=o."notificationId" where n."entityId"=${notifyIssue.id} and n.revision=${latest.revision}`;
  ok(
    retry?.outcome === "retry" && retry.attempts === 1 && !retry.completedAt,
    "provider429 schedules bounded retry",
  );
  await sql`update kublai_drawing_push_outbox set attempts=6,"availableAt"=now() where id=${retry!.id}`;
  await drainDrawingPush(deps);
  ok(
    (
      await sql`select outcome from kublai_drawing_push_outbox where id=${retry!.id}`
    )[0]!.outcome === "expired",
    "attempt cap expires delivery without another send",
  );
  latest = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: notifyIssue.id,
    expectedRevision: latest.revision,
    body: "Before revocation",
  });
  await sql`update kublai_user set "organizationAccessStatus"='pending' where id=${assignee}`;
  await drainDrawingPush(deps);
  ok(sent.length === 3, "revoked recipient is skipped at delivery");
  await sql`update kublai_user set "organizationAccessStatus"='approved' where id=${assignee}`;
  latest = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: notifyIssue.id,
    expectedRevision: latest.revision,
    body: "Before device switch",
  });
  await sql`update kublai_chat_push_subscription set "userId"=${outsider} where id=${deviceA}`;
  await drainDrawingPush(deps);
  ok(
    sent.length === 3,
    "rebound device never receives previous account's pending push",
  );
  await sql`update kublai_chat_push_subscription set "userId"=${assignee} where id=${deviceA}`;
  latest = await commentDrawingEntity(field, {
    sheetId: sheet,
    id: notifyIssue.id,
    expectedRevision: latest.revision,
    body: "Before private",
  });
  await saveDrawingEntity(
    field,
    drawingSaveSchema.parse({
      ...notifyInput,
      id: latest.id,
      expectedRevision: latest.revision,
      visibility: "private",
    }),
  );
  await drainDrawingPush(deps);
  ok(sent.length === 3, "newly private issue suppresses pending delivery");
  await sql`update kublai_user set "organizationAccessStatus"='pending' where id=${worker}`;
  await rejects(saveDrawingEntity(field, mark()), "FORBIDDEN");
  await rejects(getDrawingWorkspace(field, sheet), "FORBIDDEN");
  ok(
    (
      await sql`select count(*)::int n from kublai_drawing_workspace_entity where "sheetId"=${sheet}`
    )[0]!.n > 0,
    "workspace persisted",
  );
  console.log(
    `Drawing workspace PostgreSQL checks passed: ${checks} assertions; concurrency, tenancy, private visibility, references, assignments, reviews, CAS, favorites, revoked permissions, durable push dedup/read/rebind/privacy/retrycap.`,
  );
} finally {
  await sql`delete from kublai_organization where id in (${org},${foreignOrg})`;
  await sql`delete from kublai_user where id in (${manager},${worker},${assignee},${stranger},${outsider})`;
  await sql.end();
}
