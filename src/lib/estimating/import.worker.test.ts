// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { importPricingCsv } from "./csv";
import type {
  PricingImportRequest,
  PricingImportResponse,
} from "./import-protocol";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("pricebook worker parser", () => {
  it("assigns new staging IDs in the worker without changing pricing or evidence", async () => {
    const worker = {
      onmessage: null as
        | ((event: MessageEvent<PricingImportRequest>) => void)
        | null,
      postMessage: vi.fn<(message: PricingImportResponse) => void>(),
    };
    vi.stubGlobal("self", worker);
    await import("./import.worker");
    const csv =
      "description,unit,materialUnitCost,currency,priceSource\nPipe,ft,2,CAD,simulated\n";
    worker.onmessage?.({
      data: { kind: "parse", csv, newRowIds: true },
    } as MessageEvent<PricingImportRequest>);
    const message = worker.postMessage.mock.calls[0]?.[0];
    expect(message?.kind).toBe("chunk");
    if (message?.kind === "chunk") {
      expect(message.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect({ ...message.rows[0], id: "csv-2" }).toEqual(
        importPricingCsv(csv).rows[0],
      );
    }
  });
  it("returns the exact parser result in acknowledged batches, including malformed rows", async () => {
    const worker = {
      onmessage: null as
        | ((event: MessageEvent<PricingImportRequest>) => void)
        | null,
      postMessage: vi.fn<(message: PricingImportResponse) => void>(),
    };
    vi.stubGlobal("self", worker);
    await import("./import.worker");
    const csv =
      "description,unit,materialUnitCost,supplierName\n" +
      Array.from(
        { length: 605 },
        (_, i) =>
          `"Pipe, ${i}",ft,${i % 3 ? "2.50" : "invalid"},"Supply ""Pro"""\n`,
      ).join("");
    const send = (message: PricingImportRequest) =>
      worker.onmessage?.({
        data: message,
      } as MessageEvent<PricingImportRequest>);
    send({ kind: "parse", csv });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    const result: ReturnType<typeof importPricingCsv> = {
      rows: [],
      errors: [],
    };
    let last: PricingImportResponse | undefined;
    for (let i = 0; i < 10; i++) {
      last = worker.postMessage.mock.calls.at(-1)?.[0];
      if (last?.kind !== "chunk") break;
      expect(last.rows.length).toBeLessThanOrEqual(250);
      expect(last.errors.length).toBeLessThanOrEqual(250);
      result.rows.push(...last.rows);
      result.errors.push(...last.errors);
      send({ kind: "next" });
    }
    expect(last).toEqual({ kind: "done" });
    expect(result).toEqual(importPricingCsv(csv));
    send({ kind: "next" });
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toEqual({ kind: "done" });
  });
});
