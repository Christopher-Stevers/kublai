/** Read-only development export. Never calls an AI or changes receiving.
 * DATABASE_URL must be supplied by the operator. Output includes private job data.
 * Usage: node --import tsx scripts/export-receiving-evaluation.ts <job-uuid> <private-output-dir>
 */
import postgres from "postgres";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const [jobId, destination] = process.argv.slice(2);
if (!jobId || !destination || !/^[-0-9a-f]{36}$/i.test(jobId))
  throw Error("Supply a job UUID and private output directory.");
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL must be supplied.");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const rows =
    await sql`select "organizationId",state from kublai_job_document_workspace where "jobId"=${jobId}`;
  if (rows.length !== 1) throw Error("Job workspace not found.");
  const { organizationId, state } = rows[0]!;
  const history =
    await sql`select "documentId","versionId","runId",kind,"createdAt","userId",release,data from kublai_packing_slip_review_history where "organizationId"=${organizationId} and "jobId"=${jobId} order by "createdAt"`;
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const versions = state.versions as Array<{ id: string; sha256: string }>;
  const documents = state.documents as Array<{
    id: string;
    name: string;
    currentVersionId: string;
    receivingReview?: {
      replaces?: string;
      duplicateDecision?: { documentId?: string };
    };
  }>;
  const group = new Map(documents.map((d) => [d.id, d.id]));
  const root = (id: string): string =>
    group.get(id) === id || !group.has(id) ? id : root(group.get(id)!);
  const join = (a: string, b: string) => {
    group.set(root(a), root(b));
  };
  const hashes = new Map<string, string>();
  for (const d of documents) {
    const v = versions.find((v) => v.id === d.currentVersionId);
    if (v) {
      const same = hashes.get(v.sha256);
      if (same) join(d.id, same);
      hashes.set(v.sha256, d.id);
    }
    const related =
      d.receivingReview?.replaces ??
      d.receivingReview?.duplicateDecision?.documentId;
    if (related) join(d.id, related);
  }
  const records = [];
  for (const h of history) {
    const version = versions.find((v) => v.id === h.versionId),
      key = root(h.documentId);
    const bucket =
      parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) %
      5;
    const tracePath = path.join(
      process.env.JOB_DOCUMENT_STORAGE_ROOT ??
        path.join(process.cwd(), "uploads/job-documents"),
      ".review-evidence",
      organizationId,
      `${h.runId}.json`,
    );
    const trace = await readFile(tracePath, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    records.push({
      ...h,
      sourceSha256: version?.sha256 ?? null,
      split: bucket === 0 ? "held-out" : "development",
      group: key,
      trace,
    });
  }
  await writeFile(
    path.join(destination, "receiving-evidence.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    path.join(destination, "README.txt"),
    "Private job-scoped evidence. Model predictions and human decisions are separate. A received quantity is not automatically OCR ground truth. Duplicate/replacement groups stay in one split. Frontier labels require source verification and provenance. Evaluate wrong-order and duplicate-receipt failures before accepting a rule/prompt change. No automatic training or production rule updates occur.\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      records: records.length,
      heldOut: records.filter((r) => r.split === "held-out").length,
      output: path.resolve(destination),
    }),
  );
} finally {
  await sql.end();
}
