#!/usr/bin/env node
// Operational fixture runner only. No source/DB URL defaults and no dotenv.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  requiredArgument,
  validateBinding,
  createSupervisor,
  successful,
  cleanupOwnedDatabase,
} from "./replicache-isolated/supervisor.mjs";
import { fingerprintSource } from "./release/source-fingerprint.mjs";
const argument = (name) => requiredArgument(process.argv, name);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const source = await fs.realpath(argument("--source"));
const build = await fs.realpath(argument("--build"));
const expectedBuild = argument("--expected-build");
const expectedFingerprint = argument("--expected-fingerprint");
const manifest = JSON.parse(
  await fs.readFile(path.join(build, "release-assets.json")),
);
if (
  await fs.stat(path.join(source, "PERF_LAB_ONLY")).then(
    () => true,
    () => false,
  )
)
  throw Error("Transformed lab source is not a canonical input");
const actualBuild = (
  await fs.readFile(path.join(build, "BUILD_ID"), "utf8")
).trim();
validateBinding(manifest, actualBuild, expectedBuild, expectedFingerprint);
const { manifest: _internal, ...sourceEvidence } =
  await fingerprintSource(source);
if (sourceEvidence.sourceFingerprint !== expectedFingerprint)
  throw Error("Selected source differs from canonical release");
// Pin operational dependencies separately; these are not part of release bytes.
const toolRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const helpers = [
  "perf/lab/schema-entry.mjs",
  "perf/lab/drizzle.config.ts",
  "perf/lab/order-schema.mjs",
];
const migrations = [
  "drizzle/0039_reliability_revisions.sql",
  "drizzle/0045_material_room.sql",
  "drizzle/0091_job_pricing_sync.sql",
];
const operationalHashes = {};
for (const file of [...helpers, ...migrations])
  operationalHashes[file] = sha(await fs.readFile(path.join(toolRoot, file)));
operationalHashes["connectionGuard"] = sha(
  await fs.readFile(
    new URL("./replicache-isolated/connection-guard.mjs", import.meta.url),
  ),
);
operationalHashes["supervisor"] = sha(
  await fs.readFile(
    new URL("./replicache-isolated/supervisor.mjs", import.meta.url),
  ),
);
operationalHashes["runner"] = sha(await fs.readFile(new URL(import.meta.url)));
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "foremanhq-replicache-proof."),
);
await fs.chmod(evidence, 0o700);
const lab = await fs.mkdtemp("/tmp/foremanhq-perf-pg.");
await fs.chmod(lab, 0o700);
const snapshot = path.join(lab, "source");
const pg = "/home/tim/.local/pgsql-18/bin";
const port = 55463; // Unique Unix-socket directory; TCP listener disabled.
let stage = "prepare",
  failed,
  postgresAttempted = false;
const supervisor = createSupervisor();
const baseEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  USER: os.userInfo().username,
  TMPDIR: lab,
  LANG: "C.UTF-8",
  NODE_ENV: "test",
  SKIP_ENV_VALIDATION: "1",
  FOREMANHQ_BACKGROUND_MODE: "separate",
  BIM_WORKER_DISABLED: "1",
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, supervisor.interrupt);
async function run(
  command,
  args,
  label,
  env = baseEnv,
  timeout = 60_000,
  cwd = snapshot,
) {
  const log = await fs.open(path.join(evidence, label + ".log"), "wx", 0o600);
  try {
    return await supervisor.run(
      command,
      args,
      { cwd, env, stdio: ["ignore", log.fd, log.fd] },
      timeout,
    );
  } catch (error) {
    throw Error(`${label}: ${error.message}`);
  } finally {
    await log.close();
  }
}

