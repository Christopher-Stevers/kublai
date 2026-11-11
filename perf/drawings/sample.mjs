// Authorized production read only. Credentials remain in process env; no row contents logged.
import postgres from "postgres";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const root = path.resolve("uploads/job-floor-plans"),
  output = path.resolve("perf/drawings/private");
try {
  const rows = await db.begin("read only", async (sql) => {
    const plans =
      await sql`select "storageKey" as key from kublai_job_floor_plan where status = 'ready' order by "createdAt" desc`;
    const sheets =
      await sql`select "imageUrl" as key from kublai_job_drawing_sheet order by "createdAt" desc`;
    return [...plans, ...sheets];
  });
  const uploads = new Map();
  for (const { key } of rows) {
    const match = String(key).match(/([0-9a-f-]{36}\/[0-9a-f-]{36})\//i);
    if (match) uploads.set(match[1], path.join(root, match[1], "plan.pdf"));
  }
  const files = [];
  for (const [upload, file] of uploads) {
    try {
      await access(file);
      files.push({
        file,
        uploadHash: createHash("sha256")
          .update(upload)
          .digest("hex")
          .slice(0, 16),
      });
    } catch {}
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(output, "sources.json"),
    JSON.stringify(
      {
        provenance: "production-db-referenced-local-upload-storage",
        readOnly: true,
        files,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      referencedRows: rows.length,
      distinctUploads: uploads.size,
      readableOriginals: files.length,
    }),
  );
} finally {
  await db.end();
}
