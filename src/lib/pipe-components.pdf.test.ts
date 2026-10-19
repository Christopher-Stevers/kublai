// @vitest-environment node
import { expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument, AnnotationMode } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  pipeLineworkFromOperators,
  pipeLabelsFromTextItems,
} from "./pdf-pipe-extraction";
import { buildPipeSystemIndex, selectPipeSystem } from "./pipe-system";
import { analyzePipeComponents } from "./pipe-components";

it("extracts a real vector PDF through PDF.js and recognizes its installed tagged valve", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1000, 1000]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawLine({
    start: { x: 100, y: 500 },
    end: { x: 900, y: 500 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  page.drawSvgPath("M 498 498 L 502 502 L 502 498 L 498 502 Z", {
    x: 0,
    y: 1000,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  page.drawText("DCW", { x: 200, y: 502, size: 7, font });
  page.drawText('2" BALL VALVE', { x: 490, y: 508, size: 4, font });
  const task = getDocument({
    data: await doc.save(),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  try {
    const parsedPage = await pdf.getPage(1),
      viewport = parsedPage.getViewport({ scale: 1 });
    const project = (x: number, y: number) => {
      const [px, py] = viewport.convertToViewportPoint(x, y);
      return { x: px! / 1000, y: py! / 1000 };
    };
    const operators = await parsedPage.getOperatorList({
      annotationMode: AnnotationMode.DISABLE,
    });
    const text = await parsedPage.getTextContent();
    const geometry = pipeLineworkFromOperators(
      operators.fnArray,
      operators.argsArray,
      project,
      { aspect: 1 },
    );
    const labels = pipeLabelsFromTextItems(text.items, project, { aspect: 1 });
    const linework = {
      ...geometry,
      labels: labels.labels,
      texts: labels.texts,
    };
    expect(linework.symbols?.some((symbol) => symbol.closed)).toBe(true);
    expect(linework.texts.some((t) => t.text.includes("BALL VALVE"))).toBe(
      true,
    );
    const selection = selectPipeSystem(
      buildPipeSystemIndex(linework),
      { x: 0.2, y: 0.5 },
      0.01,
    );
    expect(selection.system).toBe("DCW");
    const result = analyzePipeComponents(linework, selection);
    expect(
      result.candidates.find((c) => c.name === "Ball valve"),
    ).toMatchObject({
      source: "tag",
      size: '2"',
      kind: "valve",
      point: { x: 0.5, y: 0.5 },
    });
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.8);
  } finally {
    await task.destroy();
  }
});
