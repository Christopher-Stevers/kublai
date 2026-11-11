/** Supplemental existing-contract assertions. Run only through the reviewed private runner. */
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { PushRequest, PullRequest } from "replicache";

const expectedBuild =
  "c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8";
const expectedFingerprint =
  "ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd";
const root = await realpath(process.cwd());
const socket = process.env.PERF_LAB_SOCKET;
assert(socket && /^\/tmp\/foremanhq-perf-pg\.[A-Za-z0-9]+$/.test(socket));
assert.equal(root, path.join(socket, "source"));
assert.equal(process.env.PERF_SOURCE_ROOT, root);
assert.equal(process.env.NODE_ENV, "test");
const binding = JSON.parse(
  await readFile(path.join(root, "ISOLATED_REPLICACHE_BINDING.json"), "utf8"),
);
const { assertSupplementalBinding } = await import(
  pathToFileURL(path.join(root, "isolated-runner/selection.mjs")).href
);
assertSupplementalBinding(binding, {
  sourceBuild: expectedBuild,
  sourceFingerprint: expectedFingerprint,
  testSha256: createHash("sha256")
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex"),
});
const load = (relative: string) =>
  import(pathToFileURL(path.join(root, relative)).href);
const { assertPrivateEnvironment, assertPrivateClientOptions } = await load(
  "isolated-connection-guard.mjs",
);
assertPrivateEnvironment(process.env, socket);
const { db } = await load("src/server/db/index.ts");
assertPrivateClientOptions(db.$client.options, socket);
assert.equal(db.$client.options, (globalThis as any).conn?.options);
const schema = await load("src/server/db/schema.ts");
const {
  handleMaterialListReplicachePush: pushHandler,
  handleMaterialListReplicachePull: pullHandler,
} = await load("src/server/replicache/material-list-sync.ts");
const organizationId = randomUUID(),
  userId = randomUUID(),
  jobId = randomUUID();
