/** Apply only the reviewed job-chat migrations. Safe to rerun; no chat messages are created. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const migrations = await Promise.all(
    [
      ["0042_job_chat", 1790992700000],
      ["0043_job_chat_push", 1790992800000],
    ].map(async ([tag, when]) => {
      const source = await readFile(
        new URL(`../drizzle/${tag}.sql`, import.meta.url),
        "utf8",
      );
      return {
        tag,
        when: Number(when),
        source,
        hash: createHash("sha256").update(source).digest("hex"),
      };
    }),
  );
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    await tx.unsafe("SELECT pg_advisory_xact_lock(72491834)");
    await tx.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await tx.unsafe(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    for (const migration of migrations) {
      const existing = await tx.unsafe(
        "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1",
        [migration.when],
      );
      if (existing.length && existing[0]!.hash !== migration.hash)
        throw new Error(`Migration checksum changed: ${migration.tag}`);
      if (!existing.length) {
        await tx.unsafe(migration.source);
        await tx.unsafe(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [migration.hash, migration.when],
        );
      }
      console.log(`${migration.tag}: applied or already present`);
    }
    const [checked] = await tx.unsafe(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('kublai_job_chat_member','kublai_job_chat_message','kublai_job_chat_event','kublai_job_chat_attachment','kublai_chat_push_subscription','kublai_chat_push_outbox')",
    );
    if (checked?.count !== 6) throw new Error("Expected six job-chat tables");
  });
  console.log("Job-chat schema ready. No messages or notifications were sent.");
} finally {
  await sql.end();
}
