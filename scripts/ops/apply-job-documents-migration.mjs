import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const tag = "0049_job_documents";
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
const entry = journal.entries.find((row) => row.tag === tag);
if (!entry) throw new Error(`Missing migration journal entry: ${tag}`);
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is not configured");
const hash = createHash("sha256").update(migration).digest("hex");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    await tx`SELECT pg_advisory_xact_lock(72491834)`;
    if (process.argv.includes("--rollback-empty")) {
      // Never silently destroy user documents. Restore backups for a populated rollback.
      const exists =
        await tx`SELECT to_regclass('public.kublai_job_document_workspace') AS table_name`;
      if (exists[0]?.table_name) {
        await tx`LOCK TABLE kublai_job_document_workspace IN ACCESS EXCLUSIVE MODE`;
        const rows =
          await tx`SELECT 1 FROM kublai_job_document_workspace LIMIT 1`;
        if (rows.length)
          throw new Error(
            "Rollback refused: the workspace contains data. Back up and restore explicitly.",
          );
        await tx`DROP TABLE kublai_job_document_workspace`;
      }
      await tx`DELETE FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`;
      return;
    }
    if (
      (
        await tx`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`
      ).length
    )
      return;
    await tx.unsafe(migration);
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
  });
  console.log(
    process.argv.includes("--rollback-empty")
      ? "Empty document workspace migration rolled back"
      : "Job documents migration applied atomically",
  );
} finally {
  await sql.end();
}
