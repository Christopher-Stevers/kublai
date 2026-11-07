import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
const tag = "0074_job_pricing";
const migration = await readFile(
  new URL(`../../drizzle/${tag}.sql`, import.meta.url),
  "utf8",
);
const journal = JSON.parse(
  await readFile(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) throw Error("Migration journal entry missing");
const hash = createHash("sha256").update(migration).digest("hex");
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await connection.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout='5s'`;
    await tx`SET LOCAL statement_timeout='30s'`;
    await tx`SELECT pg_advisory_xact_lock(72491834)`;
    if (
      (await tx`SELECT id FROM drizzle.__drizzle_migrations WHERE hash=${hash}`)
        .length
    )
      return;
    await tx.unsafe(migration);
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES (${hash},${entry.when})`;
  });
  console.log("Job pricing migration applied and recorded atomically");
} finally {
  await connection.end();
}
