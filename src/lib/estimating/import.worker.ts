/// <reference lib="webworker" />
import { importPricingCsv } from "./csv";
import {
  PRICING_IMPORT_BATCH,
  type PricingImportRequest,
  type PricingImportResponse,
} from "./import-protocol";

let result: ReturnType<typeof importPricingCsv> | undefined;
let offset = 0;
let newRowIds = false;
const send = (message: PricingImportResponse) => self.postMessage(message);
function next() {
  if (!result) return;
  if (offset >= Math.max(result.rows.length, result.errors.length)) {
    result = undefined;
    send({ kind: "done" });
    return;
  }
  const rows = result.rows.slice(offset, offset + PRICING_IMPORT_BATCH);
  send({
    kind: "chunk",
    rows: newRowIds
      ? rows.map((row) => ({ ...row, id: crypto.randomUUID() }))
      : rows,
    errors: result.errors.slice(offset, offset + PRICING_IMPORT_BATCH),
  });
  offset += PRICING_IMPORT_BATCH;
}
self.onmessage = ({ data }: MessageEvent<PricingImportRequest>) => {
  try {
    if (data.kind === "parse") {
      newRowIds = data.newRowIds === true;
      result = importPricingCsv(data.csv);
      offset = 0;
      next();
    } else if (data.kind === "next") next();
  } catch {
    result = undefined;
    send({
      kind: "failure",
      message: "The CSV could not be validated. Try again.",
    });
  }
};
