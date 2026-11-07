// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCatalogueWorkbook,
  normalizeCatalogueImportRows,
} from "./catalogue-xlsx-core";
import type {
  CatalogueWorkbookRequest,
  CatalogueWorkbookResponse,
} from "./catalogue-xlsx-protocol";
type WorkerScope = {
  onmessage: (event: { data: CatalogueWorkbookRequest }) => Promise<void>;
  postMessage: ReturnType<
    typeof vi.fn<
      (
        message: CatalogueWorkbookResponse,
        options?: StructuredSerializeOptions,
      ) => void
    >
  >;
};
let scope: WorkerScope;
beforeEach(async () => {
  vi.resetModules();
  scope = {
    onmessage: vi.fn<WorkerScope["onmessage"]>(),
    postMessage: vi.fn(),
  };
  vi.stubGlobal("self", scope);
  await import("./catalogue-xlsx.worker");
});
afterEach(() => vi.unstubAllGlobals());
const send = (data: CatalogueWorkbookRequest) => scope.onmessage({ data });
describe("catalogue workbook worker", () => {
  it("returns the exact normalized rows in acknowledged batches", async () => {
    const rows = Array.from({ length: 601 }, (_, i) => ({
      catalog: "Plumbing",
      partId: `part-${i}`,
      displayName: `Part ${i}`,
      description: "",
      aliases: "½ inch",
      isActive: i % 5 !== 0,
    }));
    const buffer = await buildCatalogueWorkbook(rows);
    await send({ kind: "read", file: new File([buffer], "parts.xlsx") });
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) await send({ kind: "next" });
    const messages = scope.postMessage.mock.calls.map((call) => call[0]);
    const chunks = messages.filter((message) => message.kind === "rows");
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([250, 250, 101]);
    expect(chunks.flatMap((chunk) => chunk.rows)).toEqual(
      normalizeCatalogueImportRows(rows),
    );
    expect(messages.at(-1)).toEqual({ kind: "done" });
  });
  it("writes a transferable workbook with the original row contents", async () => {
    const rows = [
      {
        catalog: "Tools",
        displayName: "Drill",
        partId: "one",
        isActive: false,
      },
    ];
    await send({ kind: "write-start" });
    await send({ kind: "write-rows", rows });
    await send({ kind: "write-finish" });
    const last = scope.postMessage.mock.calls.at(-1)!;
    const message = last[0] as Extract<
      CatalogueWorkbookResponse,
      { kind: "buffer" }
    >;
    expect(message.kind).toBe("buffer");
    expect(last[1]).toEqual({ transfer: [message.buffer] });
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(message.buffer, { type: "array" });
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Parts!)).toEqual(rows);
  });
  it("reports failed file reads without emitting import rows", async () => {
    const file = new File(["fixture"], "parts.xlsx");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(
      new Error("Cannot read workbook."),
    );
    await send({
      kind: "read",
      file,
    });
    expect(scope.postMessage.mock.calls.map((call) => call[0])).toEqual([
      { kind: "failure", message: "Cannot read workbook." },
    ]);
  });
});
