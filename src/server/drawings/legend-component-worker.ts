// Runs separately from the web server so a complex PDF cannot block requests.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { saveDrawingPipeLinework } from "./pipe-linework";
const [file, pageText] = process.argv.slice(2);
const number = Number(pageText);
if (!file || !Number.isSafeInteger(number) || number < 1)
  throw Error("Invalid legend source");
const task = getDocument({
  ...SERVER_PDF_RENDER_OPTIONS,
  verbosity: VerbosityLevel.ERRORS,
  data: new Uint8Array(await readFile(file)),
});
try {
  const document = await task.promise;
  const page = await document.getPage(number);
  await saveDrawingPipeLinework(path.dirname(file), document, page);
  page.cleanup();
} finally {
  await task.destroy();
}
