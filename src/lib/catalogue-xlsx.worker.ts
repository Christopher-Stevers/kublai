/// <reference lib="webworker" />
import {
  buildCatalogueWorkbook,
  parseCatalogueWorkbook,
  type CatalogueImportRow,
} from "./catalogue-xlsx-core";
import {
  CATALOGUE_WORKBOOK_BATCH,
  type CatalogueWorkbookRequest,
  type CatalogueWorkbookResponse,
} from "./catalogue-xlsx-protocol";
let imported: CatalogueImportRow[] | undefined;
let exported: unknown[] | undefined;
let offset = 0;
const send = (
  message: CatalogueWorkbookResponse,
  transfer: Transferable[] = [],
) => self.postMessage(message, { transfer });
function next() {
  if (!imported) return;
  if (offset >= imported.length) {
    imported = undefined;
    send({ kind: "done" });
    return;
  }
  const rows = imported.slice(offset, offset + CATALOGUE_WORKBOOK_BATCH);
  offset += rows.length;
  send({ kind: "rows", rows, completed: offset, total: imported.length });
}
self.onmessage = async ({ data }: MessageEvent<CatalogueWorkbookRequest>) => {
  try {
    if (data.kind === "read") {
      imported = await parseCatalogueWorkbook(await data.file.arrayBuffer());
      offset = 0;
      next();
    } else if (data.kind === "next") next();
    else if (data.kind === "write-start") {
      exported = [];
      send({ kind: "ready" });
    } else if (data.kind === "write-rows" && exported) {
      if (data.rows.length > CATALOGUE_WORKBOOK_BATCH)
        throw Error("Invalid workbook batch.");
      exported.push(...data.rows);
      send({ kind: "ready" });
    } else if (data.kind === "write-finish" && exported) {
      const buffer = await buildCatalogueWorkbook(exported);
      exported = undefined;
      send({ kind: "buffer", buffer }, [buffer]);
    }
  } catch (error) {
    imported = exported = undefined;
    send({
      kind: "failure",
      message:
        error instanceof Error
          ? error.message
          : "The workbook could not be processed.",
    });
  }
};
