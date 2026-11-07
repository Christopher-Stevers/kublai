/** Apply only private conversation migrations; never sends chat messages. */
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const migrations = await Promise.all(
    [
      ["0052_private_conversations", "2026-10-09T06:00:00Z"],
      ["0053_conversation_push", "2026-10-09T17:00:00Z"],
      ["0054_snapshot_source_links", "2026-10-09T20:00:00Z"],
      ["0056_snapshot_editing", "2026-10-09T22:00:00Z"],
    ].map(async ([tag, date]) => {
      const source = await readFile(
        new URL(`../drizzle/${tag}.sql`, import.meta.url),
        "utf8",
      );
      return {
        source,
        hash: createHash("sha256").update(source).digest("hex"),
        when: Date.parse(date!),
      };
    }),
  );
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'");
    await tx.unsafe("SET LOCAL statement_timeout='30s'");
    await tx.unsafe("SELECT pg_advisory_xact_lock(72491834)");
    await tx.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await tx.unsafe(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    for (const { source, hash, when } of migrations) {
      const existing = await tx.unsafe(
        "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1",
        [when],
      );
      if (existing.length && existing[0]!.hash !== hash)
        throw new Error("Private conversation migration checksum changed");
      if (!existing.length) {
        await tx.unsafe(source);
        await tx.unsafe(
          "INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)",
          [hash, when],
        );
      }
    }
  });
  console.log("Private conversation schema ready. No messages were sent.");
} finally {
  await sql.end();
}
