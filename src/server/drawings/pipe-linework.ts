import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { AnnotationMode, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pipeLabelsFromTextItems, pipeLineworkFromOperators, safeLayer } from "~/lib/pdf-pipe-extraction";
const compress = promisify(gzip);

/** Persist page coordinates, styles and original layer names beside the immutable PDF. */
export async function saveDrawingPipeLinework(dest: string, document: PDFDocumentProxy, page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 });
  const aspect = viewport.height / viewport.width;
  const toSheet = (x: number, y: number) => {
    const [px, py] = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: px / viewport.width, y: py / viewport.height };
  };
  const [operators, text, optional] = await Promise.all([
    page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }),
    page.getTextContent(),
    document.getOptionalContentConfig({ intent: "display" }),
  ]);
  const linework = pipeLineworkFromOperators(operators.fnArray, operators.argsArray, toSheet, {
    aspect,
    resolveOptionalContent: (properties) => {
      const raw = properties as { id?: string; type?: string } | null;
      const group = raw?.type === "OCG" && raw.id ? optional.getGroup(raw.id) as { name?: unknown } | null : null;
      // Keep systems even if their PDF layer was switched off when exported.
      return { name: safeLayer(group?.name), visible: true };
    },
  });
  const labels = pipeLabelsFromTextItems(text.items, toSheet, { aspect });
  const data = { version: 1, linework: { ...linework, labels: labels.labels, truncated: linework.truncated || labels.truncated } };
  const filename = path.join(dest, `pipes-${page.pageNumber}-v1.json`);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  // The file route serves these with Content-Encoding: gzip. Keep the full
  // coordinates while avoiding large repeated JSON keys on mobile downloads.
  await writeFile(temporary, await compress(JSON.stringify(data)));
  await rename(temporary, filename);
  return data.linework;
}
