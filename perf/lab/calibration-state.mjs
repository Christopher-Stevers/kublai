// Private synthetic PG only. Snapshot/restore OUTSIDE timing, never production.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import postgres from "postgres";
const mode = process.argv[2],
  dir = process.env.PERF_STAGE_EVIDENCE_DIR,
  socket = process.env.PERF_LAB_SOCKET;
if (
  !["snapshot", "restore", "verify"].includes(mode) ||
  !dir?.startsWith("/tmp/foremanhq-calibration15-") ||
  dir.split("/").includes("..") ||
  !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !fs.existsSync(socket + "/.s.PGSQL.55463")
)
  throw Error("Owned stage/private socket required");
const url = new URL(process.env.PERF_LAB_DATABASE_URL);
if (
  url.pathname !== "/foremanhq_perf_lab" ||
  url.searchParams.get("host") !== socket ||
  url.searchParams.get("port") !== "55463" ||
  process.env.DATABASE_URL !== process.env.PERF_LAB_DATABASE_URL
)
  throw Error("Private database options differ");
const f = JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));
if (
  f.provenance !== "isolated-seeded-app" ||
  f.productionDatabase !== false ||
  f.userId !== "perf-lab-user"
)
  throw Error("Synthetic fixture required");
const user = os.userInfo().username,
  opts = {
    host: socket,
    port: 55463,
    database: "foremanhq_perf_lab",
    user,
    ssl: false,
    max: 1,
    prepare: false,
    connect_timeout: 5,
  };
const sql = postgres(opts);
if (
  sql.options.host[0] !== socket ||
  sql.options.port[0] !== 55463 ||
  sql.options.database !== opts.database ||
  sql.options.user !== user ||
  sql.options.ssl !== false
)
  throw Error("Actual client options differ before SQL");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const dump = path.join(dir, "private-seed.dump"),
  stateFile = path.join(dir, "private-seed-state.json"),
  manifestFile = path.join(dir, "private-seed-manifest.json");
const readState = async () => {
  const [r] =
    await sql`select json_build_object('quoteItems',(select json_agg(row_to_json(x) order by x.id) from (select qi.* from kublai_quote_item qi join kublai_quote q on q.id=qi."quoteId" where q."materialListId"=${f.materialListId})x),'quote',(select row_to_json(q) from kublai_quote q where q."materialListId"=${f.materialListId}),'materialList',(select row_to_json(m) from kublai_material_list m where m.id=${f.materialListId}),'orderItems',(select json_agg(row_to_json(i) order by i.id) from kublai_order_item i where i."orderId"=${f.orderId}),'chat',(select json_agg(row_to_json(c) order by c.id) from kublai_job_chat_message c where c."jobId"=${f.jobId})) as state`;
  if (
    r.state.quoteItems?.length !== 25 ||
    r.state.orderItems?.length !== 1 ||
    r.state.chat?.length !== 1 ||
    r.state.chat[0].body !== "Synthetic welcome message" ||
    r.state.quoteItems.some((q) => Number(q.quantity) !== 10) ||
    r.state.orderItems.some(
      (i) =>
        Number(i.receivedQuantity) !== 0 || i.verificationStatus !== "pending",
    )
  )
    throw Error("Synthetic canonical state differs");
  return JSON.stringify(r.state);
};
try {
  const [identity] =
    await sql`select current_database() as db,current_user as usr,inet_server_addr() as address,current_setting('port') as port,(select count(*)::int from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()) as other_sessions`;
  if (
    identity.db !== opts.database ||
    identity.usr !== user ||
    identity.address !== null ||
    identity.port !== "55463"
  )
    throw Error("Private server identity differs");
  let remaining = identity.other_sessions;
  for (let i = 0; remaining && i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const [r] =
      await sql`select count(*)::int as n from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()`;
    remaining = r.n;
  }
  if (remaining !== 0) throw Error("App database sessions did not drain");
  if (mode !== "snapshot") {
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    if (
      manifest.algorithm !== "pg-custom-v1-sha256" ||
      sha(fs.readFileSync(dump)) !== manifest.dumpSha256 ||
      sha(fs.readFileSync(stateFile)) !== manifest.stateSha256
    )
      throw Error("Sealed private seed bytes changed");
  }
  if (mode === "verify") {
    const state = await readState(),
      expected = fs.readFileSync(stateFile, "utf8");
    if (state !== expected)
      throw Error("Restored fixture differs from entire seed snapshot state");
    console.log(
      JSON.stringify({
        stateVerified: true,
        algorithm: "pg-custom-v1-sha256",
        semanticFixture: {
          quoteItems: 25,
          quantity: 10,
          orderItems: 1,
          receivedQuantity: 0,
          verificationStatus: "pending",
          welcomeMessages: 1,
          generatedMessages: 0,
        },
        stateSha256: sha(state),
        seedSnapshotSha256: sha(fs.readFileSync(dump)),
        privateDatabase: {
          socket,
          port: 55463,
          database: opts.database,
          otherSessions: 0,
        },
      }),
    );
  } else {
    if (mode === "snapshot") {
      if (fs.existsSync(dump) || fs.existsSync(stateFile))
        throw Error("Fresh snapshot required");
      fs.writeFileSync(stateFile, await readState(), { mode: 0o600 });
    }
    await sql.end();
    const bin = process.env.PERF_PG_BIN ?? "/home/tim/.local/pgsql-18/bin";
    if (fs.realpathSync(bin) !== "/home/tim/.local/pgsql-18/bin")
      throw Error("Pinned PostgreSQL tools required");
    const base = [
      "--host",
      socket,
      "--port",
      "55463",
      "--username",
      user,
      "--dbname",
      opts.database,
      "--no-password",
    ];
    const env = { PATH: process.env.PATH, LANG: "C", PGPASSFILE: "/dev/null" };
    if (mode === "snapshot") {
      execFileSync(
        path.join(bin, "pg_dump"),
        [
          ...base,
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "--file",
          dump,
        ],
        { env, timeout: 30000, maxBuffer: 1024 ** 2 },
      );
      fs.writeFileSync(
        manifestFile,
        JSON.stringify(
          {
            algorithm: "pg-custom-v1-sha256",
            dumpSha256: sha(fs.readFileSync(dump)),
            stateSha256: sha(fs.readFileSync(stateFile)),
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        { mode: 0o444 },
      );
      fs.chmodSync(dump, 0o444);
      fs.chmodSync(stateFile, 0o444);
    } else {
      if (!fs.existsSync(dump))
        throw Error("Original private seed snapshot missing");
      execFileSync(
        path.join(bin, "pg_restore"),
        [
          ...base,
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          dump,
        ],
        { env, timeout: 30000, maxBuffer: 1024 ** 2 },
      );
      console.log(
        JSON.stringify({
          status: "passed",
          algorithm: "pg-custom-v1-sha256",
          seedSnapshotSha256: sha(fs.readFileSync(dump)),
          privateDatabase: {
            socket,
            port: 55463,
            database: opts.database,
            otherSessions: 0,
          },
        }),
      );
    }
  }
} finally {
  await sql.end();
}
