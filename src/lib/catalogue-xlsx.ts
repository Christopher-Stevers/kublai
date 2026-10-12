import { registerPrivateBackgroundWork } from "./private-background-work";
import {
  CATALOGUE_WORKBOOK_BATCH,
  type CatalogueWorkbookOptions,
  type CatalogueWorkbookRequest,
  type CatalogueWorkbookResponse,
} from "./catalogue-xlsx-protocol";
import type { CatalogueImportRow } from "./catalogue-xlsx-core";
export {
  normalizeCatalogueImportRow,
  normalizeCatalogueImportRows,
  type CatalogueImportRow,
} from "./catalogue-xlsx-core";

const cancelled = () =>
  new DOMException("Workbook preparation cancelled.", "AbortError");
async function runWorkbookTask(
  job: { kind: "read"; file: File } | { kind: "write"; rows: unknown[] },
  options: CatalogueWorkbookOptions,
): Promise<CatalogueImportRow[] | ArrayBuffer> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const unregister = registerPrivateBackgroundWork(abort);
  options.signal?.addEventListener("abort", abort, { once: true });
  let worker: Worker | undefined;
  let terminated = false;
  const terminate = () => {
    if (!terminated) {
      worker?.terminate();
      terminated = true;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof Worker !== "undefined") {
      try {
        worker = new Worker(
          new URL("./catalogue-xlsx.worker.ts", import.meta.url),
          { type: "module", name: "catalogue-workbook" },
        );
      } catch {
        /* Keep the existing parser when workers cannot be created. */
      }
    }
    if (!worker) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      controller.signal.throwIfAborted();
      const core = await import("./catalogue-xlsx-core");
      controller.signal.throwIfAborted();
      let result: CatalogueImportRow[] | ArrayBuffer;
      if (job.kind === "read") {
        const buffer = await job.file.arrayBuffer();
        controller.signal.throwIfAborted();
        result = await core.parseCatalogueWorkbook(buffer, controller.signal);
      } else
        result = await core.buildCatalogueWorkbook(job.rows, controller.signal);
      controller.signal.throwIfAborted();
      const total =
        job.kind === "read"
          ? (result as CatalogueImportRow[]).length
          : job.rows.length;
      options.onProgress?.(total, total);
      controller.signal.throwIfAborted();
      return result;
    }
    const active = worker;
    return await new Promise<CatalogueImportRow[] | ArrayBuffer>(
      (resolve, reject) => {
        let closed = false;
        let offset = 0;
        const rows: CatalogueImportRow[] = [];
        const finish = (
          result?: CatalogueImportRow[] | ArrayBuffer,
          error?: Error,
        ) => {
          if (closed) return;
          closed = true;
          terminate();
          if (error) reject(error);
          else resolve(result!);
        };
        const send = (message: CatalogueWorkbookRequest) => {
          try {
            active.postMessage(message);
          } catch {
            finish(
              undefined,
              new Error("The workbook could not be processed. Try again."),
            );
          }
        };
        const onAbort = () => finish(undefined, cancelled());
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(
          () =>
            finish(
              undefined,
              new Error("Workbook preparation timed out. Try again."),
            ),
          120_000,
        );
        active.onerror = () =>
          finish(
            undefined,
            new Error("Workbook preparation stopped. Try again."),
          );
        active.onmessageerror = () =>
          finish(
            undefined,
            new Error("The workbook result could not be read. Try again."),
          );
        active.onmessage = ({
          data,
        }: MessageEvent<CatalogueWorkbookResponse>) => {
          if (closed) return;
          try {
            if (data.kind === "failure")
              finish(undefined, new Error(data.message));
            else if (data.kind === "rows" && job.kind === "read") {
              if (
                data.rows.length > CATALOGUE_WORKBOOK_BATCH ||
                data.completed !== rows.length + data.rows.length ||
                data.total < data.completed
              )
                throw Error("The workbook result could not be read.");
              rows.push(...data.rows);
              options.onProgress?.(data.completed, data.total);
              nextTimer = setTimeout(() => {
                if (!closed) send({ kind: "next" });
              }, 0);
            } else if (data.kind === "done" && job.kind === "read")
              finish(rows);
            else if (data.kind === "ready" && job.kind === "write") {
              options.onProgress?.(offset, job.rows.length);
              nextTimer = setTimeout(() => {
                if (closed) return;
                if (offset >= job.rows.length) send({ kind: "write-finish" });
                else {
                  const chunk = job.rows.slice(
                    offset,
                    offset + CATALOGUE_WORKBOOK_BATCH,
                  );
                  offset += chunk.length;
                  send({ kind: "write-rows", rows: chunk });
                }
              }, 0);
            } else if (data.kind === "buffer" && job.kind === "write")
              finish(data.buffer);
            else throw Error("The workbook result could not be read.");
          } catch (error) {
            finish(
              undefined,
              error instanceof Error
                ? error
                : new Error("Workbook preparation failed."),
            );
          }
        };
        if (controller.signal.aborted) onAbort();
        else send(job.kind === "read" ? job : { kind: "write-start" });
      },
    );
  } finally {
    terminate();
    clearTimeout(timer);
    clearTimeout(nextTimer);
    options.signal?.removeEventListener("abort", abort);
    unregister();
  }
}
export async function readCatalogueImportWorkbook(
  file: File,
  options: CatalogueWorkbookOptions = {},
) {
  return (await runWorkbookTask(
    { kind: "read", file },
    options,
  )) as CatalogueImportRow[];
}
export async function prepareCatalogueRowsAsXlsx(
  rows: unknown[],
  options: CatalogueWorkbookOptions = {},
) {
  return (await runWorkbookTask(
    { kind: "write", rows },
    options,
  )) as ArrayBuffer;
}
export async function downloadCatalogueRowsAsXlsx(
  rows: unknown[],
  filename: string,
  options: CatalogueWorkbookOptions = {},
) {
  const buffer = await prepareCatalogueRowsAsXlsx(rows, options);
  options.signal?.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
