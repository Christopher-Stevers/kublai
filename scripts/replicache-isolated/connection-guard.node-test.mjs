import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  assertPrivateClientOptions,
  assertPrivateEnvironment,
} from "./connection-guard.mjs";
const socket = "/tmp/foremanhq-perf-pg.NoDatabaseTest";
const env = {
  DATABASE_URL: "postgres:///foremanhq_perf_lab",
  PGHOST: socket,
  PGPORT: "55463",
  PGDATABASE: "foremanhq_perf_lab",
};
async function parsed(url, run) {
  const keys = [
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGHOSTADDR",
    "PGUSER",
    "PGPASSWORD",
    "PGSERVICE",
    "PGSSLMODE",
  ];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, {
    PGHOST: socket,
    PGPORT: "55463",
    PGDATABASE: "foremanhq_perf_lab",
  });
  let client;
  try {
    client = postgres(url);
    await run(client.options);
  } finally {
    await client?.end({ timeout: 1 });
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}
test("installed postgres3.4.8 parses the exact hostless environment into owned socket options without SQL", async () => {
  assertPrivateEnvironment(env, socket);
  await parsed(env.DATABASE_URL, (options) =>
    assertPrivateClientOptions(options, socket),
  );
});
test("original bad query-host URL is rejected by actual driver options before any SQL", async () => {
  await parsed(
    `postgresql://localhost/foremanhq_perf_lab?host=${encodeURIComponent(socket)}&port=55463`,
    (options) => {
      assert.equal(options.host[0], "localhost");
      assert.throws(
        () => assertPrivateClientOptions(options, socket),
        /Actual application/,
      );
    },
  );
});
test("TCP authority, wrong path, port and database reject actual parsed options before connection", async () => {
  for (const url of [
    "postgres://localhost:55463/foremanhq_perf_lab",
    "postgres:///wrong_database",
  ])
    await parsed(url, (options) =>
      assert.throws(() => assertPrivateClientOptions(options, socket)),
    );
  await parsed(env.DATABASE_URL, (options) => {
    for (const delta of [
      { path: socket + "/.s.PGSQL.5432" },
      { path: "/tmp/other/.s.PGSQL.55463" },
      { host: ["localhost"] },
      { port: [5432] },
      { database: "other" },
      { ssl: true },
    ])
      assert.throws(() =>
        assertPrivateClientOptions({ ...options, ...delta }, socket),
      );
  });
});
test("missing/extra URL fields or unspecific PG defaults fail environment guard", () => {
  for (const delta of [
    { PGHOST: "/tmp/other" },
    { PGPORT: "5432" },
    { PGDATABASE: "other" },
    { DATABASE_URL: "postgres://localhost/foremanhq_perf_lab" },
    { DATABASE_URL: "postgres:///foremanhq_perf_lab?host=ignored" },
    { DATABASE_URL: "postgres:///other" },
  ])
    assert.throws(() => assertPrivateEnvironment({ ...env, ...delta }, socket));
});
test("generated actual-client guard entry parses without importing application or running SQL", async () => {
  const fs = await import("node:fs/promises"),
    path = await import("node:path"),
    os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const source = await fs.readFile(
    new URL("../check-replicache-isolated.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const entry = `") + "const entry = ".length;
  const end = source.indexOf("`;", start) + 1;
  assert(start > 0 && end > start);
  const generate = new Function(
    "lab",
    "evidence",
    "path",
    "selection",
    "selectedBinding",
    `return ${source.slice(start, end)}`,
  );
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "replicache-entry-syntax-"),
  );
  try {
    for (const selection of [
      { mode: "existing", program: "./scripts/check-replicache-sync.ts" },
      {
        mode: "push-contract-v1",
        program: "./perf/replicache-push-contract.ts",
      },
    ]) {
      const entry = generate(
        socket,
        "/tmp/no-database-guard-evidence",
        path,
        selection,
        {
          sourceBuild: "a".repeat(64),
          sourceFingerprint: "b".repeat(64),
          testSha256: "c".repeat(64),
        },
      );
      const file = path.join(dir, `${selection.mode}.mjs`);
      await fs.writeFile(file, entry);
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(entry, /client=db\.\$client/);
      assert(
        entry.indexOf("assertPrivateClientOptions(client") <
          entry.indexOf("client.begin('read only'"),
      );
      assert(
        entry.indexOf("client.begin('read only'") <
          entry.indexOf("const binding=supplementalBinding("),
      );
      assert(
        entry.indexOf("const binding=supplementalBinding(") <
          entry.indexOf(`await import(${JSON.stringify(selection.program)})`),
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
