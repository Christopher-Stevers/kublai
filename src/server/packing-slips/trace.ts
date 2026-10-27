import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { documentStorageRoot } from "~/server/documents/storage";
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
  calls: Call[];
  startedAt: number;
};
const context = new AsyncLocalStorage<Trace>();
export function traceUsage() {
  const calls = context.getStore()?.calls ?? [];
  let inputTokens = 0,
    outputTokens = 0,
    unknownCalls = 0;
  for (const c of calls) {
    const u = c.usage as {
      input_tokens?: number;
      output_tokens?: number;
    } | null;
    if (
      typeof u?.input_tokens === "number" &&
      typeof u.output_tokens === "number"
    ) {
      inputTokens += u.input_tokens;
      outputTokens += u.output_tokens;
    } else unknownCalls++;
  }
  return {
    calls: calls.length,
    inputTokens,
    outputTokens,
    unknownCalls,
    estimatedUsd: unknownCalls ? null : (inputTokens * 0.042) / 1_000_000,
    pricingAsOf: "2026-10-27",
    pricingSource:
      "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
  };
}
export const READER_VERSION = "receiving-2026-10-27.1";
export async function withSlipTrace<T>(
  organizationId: string,
  runId: string,
  work: () => Promise<T>,
) {
  const trace: Trace = {
    organizationId,
    runId,
    calls: [],
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
      await writeFile(
        path.join(folder, `${runId}.json`),
        JSON.stringify({
          ...trace,
          readerVersion: READER_VERSION,
          usage: traceUsage(),
          completedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
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