const actor = { id: userId, organizationId, role: "admin" };
const deniedActor = {
  ...actor,
  role: "user",
  permissionConfig: { version: 2, permissions: { "jobs.edit": false } },
};
const cases: Array<{ name: string; passed: true }> = [];
let created = false;
type Mutation = {
  id: number;
  name: string;
  args: Record<string, unknown>;
  clientID?: string;
};
function stream() {
  return { group: randomUUID(), client: randomUUID() };
}
async function push(
  s: ReturnType<typeof stream>,
  mutations: Mutation[],
  user = actor,
) {
  const result = await pushHandler(
    {
      pushVersion: 1,
      clientGroupID: s.group,
      profileID: "isolated-push-contract-v1",
      schemaVersion: "material-lists-v2",
      mutations: mutations.map((m) => ({
        ...m,
        clientID: m.clientID ?? s.client,
        timestamp: Date.now(),
      })),
    } as PushRequest,
    user,
  );
  assert(!result || !("error" in result));
}
async function cursor(s: ReturnType<typeof stream>, client = s.client) {
  const rows = await db
    .select({ value: schema.replicacheClients.lastMutationId })
    .from(schema.replicacheClients)
    .where(
      and(
        eq(schema.replicacheClients.id, client),
        eq(schema.replicacheClients.clientGroupId, s.group),
        eq(schema.replicacheClients.organizationId, organizationId),
      ),
    );
  return rows[0]?.value as number | undefined;
}
async function pulledCursor(s: ReturnType<typeof stream>, client = s.client) {
  const response = await pullHandler(
    {
      pullVersion: 1,
      clientGroupID: s.group,
      profileID: "isolated-push-contract-v1",
      schemaVersion: "material-lists-v2",
      cookie: null,
    } as PullRequest,
    actor,
  );
  assert(!("error" in response));
  return response.lastMutationIDChanges[client] as number | undefined;
}
async function job() {
  const rows = await db
    .select({ name: schema.jobs.name, updatedAt: schema.jobs.updatedAt })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.id, jobId),
        eq(schema.jobs.organizationId, organizationId),
      ),
    );
  assert.equal(rows.length, 1);
  return rows[0];
}
const update = (id: number, name: string): Mutation => ({
  id,
  name: "updateJob",
  args: { jobId, name },
});
try {
  await db
    .insert(schema.organizations)
    .values({ id: organizationId, name: "Synthetic push-contract fixture" });
  created = true;
  await db
    .insert(schema.users)
    .values({
      id: userId,
      organizationId,
      email: `${userId}@example.invalid`,
      role: "admin",
      organizationAccessStatus: "approved",
    });
  await db
    .insert(schema.jobs)
    .values({
      id: jobId,
      organizationId,
      name: "Synthetic baseline",
      createdByUserId: userId,
    });

  // One client's gap aborts earlier accepted-looking work from another client in the SAME batch/group.
  const gap = stream(),
    otherClient = randomUUID();
  await push(gap, [
    update(1, "Gap baseline"),
    { ...update(1, "Second client baseline"), clientID: otherClient },
  ]);
  const beforeGap = await job();
  await assert.rejects(
    () =>
      push(gap, [
        update(2, "Must roll back before gap"),
        { ...update(3, "Must never apply"), clientID: otherClient },
      ]),
    /out of order.*expected 2/,
  );
  assert.deepEqual(await job(), beforeGap);
  assert.equal(await cursor(gap), 1);
  assert.equal(await cursor(gap, otherClient), 1);
  assert.equal(await pulledCursor(gap), 1);
  assert.equal(await pulledCursor(gap, otherClient), 1);
  await push(gap, [
    {
      ...update(2, "Explicit next valid second-client write"),
      clientID: otherClient,
    },
  ]);
  assert.equal(await cursor(gap), 1);
  assert.equal(await cursor(gap, otherClient), 2);
  assert.equal((await job()).name, "Explicit next valid second-client write");
  cases.push({
    name: "per-client gap rolls back entire batch and both cursors; next expected ID remains usable",
    passed: true,
  });

  // Stronger than retrying identical/idempotent data: changed payload under an old ID must still skip.
  const duplicate = stream();
  await push(duplicate, [update(1, "Duplicate baseline")]);
  const beforeDuplicate = await job();
  await push(duplicate, [
    update(1, "Changed duplicate payload must NOT apply"),
  ]);
  assert.deepEqual(await job(), beforeDuplicate);
  assert.equal(await cursor(duplicate), 1);
  assert.equal(await pulledCursor(duplicate), 1);
  cases.push({
    name: "duplicate ID ignores changed payload without a second domain update",
    passed: true,
  });

  const denied = stream(),
    beforeDenied = await job();
  // Current permission check precedes schema parsing: invalid args remain acknowledged if forbidden.
  await push(
    denied,
    [{ id: 1, name: "updateJob", args: { jobId: "not-a-uuid", name: [] } }],
    deniedActor,
  );
  assert.deepEqual(await job(), beforeDenied);
  assert.equal(await cursor(denied), 1);
  assert.equal(await pulledCursor(denied), 1);
  await push(denied, [
    update(
      1,
      "Same denied ID must not become accepted after permission restoration",
    ),
  ]);
  assert.deepEqual(await job(), beforeDenied);
  await push(denied, [update(2, "A new authorized ID applies")]);
  assert.equal((await job()).name, "A new authorized ID applies");
  assert.equal(await cursor(denied), 2);
  cases.push({
    name: "permission refusal ACKs before args parsing; same ID stays consumed, next authorized ID works",
    passed: true,
  });

  const obsolete = stream(),
    beforeObsolete = await job();
  await push(obsolete, [
    {
      id: 1,
      name: "obsolete_contract_fixture_name",
      args: { malformedForKnownWrites: true },
    },
  ]);
  assert.deepEqual(await job(), beforeObsolete);
  assert.equal(await cursor(obsolete), 1);
  assert.equal(await pulledCursor(obsolete), 1);
  await push(obsolete, [update(2, "Known write after obsolete ACK")]);
  assert.equal((await job()).name, "Known write after obsolete ACK");
  cases.push({
    name: "unknown obsolete name ACKs without domain mutation and does not block the next known write",
    passed: true,
  });

  const failed = stream();
  await push(failed, [update(1, "Hard-failure baseline")]);
  const beforeFailure = await job();
  await assert.rejects(
    () =>
      push(failed, [
        update(2, "Earlier write in failed transaction"),
        update(3, ""),
      ]),
    (error: any) =>
      Array.isArray(error?.issues) &&
      error.issues.length === 1 &&
      error.issues[0]?.code === "too_small" &&
      error.issues[0]?.minimum === 1 &&
      error.issues[0]?.inclusive === true &&
      error.issues[0]?.path?.length === 1 &&
      error.issues[0]?.path[0] === "name",
  );
  assert.deepEqual(await job(), beforeFailure);
  assert.equal(await cursor(failed), 1);
  assert.equal(await pulledCursor(failed), 1);
  await push(failed, [
    update(2, "Expected ID reused after rolled-back transaction"),
  ]);
  assert.equal(await cursor(failed), 2);
  cases.push({
    name: "unhandled input-validation failure rolls back earlier domain write and cursor; explicit recovery uses expected ID",
    passed: true,
  });

  await mkdir(path.join(root, ".tmp"), { recursive: true });
  await writeFile(
    path.join(root, ".tmp/push-contract-v1.json"),
    JSON.stringify(
      {
        passed: true,
        sourceBuild: expectedBuild,
        sourceFingerprint: expectedFingerprint,
        cases,
        limitations: [
          "Direct actual server handlers with constructed request-user contexts, not real auth or live permission fetching.",
          "Transaction failure is an unhandled Zod validation error, not an injected PostgreSQL error/deadlock/retry test.",
          "No browser, hint transport, new engine or long-offline convergence evidence.",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
} finally {
  if (created)
    await db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
  // The reviewed entry owns final actual-client close, including failed guards.
}