let cleanup = { postgresStopped: false, temporaryDirectoryRemoved: false };
try {
  await fs.mkdir(snapshot);
  async function rejectLinks(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw Error("Symlink in copied source inputs");
      if (entry.isDirectory()) await rejectLinks(file);
    }
  }
  for (const name of ["src", "public", "scripts", "vendor"])
    await rejectLinks(path.join(source, name));
  // Deliberately never copy .env, .private, uploads or an active output symlink.
  for (const name of ["src", "public", "scripts", "vendor"])
    await fs.cp(path.join(source, name), path.join(snapshot, name), {
      recursive: true,
      dereference: false,
    });
  for (const name of [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "next.config.js",
    "postcss.config.js",
    "next-env.d.ts",
  ])
    await fs.copyFile(path.join(source, name), path.join(snapshot, name));
  await fs.symlink(
    await fs.realpath(path.join(source, "node_modules")),
    path.join(snapshot, "node_modules"),
  );
  const { manifest: _copyManifest, ...copiedEvidence } =
    await fingerprintSource(snapshot);
  if (copiedEvidence.sourceFingerprint !== expectedFingerprint)
    throw Error("Frozen copy does not match selected release");
  await fs.mkdir(path.join(snapshot, "perf/lab"), { recursive: true });
  for (const file of helpers) {
    const content = await fs.readFile(path.join(toolRoot, file));
    if (sha(content) !== operationalHashes[file])
      throw Error("Operational helper changed before copy");
    await fs.writeFile(path.join(snapshot, file), content);
  }
  await fs.mkdir(path.join(lab, "operational"));
  for (const [index, file] of migrations.entries()) {
    const content = await fs.readFile(path.join(toolRoot, file));
    if (sha(content) !== operationalHashes[file])
      throw Error("Migration input changed before copy");
    await fs.writeFile(path.join(lab, "operational", `${index}.sql`), content);
  }
  const env = {
    ...baseEnv,
    PERF_SOURCE_ROOT: snapshot,
    PERF_LAB_SOCKET: lab,
    PERF_LAB_DATABASE_URL: `postgresql://localhost/foremanhq_perf_lab?host=${encodeURIComponent(lab)}&port=${port}`,
  };
  env.DATABASE_URL = "postgres:///foremanhq_perf_lab";
  env.PGHOST = lab;
  env.PGPORT = String(port);
  env.PGDATABASE = "foremanhq_perf_lab";
  stage = "database-start";
  await run(
    path.join(pg, "initdb"),
    [
      "-D",
      path.join(lab, "data"),
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ],
    "initdb",
    baseEnv,
  );
  postgresAttempted = true;
  await run(
    path.join(pg, "pg_ctl"),
    [
      "-D",
      path.join(lab, "data"),
      "-l",
      path.join(lab, "server.log"),
      "-o",
      `-h '' -k ${lab} -p ${port} -c log_error_verbosity=verbose`,
      "-w",
      "start",
    ],
    "pg-start",
    baseEnv,
  );
  await run(
    path.join(pg, "createdb"),
    ["-h", lab, "-p", String(port), "foremanhq_perf_lab"],
    "createdb",
    baseEnv,
  );
  stage = "schema";
  await run(
    process.execPath,
    ["perf/lab/schema-entry.mjs"],
    "schema-inventory",
    env,
  );
  await run(
    path.join(snapshot, "node_modules/.bin/drizzle-kit"),
    ["export", "--config", "perf/lab/drizzle.config.ts"],
    "schema-export",
    env,
    120_000,
  );
  await run(
    process.execPath,
    [
      "perf/lab/order-schema.mjs",
      path.join(evidence, "schema-export.log"),
      path.join(lab, "ordered-schema.sql"),
    ],
    "schema-order",
    env,
  );
  await run(
    path.join(pg, "psql"),
    [
      "-X",
      "-h",
      lab,
      "-p",
      String(port),
      "-d",
      "foremanhq_perf_lab",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      path.join(lab, "ordered-schema.sql"),
    ],
    "schema-apply",
    env,
  );
  for (const [index, file] of migrations.entries())
    await run(
      path.join(pg, "psql"),
      [
        "-X",
        "-h",
        lab,
        "-p",
        String(port),
        "-d",
        "foremanhq_perf_lab",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        path.join(lab, "operational", `${index}.sql`),
      ],
      `revision-migration-${index}`,
      env,
    );
  await fs.copyFile(
    path.join(lab, "schema-inventory.json"),
    path.join(evidence, "schema-inventory.json"),
  );
  await fs.copyFile(
    path.join(lab, "ordered-schema.sql"),
    path.join(evidence, "schema.sql"),
  );
  const guardSource = await fs.readFile(
    new URL("./replicache-isolated/connection-guard.mjs", import.meta.url),
  );
  if (sha(guardSource) !== operationalHashes.connectionGuard)
    throw Error("Connection guard changed before copy");
  await fs.writeFile(
    path.join(snapshot, "isolated-connection-guard.mjs"),
    guardSource,
  );
  // Import the ACTUAL app DB module; inspect its actual Drizzle client before SQL.
  const entry = `import fs from 'node:fs/promises';
import { assertPrivateEnvironment, assertPrivateClientOptions } from './isolated-connection-guard.mjs';
const socket=${JSON.stringify(lab)};
assertPrivateEnvironment(process.env,socket);
let client;
try {
  const {db}=await import('./src/server/db/index.ts');
  client=db.$client;
  assertPrivateClientOptions(client?.options,socket);
  if(client.options!==globalThis.conn?.options)throw Error('Application connection cache differs');
  await client.begin('read only',async tx=>{
    const [r]=await tx.unsafe("select current_database() as name,inet_server_addr() as network,current_setting('data_directory') as directory,current_setting('transaction_read_only') as readonly");
    if(r.name!=='foremanhq_perf_lab'||r.network!==null||r.readonly!=='on'||await fs.realpath(r.directory)!==await fs.realpath(socket+'/data'))throw Error('Actual application server mismatch');
  });
  await fs.writeFile(${JSON.stringify(path.join(evidence, "actual-client-guard.json"))},JSON.stringify({actualApplicationModule:true,actualClientOptionsVerifiedBeforeSQL:true,sameGlobalCache:true,readOnlyServerCheckPassed:true,unixSocket:true,ownedDatabase:true,ownedDataDirectory:true})+String.fromCharCode(10));
  await import('./scripts/check-replicache-sync.ts');
} finally { const actual=client??globalThis.conn; if(actual)await actual.end({timeout:1}); }
`;
  await fs.writeFile(path.join(snapshot, "isolated-check.mts"), entry, {
    mode: 0o600,
  });
  stage = "existing-check";
  await run(
    process.execPath,
    ["--import", "tsx", "isolated-check.mts"],
    "sync-check",
    env,
    120_000,
  );
  await fs.copyFile(
    path.join(
      snapshot,
      ".tmp/performance-implementation/sync-integration.json",
    ),
    path.join(evidence, "sync-integration.json"),
  );
  const { manifest: _afterManifest, ...after } =
    await fingerprintSource(snapshot);
  if (after.sourceFingerprint !== expectedFingerprint)
    throw Error("Source changed during check");
  supervisor.check();
  stage = "passed";
} catch (error) {
  failed = error.message;
  process.exitCode = 1;
} finally {
  cleanup = await cleanupOwnedDatabase({
    stop: () =>
      supervisor.run(
        path.join(pg, "pg_ctl"),
        [
          "-D",
          path.join(lab, "data"),
          "-m",
          "immediate",
          "-w",
          "-t",
          "10",
          "stop",
        ],
        { env: baseEnv, stdio: "ignore" },
        15_000,
        true,
      ),
    pidExists: async () => {
      try {
        await fs.stat(path.join(lab, "data/postmaster.pid"));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    copyLog: () =>
      fs.copyFile(
        path.join(lab, "server.log"),
        path.join(evidence, "private-pg.log"),
      ),
    readLog: () => fs.readFile(path.join(evidence, "private-pg.log"), "utf8"),
    remove: () => fs.rm(lab, { recursive: true, force: true }),
    logRequired: postgresAttempted,
  });
  supervisor.finish();
  const result = {
    stage,
    failed,
    exitCode: process.exitCode ?? 0,
    ...supervisor.state,
    ...cleanup,
    sourceBuild: expectedBuild,
    ...sourceEvidence,
    operationalHashes,
    runtimeMode: "test; background hint publication disabled by existing code",
    limitations: [
      "Existing integration assertions only; not browser/long-offline convergence, engine extension, worker or production evidence.",
    ],
  };
  result.passed = successful(result);
  if (!result.passed) process.exitCode = 1;
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      evidenceDirectory: evidence,
      stage,
      postgresStopped: cleanup.postgresStopped,
      temporaryDirectoryRemoved: cleanup.temporaryDirectoryRemoved,
      passed: result.passed,
    }),
  );
}
