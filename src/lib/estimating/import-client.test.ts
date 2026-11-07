import { afterEach, describe, expect, it, vi } from "vitest";
import { importPricingCsvInBackground } from "./import-client";
import { importPricingCsv } from "./csv";
import { clearPrivateBackgroundWork } from "../private-background-work";
import type {
  PricingImportRequest,
  PricingImportResponse,
} from "./import-protocol";

class ImportWorker {
  static instances: ImportWorker[] = [];
  onmessage: ((event: MessageEvent<PricingImportResponse>) => void) | null =
    null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: PricingImportRequest[] = [];
  terminate = vi.fn();
  constructor() {
    ImportWorker.instances.push(this);
  }
  postMessage(request: PricingImportRequest) {
    this.requests.push(request);
  }
  respond(value: PricingImportResponse) {
    this.onmessage?.({ data: value } as MessageEvent<PricingImportResponse>);
  }
}
const csv = "description,unit,materialUnitCost\nCopper pipe,ft,2\n";
afterEach(() => {
  clearPrivateBackgroundWork();
  ImportWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("background pricebook import", () => {
  it("acknowledges bounded batches after yielding and retains rows and errors in order", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ImportWorker);
    const promise = importPricingCsvInBackground(csv);
    const worker = ImportWorker.instances[0]!;
    expect(worker.requests).toEqual([{ kind: "parse", csv }]);
    const rows = importPricingCsv(csv).rows;
    worker.respond({ kind: "chunk", rows, errors: ["Row 3 invalid"] });
    expect(worker.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.requests.at(-1)).toEqual({ kind: "next" });
    worker.respond({ kind: "chunk", rows: [], errors: ["Row 4 invalid"] });
    await vi.advanceTimersByTimeAsync(1);
    worker.respond({ kind: "done" });
    expect(await promise).toEqual({
      rows,
      errors: ["Row 3 invalid", "Row 4 invalid"],
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels on account change and ignores late responses", async () => {
    vi.stubGlobal("Worker", ImportWorker);
    const promise = importPricingCsvInBackground(csv);
    const rejection = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    const worker = ImportWorker.instances[0]!;
    clearPrivateBackgroundWork();
    worker.respond({
      kind: "chunk",
      rows: importPricingCsv(csv).rows,
      errors: [],
    });
    worker.respond({ kind: "done" });
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.requests).toHaveLength(1);
  });
  it("terminates an in-progress validation when its signal is aborted", async () => {
    vi.stubGlobal("Worker", ImportWorker);
    const controller = new AbortController();
    const promise = importPricingCsvInBackground(csv, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(ImportWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it("does not start a worker for a cancelled or oversized request", async () => {
    vi.stubGlobal("Worker", ImportWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(
      importPricingCsvInBackground(csv, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(
      (await importPricingCsvInBackground("x".repeat(5_000_001))).errors[0],
    ).toContain("5 MB");
    expect(ImportWorker.instances).toHaveLength(0);
  });
  it.each(["unsupported", "constructor"])(
    "preserves parser behavior for %s workers",
    async (mode) => {
      vi.stubGlobal(
        "Worker",
        mode === "unsupported"
          ? undefined
          : class {
              constructor() {
                throw Error("Unavailable");
              }
            },
      );
      expect(await importPricingCsvInBackground(csv)).toEqual(
        importPricingCsv(csv),
      );
    },
  );
  it.each(["error", "message", "failure", "oversized"])(
    "cleans up after a %s response",
    async (mode) => {
      vi.stubGlobal("Worker", ImportWorker);
      const promise = importPricingCsvInBackground(csv);
      const rejection = expect(promise).rejects.toThrow();
      const worker = ImportWorker.instances[0]!;
      if (mode === "error") worker.onerror?.();
      if (mode === "message") worker.onmessageerror?.();
      if (mode === "failure")
        worker.respond({ kind: "failure", message: "Import failed" });
      if (mode === "oversized")
        worker.respond({
          kind: "chunk",
          rows: Array.from(
            { length: 251 },
            () => importPricingCsv(csv).rows[0]!,
          ),
          errors: [],
        });
      await rejection;
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );
  it("bounds validation time and discards partial results", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", ImportWorker);
    const promise = importPricingCsvInBackground(csv);
    const rejection = expect(promise).rejects.toThrow("timed out");
    ImportWorker.instances[0]!.respond({
      kind: "chunk",
      rows: importPricingCsv(csv).rows,
      errors: [],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(ImportWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
