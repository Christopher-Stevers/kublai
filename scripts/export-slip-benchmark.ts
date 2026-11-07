/** Exports confirmed packing slips as a human-verified benchmark: the file as
 * uploaded, the order items as they stood, and the quantities the user
 * confirmed. Reads production data, so run it only with the owner's OK. The
 * output is private business data: it stays on this machine, owner-only.
 *
 *   DATABASE_URL=… JOB_DOCUMENT_STORAGE_ROOT=… \
 *   node --import tsx scripts/export-slip-benchmark.ts --confirm-production-read
 *     [--out .tmp/slip-benchmark] [--org <organization id>] [--limit 200]
 *
 * Note: confirmed quantities are what physically arrived, which is usually but
 * not always what the slip says was shipped.
 */
import { copyFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, desc, eq } from "drizzle-orm";
import { packingSlipReviewHistory } from "../src/server/db/schema";
import { documentBlobPath } from "../src/server/documents/storage";
import type { SlipAnalysis } from "../src/lib/packing-slip-review";

const arg = (name: string) =>
  process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : undefined;
if (!process.argv.includes("--confirm-production-read")) {
  console.error(
    "This reads confirmed slips and their files from the database. Pass --confirm-production-read once the owner has agreed.",
  );
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw Error("DATABASE_URL is not set.");
const out = path.resolve(arg("--out") ?? ".tmp/slip-benchmark");
const org = arg("--org");
const limit = Number(arg("--limit") ?? 200);

const conn = postgres(url, { max: 1 });
const db = drizzle(conn);
try {
  const rows = await db
    .select()
    .from(packingSlipReviewHistory)
    .where(
      and(
        eq(packingSlipReviewHistory.kind, "confirmation"),
        ...(org ? [eq(packingSlipReviewHistory.organizationId, org)] : []),
      ),
    )
    .orderBy(desc(packingSlipReviewHistory.createdAt))
    .limit(limit);
  await mkdir(out, { recursive: true, mode: 0o700 });
  let written = 0;
  for (const row of rows) {
    const data = row.data as {
      packingSlip?: { orderId?: string };
      confirmedAnalysis?: SlipAnalysis;
      source?: { sha256: string; mimeType: string } | null;
      quantityMeaning?: string;
    };
    const confirmed = data.confirmedAnalysis;
    if (!confirmed?.applied || !data.source) continue;
    const blob = documentBlobPath(row.organizationId, data.source.sha256);
    try {
      await access(blob);
    } catch {
      console.warn(`skipped ${row.id}: file no longer stored`);
      continue;
    }
    const dir = path.join(out, row.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const ext = data.source.mimeType === "application/pdf" ? "pdf" : "img";
    await copyFile(blob, path.join(dir, `source.${ext}`));
    await writeFile(
      path.join(dir, "case.json"),
      JSON.stringify(
        {
          id: row.id,
          confirmedAt: row.createdAt,
          release: row.release,
          orderId: data.packingSlip?.orderId ?? null,
          mimeType: data.source.mimeType,
          quantityMeaning: data.quantityMeaning ?? null,
          items: confirmed.items,
          confirmed: confirmed.applied.quantities,
          lines: confirmed.lines.map((l) => ({
            page: l.page,
            evidence: l.evidence,
            orderItemId: l.orderItemId,
            linked: l.linked ?? null,
            shipped: l.shipped,
            proposed: l.proposed,
          })),
          model: confirmed.model ?? null,
        },
        null,
        1,
      ),
      { mode: 0o600 },
    );
    written++;
  }
  console.log(`${written} confirmed slips written to ${out}`);
} finally {
  await conn.end();
}
