import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { documentStorageRoot } from "~/server/documents/storage";
import {
  detectionFolder,
  digest,
  evidenceLines,
  immutableJson,
  saveDetectionInput,
  type DetectionInput,
} from "./detection-record";
import type { SlipLine } from "~/lib/packing-slip-review";
type Call = {
  model: string;
  questions: unknown;
  inputs: Record<string, string>;
  response: unknown;
  durationMs: number;
  usage: unknown;
};
type Trace = {
  organizationId: string;
  runId: string;
  attemptId: string;
  input?: DetectionInput;
  calls: Call[];
  stages: Array<{ stage: string; at: string; data: unknown }>;
  startedAt: number;
};
const context = new AsyncLocalStorage<Trace>();
export function traceUsage() {
  const calls = context.getStore()?.calls ?? [];
  let inputTokens = 0,
    outputTokens = 0,
    unknownCalls = 0,
    estimatedUsd = 0;
  for (const c of calls) {
    const u = c.usage as {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    } | null;
    if (
      typeof u?.input_tokens === "number" &&
      typeof u.output_tokens === "number"
    ) {
      inputTokens += u.input_tokens;
      outputTokens += u.output_tokens;
      if (c.model.startsWith("gpt-6.1-terra")) {
        const cached = Math.min(
          u.input_tokens,
          Math.max(0, u.input_tokens_details?.cached_tokens ?? 0),
        );
        const long = u.input_tokens > 272000;
        estimatedUsd +=
          ((u.input_tokens - cached + cached * 0.05) * (long ? 2 : 1) +
            u.output_tokens * 5 * (long ? 1.5 : 1)) /
          1e6;
      } else if (c.model.startsWith("jev"))
        estimatedUsd += (u.input_tokens * 0.042) / 1e6;
      else unknownCalls++;
    } else unknownCalls++;
  }
  return {
    calls: calls.length,
    inputTokens,
    outputTokens,
    unknownCalls,
    estimatedUsd: unknownCalls ? null : estimatedUsd,
    pricingAsOf: "2026-10-27",
    pricingSource:
      "https://typesafe.ai/blog/introducing-system-one-models-and-jev ; https://developers.openai.com/api/docs/models/gpt-6.1-terra",
  };
}
export const READER_VERSION = "receiving-2026-10-30.1";
/** Always freeze the complete reference input, including cheap-only readings. */
export async function captureDetectionInput(
  input: Omit<
    DetectionInput,
    | "attemptId"
    | "runId"
    | "capturedAt"
    | "pages"
    | "coordinates"
    | "schemaVersion"
    | "execution"
  > & { execution?: "production" | "development" },
  pages: Buffer[],
) {
  const trace = context.getStore();
  if (!trace) return;
  if (input.organizationId !== trace.organizationId)
    throw Error("Detection scope mismatch.");
  trace.input = await saveDetectionInput(
    {
      ...input,
      execution: input.execution ?? "production",
      schemaVersion: 1,
      attemptId: trace.attemptId,
      runId: trace.runId,
      capturedAt: new Date().toISOString(),
      coordinates: "normalized-original-page-top-left",
      pages: pages.map((p, i) => ({ page: i + 1, sha256: digest(p) })),
    },
    pages,
  );
}
/** Frozen stage predictions accompany later human corrections in review history. */
export async function recordPipelineStage(stage: string, data: unknown) {
  const trace = context.getStore();
  if (!trace) return;
  trace.stages.push({
    stage,
    at: new Date().toISOString(),
    data: structuredClone(data),
  });
}
export async function withSlipTrace<T>(
  organizationId: string,
  runId: string,
  work: () => Promise<T>,
) {
  const trace: Trace = {
    organizationId,
    runId,
    attemptId: randomUUID(),
    calls: [],
    stages: [],
    startedAt: Date.now(),
  };
  return context.run(trace, async () => {
    try {
      return await work();
    } finally {
      const folder = path.join(
        documentStorageRoot,
        ".review-evidence",
        organizationId,
      );
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const record = {
        ...trace,
        release: process.env.NEXT_PUBLIC_APP_RELEASE ?? "unknown",
        readerVersion: READER_VERSION,
        usage: traceUsage(),
        completedAt: new Date().toISOString(),
      };
      // Keep every attempt. A worker retry must not overwrite its earlier
      // calls or predictions; the old filename is only a compatibility view.
      await immutableJson(
        path.join(folder, "attempts", `${runId}-${trace.attemptId}.json`),
        record,
      );
      if (trace.input) {
        await immutableJson(
          path.join(detectionFolder(trace.input), "result.json"),
          {
            schemaVersion: 1,
            inputSha256: digest(JSON.stringify(trace.input)),
            readerVersion: READER_VERSION,
            release: record.release,
            runId,
            attemptId: trace.attemptId,
            startedAt: trace.startedAt,
            completedAt: record.completedAt,
            status: trace.stages.some((s) => s.stage === "final-reading")
              ? "completed"
              : "interrupted-or-failed",
            usage: traceUsage(),
            modelCalls: trace.calls.map((c) => ({
              model: c.model,
              durationMs: c.durationMs,
              usage: c.usage,
              errorStatus:
                (c.response as { errorStatus?: number })?.errorStatus ?? null,
            })),
            stages: trace.stages.map((s) => {
              const data = s.data as { lines?: SlipLine[] };
              return {
                ...s,
                data: Array.isArray(data?.lines)
                  ? {
                      ...data,
                      lines: evidenceLines(
                        data.lines,
                        trace.input!.source.sha256,
                      ),
                    }
                  : s.data,
              };
            }),
            traceFile: `attempts/${runId}-${trace.attemptId}.json`,
          },
        );
      }
      const temporary = path.join(folder, `${runId}.${trace.attemptId}.tmp`);
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
      await rename(temporary, path.join(folder, `${runId}.json`));
    }
  });
}
/** The trace retains predictions separately from later human decisions; unknown usage stays unknown. */
export async function recordModelCall(input: {
  model: string;
  inputs: Record<string, Buffer | string>;
  questions: unknown;
  response: unknown;
  durationMs: number;
}) {
  const trace = context.getStore();
  if (!trace) return;
  if (trace.calls.length >= 2000)
    throw Error(
      "Reading reached its model-call limit. Review the remaining lines manually.",
    );
  const folder = path.join(
    documentStorageRoot,
    ".review-evidence",
    trace.organizationId,
    "images",
  );
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.inputs)) {
    if (typeof value === "string") inputs[key] = value;
    else {
      const hash = createHash("sha256").update(value).digest("hex");
      await writeFile(path.join(folder, `${hash}.png`), value, {
        mode: 0o600,
        flag: "wx",
      }).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      });
      inputs[key] = `sha256:${hash}`;
    }
  }
  trace.calls.push({
    model: input.model,
    inputs,
    questions: input.questions,
    response: input.response,
    durationMs: input.durationMs,
    usage: (input.response as { usage?: unknown })?.usage ?? null,
  });
}
