/** Read-only, private development export. Never trains a model or changes receipts.
 * DATABASE_URL and JOB_DOCUMENT_STORAGE_ROOT must point to the intended environment.
 * Usage: tsx scripts/export-packing-slip-trial.ts <job UUID> <trial run ID> <private output directory>
 */
import postgres from "postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  trialIndexSchema,
  trialResultSchema,
  trialReaders,
  trialKey,
} from "../src/lib/packing-slip-trial";
import type { DocumentState } from "../src/server/documents/types";

const [jobArg, runArg, output] = process.argv.slice(2);
const jobId = z.uuid().parse(jobArg),
  runId = z
    .string()
    .regex(/^[a-zA-Z0-9-]{8,80}$/)
    .parse(runArg);
if (
  !output ||
  !process.env.DATABASE_URL ||
  !process.env.JOB_DOCUMENT_STORAGE_ROOT
)
  throw Error(
    "Supply the output directory, DATABASE_URL and JOB_DOCUMENT_STORAGE_ROOT.",
  );
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [workspace] =
    await sql`select "organizationId",state from kublai_job_document_workspace where "jobId"=${jobId}`;
  if (!workspace) throw Error("Job workspace not found.");
  const orgId = z.uuid().parse(workspace.organizationId),
    state = workspace.state as DocumentState;
  const folder = path.join(
    process.env.JOB_DOCUMENT_STORAGE_ROOT,
    ".packing-trials",
    orgId,
    jobId,
    runId,
  );
  const index = trialIndexSchema.parse(
    JSON.parse(await readFile(path.join(folder, "index.json"), "utf8")),
  );
  if (
    index.jobId !== jobId ||
    index.organizationId !== orgId ||
    index.runId !== runId
  )
    throw Error("Trial scope mismatch.");
  const history =
    await sql`select "documentId","versionId","runId",kind,"createdAt","userId",data from kublai_packing_slip_review_history where "organizationId"=${orgId} and "jobId"=${jobId} order by "createdAt"`;
  const explicitlyChecked = new Set<string>();
  for (const h of history) {
    const data = h.data as {
      operation?: string;
      targetLineId?: string;
      after?: {
        sourceTrial?: { runId: string };
        lines?: Array<{ id: string; checked?: boolean; ignored?: unknown }>;
      };
    };
    const line = data.after?.lines?.find((l) => l.id === data.targetLineId);
    if (
      (data.operation === "line" || data.operation === "ignore") &&
      data.targetLineId &&
      data.after?.sourceTrial?.runId === runId &&
      (line?.checked || line?.ignored)
    )
      explicitlyChecked.add(
        `${h.documentId}:${h.versionId}:${data.targetLineId}`,
      );
  }
  const group = new Map(index.cases.map((c) => [c.documentId, c.documentId]));
  const root = (id: string): string =>
    group.has(id) && group.get(id) !== id ? root(group.get(id)!) : id;
  const join = (a: string, b: string) => {
    if (group.has(a) && group.has(b)) {
      const x = root(a),
        y = root(b);
      group.set(x > y ? x : y, x > y ? y : x);
    }
  };
  const hashes = new Map<string, string>(),
    deliveries = new Map<string, string>();
  for (const c of index.cases) {
    const duplicate = hashes.get(c.sha256);
    if (duplicate) join(c.documentId, duplicate);
    hashes.set(c.sha256, c.documentId);
    const review = state.documents.find(
      (d) => d.id === c.documentId,
    )?.receivingReview;
    if (review?.replaces) join(c.documentId, review.replaces);
    if (review?.duplicateDecision?.documentId)
      join(c.documentId, review.duplicateDecision.documentId);
    if (
      review?.humanReviewed &&
      review.deliveryNumber &&
      (review.supplierId || review.supplierName)
    ) {
      const key = `${review.supplierId ?? trialKey(review.supplierName)}:${trialKey(review.deliveryNumber)}`;
      const other = deliveries.get(key);
      if (other) join(c.documentId, other);
      deliveries.set(key, c.documentId);
    }
  }
  const groupMembers = new Map<string, string[]>();
  for (const c of index.cases) {
    const key = root(c.documentId);
    groupMembers.set(key, [...(groupMembers.get(key) ?? []), c.sha256]);
  }
  const records = [];
  for (const c of index.cases) {
    const predictions: Record<string, unknown> = {};
    for (const reader of trialReaders) {
      const raw = await readFile(
        path.join(folder, "results", reader, `${c.caseId}.json`),
        "utf8",
      ).catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      });
      if (!raw) continue;
      const result = trialResultSchema.parse(JSON.parse(raw));
      if (
        result.sourceSha256 !== c.sha256 ||
        result.reader !== reader ||
        result.caseId !== c.caseId
      )
        throw Error("Prediction source mismatch.");
      predictions[reader] = result;
    }
    const doc = state.documents.find((d) => d.id === c.documentId),
      review = doc?.receivingReview;
    const eligible =
      !!review &&
      review.versionId === c.versionId &&
      doc?.currentVersionId === c.versionId &&
      review.sourceTrial?.runId === runId &&
      review.documentChecked &&
      review.orderConfirmed &&
      review.kindConfirmed &&
      !review.retiredBy;
    const labels = eligible
      ? review.lines
          .filter(
            (l) =>
              (l.checked === true || Boolean(l.ignored)) &&
              (explicitlyChecked.has(
                `${c.documentId}:${c.versionId}:${l.id}`,
              ) ||
                (l.approved &&
                  Date.parse(l.approved.at) >= Date.parse(index.createdAt))) &&
              (!l.predictionSource || l.predictionSource.trialRunId === runId),
          )
          .map((l) => ({
            sourceLine: l.predictionSource,
            page: l.page,
            box: l.sourceBox,
            evidence: l.evidence,
            partId: l.partId ?? null,
            orderId: doc?.packingSlip?.orderId ?? null,
            orderItemId: l.orderItemId,
            description: l.description,
            sku: l.sku,
            quantity: l.quantity,
            unit: l.unit,
            kind: l.kind ?? review.kind,
            ignored: l.ignored ?? null,
            approved: l.approved ?? null,
            humanVerified: true,
            labelMeaning:
              "Human-checked receiving fields; not automatic ground truth for every printed character or for another reader's row alignment.",
          }))
      : [];
    const key = root(c.documentId),
      members = groupMembers.get(key)!;
    // A duplicate group is held out if ANY member was in the original hash-based holdout.
    const heldOut = members.some(
      (hash) =>
        parseInt(
          createHash("sha256")
            .update(`${runId}:${hash}`)
            .digest("hex")
            .slice(0, 8),
          16,
        ) %
          5 ===
        0,
    );
    records.push({
      schemaVersion: 1,
      runId,
      organizationId: orgId,
      jobId,
      source: c,
      group: key,
      split: heldOut ? "held-out" : "development",
      predictions,
      humanLabels: labels,
      humanReview: review
        ? {
            revision: review.revision,
            versionId: review.versionId,
            sourceTrial: review.sourceTrial,
            documentChecked: review.documentChecked,
            orderConfirmed: review.orderConfirmed,
            duplicateDecision: review.duplicateDecision,
          }
        : null,
    });
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(output, "trial-evaluation.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    path.join(output, "human-review-history.jsonl"),
    history.map((r) => JSON.stringify(r)).join("\n") + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    path.join(output, "README.txt"),
    "Private job-scoped evaluation. All readers remain separate. Confidence values are uncalibrated and their sources differ. Human labels require explicit source/version checks. Never use Astra output or inter-model agreement as ground truth. Check cross-reader row alignment before computing accuracy. Count missing lines, wrong orders, wrong units, returns and duplicates as distinct error types. Tune thresholds on development groups and test once on held-out groups. Related slips stay in the same split; regenerate splits after resolving duplicates, before training. No automatic training or deployment occurs.\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      cases: records.length,
      humanVerifiedLines: records.reduce((n, r) => n + r.humanLabels.length, 0),
      heldOutCases: records.filter((r) => r.split === "held-out").length,
      output: path.resolve(output),
    }),
  );
} finally {
  await sql.end();
}
