/** Add permanent links from sent material-list rows to their order lines. */
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const tag = "0073_material_list_sent_links";
const source = await readFile(
  new URL(`../drizzle/${tag}.sql`, import.meta.url),
  "utf8",
);
const journal = JSON.parse(
  await readFile(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: { tag: string; when: number }[] };
const entry = journal.entries.find((row) => row.tag === tag);
if (!entry) throw new Error("Missing material sent-link migration journal entry");
const hash = createHash("sha256").update(source).digest("hex");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL search_path TO public");
    await tx.unsafe("SET LOCAL lock_timeout='5s'");
    await tx.unsafe("SET LOCAL statement_timeout='30s'");
    await tx.unsafe("SELECT pg_advisory_xact_lock(72491834)");
    const existing = await tx.unsafe(
      "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1",
      [entry.when],
    );
    if (existing.length && existing[0]!.hash !== hash)
      throw new Error("Material sent-link migration checksum changed");
    if (!existing.length) {
      await tx.unsafe(source);
      await tx.unsafe(
        "INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)",
        [hash, entry.when],
      );
    }
  });
  console.log("Material sent links ready. Unambiguous historical lines linked.");
} finally {
  await sql.end();
}
