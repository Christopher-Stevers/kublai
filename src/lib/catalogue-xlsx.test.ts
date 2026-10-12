// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPrivateBackgroundWork } from "./private-background-work";
import {
  downloadCatalogueRowsAsXlsx,
  prepareCatalogueRowsAsXlsx,
  readCatalogueImportWorkbook,
} from "./catalogue-xlsx";
import {
  buildCatalogueWorkbook,
  normalizeCatalogueImportRows,
} from "./catalogue-xlsx-core";
import type {
  CatalogueWorkbookRequest,
  CatalogueWorkbookResponse,
} from "./catalogue-xlsx-protocol";
class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: CatalogueWorkbookRequest[] = [];
  onmessage?: (event: { data: CatalogueWorkbookResponse }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: CatalogueWorkbookRequest) {
    this.messages.push(message);
  }
  emit(data: CatalogueWorkbookResponse) {
    this.onmessage?.({ data });
  }
}
const raw = {
  catalog: "Plumbing",
  displayName: "Pipe",
  partId: "one",
  description: "",
  isActive: false,
};
const file = new File(["fixture"], "parts.xlsx");
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  clearPrivateBackgroundWork();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("background catalogue workbooks", () => {
  it("collects acknowledged import batches in order and reports progress", async () => {
    const progress = vi.fn();
    const task = readCatalogueImportWorkbook(file, { onProgress: progress });
    const worker = FakeWorker.instances[0]!;
    const rows = normalizeCatalogueImportRows([raw]);
    expect(worker.messages).toEqual([{ kind: "read", file }]);
    worker.emit({ kind: "rows", rows, completed: 1, total: 2 });
    expect(worker.messages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages.at(-1)).toEqual({ kind: "next" });
    worker.emit({ kind: "rows", rows, completed: 2, total: 2 });
    worker.emit({ kind: "done" });
    expect(await task).toEqual([...rows, ...rows]);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("sends export rows in bounded batches and waits before encoding", async () => {
    const rows = Array.from({ length: 601 }, (_, i) => ({
      ...raw,
      partId: String(i),
    }));
    const task = prepareCatalogueRowsAsXlsx(rows);
    const worker = FakeWorker.instances[0]!;
    for (let i = 0; i < 4; i++) {
      worker.emit({ kind: "ready" });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(
      worker.messages
        .filter((x) => x.kind === "write-rows")
        .map((x) => (x.kind === "write-rows" ? x.rows.length : 0)),
    ).toEqual([250, 250, 101]);
    expect(worker.messages.at(-1)).toEqual({ kind: "write-finish" });
    const buffer = new ArrayBuffer(8);
    worker.emit({ kind: "buffer", buffer });
    expect(await task).toBe(buffer);
  });
  it.each(["caller", "account"])(
    "terminates %s cancellation and ignores late data",
    async (kind) => {
      const controller = new AbortController();
      const task = readCatalogueImportWorkbook(file, {
        signal: controller.signal,
      });
      const rejected = expect(task).rejects.toMatchObject({
        name: "AbortError",
      });
      const worker = FakeWorker.instances[0]!;
      if (kind === "caller") controller.abort();
      else clearPrivateBackgroundWork();
      await rejected;
      worker.emit({ kind: "done" });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );
  it("prevents a download cancelled between encoding and completion", async () => {
    const controller = new AbortController();
    const create = vi.spyOn(URL, "createObjectURL");
    const task = downloadCatalogueRowsAsXlsx([raw], "parts.xlsx", {
      signal: controller.signal,
    });
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    FakeWorker.instances[0]!.emit({
      kind: "buffer",
      buffer: new ArrayBuffer(1),
    });
    controller.abort();
    await rejected;
    expect(create).not.toHaveBeenCalled();
  });
  it("reports worker failure without retrying expensive work on the UI thread", async () => {
    const task = prepareCatalogueRowsAsXlsx([raw]);
    const rejected = expect(task).rejects.toThrow("stopped");
    FakeWorker.instances[0]!.onerror?.();
    await rejected;
    expect(FakeWorker.instances).toHaveLength(1);
  });
  it("times out stuck processing and disposes it", async () => {
    const task = prepareCatalogueRowsAsXlsx([raw]);
    const rejected = expect(task).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(120000);
    await rejected;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
  it("keeps compatible parsing when workers are unavailable", async () => {
    vi.useRealTimers();
    vi.stubGlobal("Worker", undefined);
    const buffer = await buildCatalogueWorkbook([raw]);
    expect(
      await readCatalogueImportWorkbook(new File([buffer], "parts.xlsx")),
    ).toEqual(normalizeCatalogueImportRows([raw]));
  });
});
