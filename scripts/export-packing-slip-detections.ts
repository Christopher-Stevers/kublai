/** Private, read-only export; NO model calls. Run with the server's environment:
 * node --conditions=react-server --import dotenv/config --import tsx scripts/export-packing-slip-detections.ts <organization UUID> <job UUID> <new private output folder>
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";
import {
  detectionInputSchema,
  detectionRoot,
  digest,
  EXTERNAL_READING_INSTRUCTIONS,
} from "../src/server/packing-slips/detection-record";
import { fallbackOutput } from "../src/server/packing-slips/terra-fallback";
import {
  documentBlobPath,
  documentStorageRoot,
} from "../src/server/documents/storage";

const [organization, job, destination] = process.argv.slice(2);
const orgId = z.uuid().parse(organization),
  jobId = z.uuid().parse(job);
if (
  !destination ||
  !process.env.DATABASE_URL ||
  !process.env.JOB_DOCUMENT_STORAGE_ROOT
)
  throw Error(
    "Supply organization, job, new output folder, DATABASE_URL and JOB_DOCUMENT_STORAGE_ROOT.",
  );
const output = path.resolve(destination);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [workspace] =
    await sql`select state from kublai_job_document_workspace where "organizationId"=${orgId} and "jobId"=${jobId}`;
  if (!workspace)
    throw Error("Job is outside the requested organization or unavailable.");
  await mkdir(output, { mode: 0o700 }); // Refuse to merge exports from different snapshots.
  for (const folder of [
    "reference-inputs",
    "predictions",
    "human-review",
    "assets",
  ])
    await mkdir(path.join(output, folder), { mode: 0o700 });
  await mkdir(path.join(output, "predictions", "assets"), { mode: 0o700 });
  const root = detectionRoot(orgId, jobId);
  const tasks: unknown[] = [],
    excluded: unknown[] = [];
  const write = (file: string, value: unknown) =>
    writeFile(path.join(output, file), JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  const copyAsset = async (
    source: string,
    target: string,
    expected: string,
  ) => {
    const bytes = await readFile(source);
    if (digest(bytes) !== expected)
      throw Error("Source evidence hash mismatch.");
    await writeFile(path.join(output, target), bytes, {
      mode: 0o600,
      flag: "wx",
    }).catch(async (error) => {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        digest(await readFile(path.join(output, target))) !== expected
      )
        throw error;
    });
  };
  const runs = await readdir(root, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const run of runs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!run.isDirectory() || !z.uuid().safeParse(run.name).success) continue;
    for (const attempt of (
      await readdir(path.join(root, run.name), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!attempt.isDirectory() || !z.uuid().safeParse(attempt.name).success)
        continue;
      const folder = path.join(root, run.name, attempt.name),
        caseId = `${run.name}-${attempt.name}`;
      const storedInput: unknown = JSON.parse(
        await readFile(path.join(folder, "input.json"), "utf8"),
      );
      const input = detectionInputSchema.parse(storedInput);
      if (
        input.organizationId !== orgId ||
        input.jobId !== jobId ||
        input.runId !== run.name ||
        input.attemptId !== attempt.name
      )
        throw Error("Detection scope mismatch.");
      const raw = await readFile(
        path.join(folder, "result.json"),
        "utf8",
      ).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (!raw) {
        excluded.push({ caseId, reason: "Attempt has no completed record" });
        continue;
      }
      const result = JSON.parse(raw) as {
        inputSha256: string;
        status: string;
        modelCalls: Array<{ model: string }>;
        stages: Array<{ stage: string; data: unknown }>;
      };
      if (result.inputSha256 !== digest(JSON.stringify(storedInput)))
        throw Error("Detection inputs changed after reading.");
      const final = result.stages.find((s) => s.stage === "final-reading")
        ?.data as { cascade?: { status?: string } } | undefined;
      const terraUsed =
        result.modelCalls.some((c) => c.model.startsWith("gpt-6.1-terra")) ||
        final?.cascade?.status === "completed";
      if (
        input.execution === "development" &&
        !process.argv.includes("--include-development")
      ) {
        excluded.push({
          caseId,
          reason: "Development preview; include explicitly for export testing",
        });
        continue;
      }
      if (
        terraUsed ||
        result.status !== "completed" ||
        input.provenance !== "captured-before-reading"
      ) {
        excluded.push({
          caseId,
          reason: terraUsed
            ? "Terra already attempted or reused"
            : result.status !== "completed"
              ? "Incomplete reading"
              : "Cached or retrospective input; not an independent new sample",
        });
        continue;
      }
      const pages = input.pages.map((p) => ({
        page: p.page,
        sha256: p.sha256,
        file: `assets/${p.sha256}.png`,
      }));
      for (const p of pages)
        await copyAsset(
          path.join(root, "assets", `${p.sha256}.png`),
          p.file,
          p.sha256,
        );
      await copyAsset(
        documentBlobPath(orgId, input.source.sha256),
        `assets/${input.source.sha256}.source`,
        input.source.sha256,
      );
      // The source's filename and the pre-linked order can themselves encode a
      // previous answer. Keep both out of the blind model request.
      const reference = {
        schemaVersion: 1,
        caseId,
        mode: "blind-reference",
        pages,
        sourceSha256: input.source.sha256,
        mimeType: input.source.mimeType,
        sourceWarnings: input.sourceWarnings,
        orders: input.orders,
        candidatePoolComplete: input.candidatePoolComplete,
        linkedOrderId: null,
        earlierLines: [],
        reasons: [],
        instructions: EXTERNAL_READING_INSTRUCTIONS,
      };
      const inputSha256 = digest(JSON.stringify(reference));
      await write(`reference-inputs/${caseId}.json`, reference);
      await write(`predictions/${caseId}.json`, { input, result });
      const trace = JSON.parse(
        await readFile(
          path.join(
            documentStorageRoot,
            ".review-evidence",
            orgId,
            "attempts",
            `${caseId}.json`,
          ),
          "utf8",
        ),
      ) as {
        organizationId: string;
        runId: string;
        attemptId: string;
        calls: Array<{ inputs: Record<string, string> }>;
      };
      if (
        trace.organizationId !== orgId ||
        trace.runId !== run.name ||
        trace.attemptId !== attempt.name
      )
        throw Error("Model trace scope mismatch.");
      await write(`predictions/${caseId}.trace.json`, trace);
      for (const call of trace.calls)
        for (const value of Object.values(call.inputs)) {
          const image = /^sha256:([a-f0-9]{64})$/.exec(value)?.[1];
          if (image)
            await copyAsset(
              path.join(
                documentStorageRoot,
                ".review-evidence",
                orgId,
                "images",
                `${image}.png`,
              ),
              `predictions/assets/${image}.png`,
              image,
            );
        }
      tasks.push({
        caseId,
        inputSha256,
        file: `reference-inputs/${caseId}.json`,
        sourceSha256: input.source.sha256,
        sourceFamily: input.documentId,
        schema: "output-schema.json",
        status: "pending",
        model: "gpt-6.1-terra",
        split: "unassigned",
        instruction:
          "Freeze duplicate/revision/supplier-family groups before tuning or evaluating thresholds. Never split retries of the same source across train and test.",
      });
    }
  }
  // Human events are exported separately, with their exact source/version and
  // operation. An approved receiving amount is NOT automatically a verified
  // transcription of the printed shipped amount.
  const history =
    await sql`select "documentId","versionId","runId",kind,"createdAt","userId",data from kublai_packing_slip_review_history where "organizationId"=${orgId} and "jobId"=${jobId} order by "createdAt"`;
  await writeFile(
    path.join(output, "human-review", "events.jsonl"),
    history
      .map((h) =>
        JSON.stringify({
          ...h,
          labelMeaning:
            "Receiving decision/event; only explicitly checked fields may be labels. Not printed-text ground truth.",
        }),
      )
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  await write(
    "output-schema.json",
    z.toJSONSchema(fallbackOutput, { target: "draft-7" }),
  );
  await write("manifest.json", {
    schemaVersion: 1,
    organizationId: orgId,
    jobId,
    exportedAt: new Date().toISOString(),
    tasks,
    excluded,
  });
  await writeFile(
    path.join(output, "README.txt"),
    `${EXTERNAL_READING_INSTRUCTIONS}\n\nNo API calls have been made. Give the external reader ONLY reference-inputs, assets and output-schema.json. Predictions and human-review are evaluator-only. Record model/version, reasoning effort, prompt version, inputSha256, raw output, usage/cost and timing. Validate with import-packing-slip-reference.ts. Independent reference scores and human reviews remain distinct. No receipt totals are changed.\n`,
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      pending: tasks.length,
      excluded: excluded.length,
      humanEvents: history.length,
      output,
    }),
  );
} finally {
  await sql.end();
}
