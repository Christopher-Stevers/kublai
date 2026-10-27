/** Development-only: stage fresh predictions for receiving review; never approve quantities.
 * Usage: tsx scripts/import-packing-slip-trial.ts <job UUID> <run ID> <authorized user ID> [--apply]
 * Explicit environment credentials and JOB_DOCUMENT_STORAGE_ROOT are required.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertDocumentAccess } from "../src/server/documents/access";
import { readWorkspace } from "../src/server/documents/service";
import { trialIndex } from "../src/server/packing-slips/trial-store";
import { importTrialReview } from "../src/server/packing-slips/receiving-service";
import { trialReaders } from "../src/lib/packing-slip-trial";

async function main() {
  const [jobArg, runArg, userId, flag] = process.argv.slice(2);
  const jobId = z.uuid().parse(jobArg),
    runId = z
      .string()
      .regex(/^[a-zA-Z0-9-]{8,80}$/)
      .parse(runArg);
  if (
    !userId ||
    !process.env.DATABASE_URL ||
    !process.env.JOB_DOCUMENT_STORAGE_ROOT
  )
    throw Error("An authorized user ID and explicit environment are required.");
  if (flag && flag !== "--apply") throw Error("Unknown flag.");
  const access = await assertDocumentAccess(userId, jobId);
  const index = await trialIndex(access, runId);
  if (!index) throw Error("Trial not found.");
  const state = await readWorkspace(access);
  let imported = 0,
    waiting = 0,
    preserved = 0,
    conflicts = 0;
  for (const entry of index.cases) {
    if (trialReaders.some((r) => entry.readers?.[r] !== "complete")) {
      waiting++;
      continue;
    }
    const doc = state.documents.find((d) => d.id === entry.documentId);
    if (!doc || doc.deletedAt || doc.currentVersionId !== entry.versionId) {
      conflicts++;
      continue;
    }
    if (!flag) {
      console.log(
        JSON.stringify({
          caseId: entry.caseId,
          action: "would-check-and-stage",
          reader: "astra",
        }),
      );
      continue;
    }
    try {
      const result = await importTrialReview(access, {
        action: "trialDraft",
        jobId,
        documentId: entry.documentId,
        revision: doc.receivingReview?.revision ?? 1,
        requestId: randomUUID(),
        runId,
        reader: "astra",
      });
      if ("skipped" in result) preserved++;
      else imported++;
      console.log(JSON.stringify({ caseId: entry.caseId, ...result }));
    } catch (error) {
      conflicts++;
      console.log(
        JSON.stringify({
          caseId: entry.caseId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      applied: flag === "--apply",
      cases: index.cases.length,
      imported,
      waiting,
      preserved,
      conflicts,
    }),
  );
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
