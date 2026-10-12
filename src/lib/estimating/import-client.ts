"use client";

import { importPricingCsv } from "./csv";
import { registerPrivateBackgroundWork } from "../private-background-work";
import {
  PRICING_IMPORT_BATCH,
  type PricingImportRequest,
  type PricingImportResponse,
} from "./import-protocol";

const cancelled = () => new DOMException("CSV import cancelled.", "AbortError");
export async function importPricingCsvInBackground(
  csv: string,
  signal?: AbortSignal,
  options: { newRowIds?: boolean } = {},
) {
  signal?.throwIfAborted();
  // Reject oversized pasted input before copying it into another thread.
  if (csv.length > 5_000_000) return importPricingCsv(csv);
  let worker: Worker | undefined;
  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
        type: "module",
        name: "pricebook-import",
      });
    } catch {
      // Preserve imports on browsers that cannot create a worker.
    }
  }
  if (!worker) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const parsed = importPricingCsv(csv);
    return options.newRowIds
      ? {
          ...parsed,
          rows: parsed.rows.map((row) => ({ ...row, id: crypto.randomUUID() })),
        }
      : parsed;
  }
  const active = worker;
  const result: ReturnType<typeof importPricingCsv> = { rows: [], errors: [] };
  let closed = false;
  let nextTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: (cause: Error) => void = () => undefined;
  const cancel = () => rejectPending(cancelled());
  const unregister = registerPrivateBackgroundWork(cancel);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await new Promise<typeof result>((resolve, reject) => {
      const fail = (cause: Error) => {
        if (closed) return;
        closed = true;
        active.terminate();
        reject(cause);
      };
      rejectPending = fail;
      const send = (message: PricingImportRequest) => {
        try {
          active.postMessage(message);
        } catch {
          fail(new Error("The CSV could not be validated. Try again."));
        }
      };
      timeout = setTimeout(
        () => fail(new Error("CSV validation timed out. Try again.")),
        60_000,
      );
      active.onerror = () =>
        fail(new Error("The CSV could not be validated. Try again."));
      active.onmessageerror = () =>
        fail(new Error("The CSV result could not be read. Try again."));
      active.onmessage = ({ data }: MessageEvent<PricingImportResponse>) => {
        if (closed) return;
        if (data.kind === "failure") fail(new Error(data.message));
        else if (data.kind === "done") resolve(result);
        else if (data.kind === "chunk") {
          if (
            data.rows.length > PRICING_IMPORT_BATCH ||
            data.errors.length > PRICING_IMPORT_BATCH
          ) {
            fail(new Error("The CSV result could not be read. Try again."));
            return;
          }
          result.rows.push(...data.rows);
          result.errors.push(...data.errors);
          // Acknowledge after yielding so touch input and painting can run.
          nextTimer = setTimeout(() => {
            if (!closed) send({ kind: "next" });
          }, 0);
        }
      };
      if (signal?.aborted) fail(cancelled());
      else
        send({
          kind: "parse",
          csv,
          ...(options.newRowIds ? { newRowIds: true } : {}),
        });
    });
  } finally {
    if (!closed) active.terminate();
    closed = true;
    clearTimeout(timeout);
    clearTimeout(nextTimer);
    signal?.removeEventListener("abort", cancel);
    unregister();
  }
}
