/** Add drawing folder nesting without running unrelated pending migrations. */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const source = await readFile(new URL("../drizzle/0100_drawing_subfolders.sql", import.meta.url), "utf8");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async tx => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'");
    await tx.unsafe("SET LOCAL statement_timeout='30s'");
    await tx.unsafe(source);
  });
  console.log("Drawing subfolder storage ready.");
} finally {
  await sql.end();
}
