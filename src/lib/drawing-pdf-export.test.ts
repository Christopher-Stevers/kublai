import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  PDFString,
  PDFHexString,
  PDFArray,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDrawingPackage,
  buildDrawingPdf,
  MAX_DRAWING_PACKAGE_BYTES,
} from "./drawing-pdf-export";
import type { DrawingMarkup } from "./drawing-workspace";

const sourceId = "0391aed4-7773-47ec-9141-09df373ec008";
const otherId = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";
const markup: DrawingMarkup = {
  sourceSheetId: sourceId,
  type: "rect",
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.4 },
  ],
  stroke: "#ff0000",
  width: 2,
};
async function fixture(rotation = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  page.drawRectangle({
    x: 60,
    y: 70,
    width: 120,
    height: 50,
    color: rgb(0, 0, 0),
  });
  page.setCropBox(50, 40, 500, 300);
  page.setRotation(degrees(rotation));
  doc.addPage([100, 100]);
  return doc.save();
}
async function mockSource(rotation = 0) {
  const bytes = await fixture(rotation);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": "application/pdf" },
        }),
    ),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("vector drawing export", () => {
  it("exports a highlight without covering the equipment label and retains its chooser address", async () => {
    await mockSource();
    const link: DrawingMarkup = {
      ...markup,
      type: "link",
      text: "AHU-1",
      stroke: "#facc15",
      linkAppearance: "highlight",
      links: [
        { label: "Manual", url: "https://example.com/manual" },
        { label: "Chat", url: "/dashboard/jobs/abc/chat" },
      ],
    };
    const chooser =
      "https://app.test/dashboard/jobs/abc/drawings?drawingSet=folder&drawingSheet=sheet&drawingLink=link";
    const resolver = vi.fn(() => chooser);
    const result = await PDFDocument.load(
      await buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        markups: [link],
        markupLinkUrl: resolver,
      }),
    );
    expect(resolver).toHaveBeenCalledWith(link);
    const annot = result.getPage(0).node.Annots()!.lookup(0, PDFDict);
    expect(
      annot
        .lookup(PDFName.of("A"), PDFDict)
        .lookup(PDFName.of("URI"), PDFString)
        .decodeText(),
    ).toBe(chooser);
    const contents = result.getPage(0).node.Contents() as PDFArray;
    const operators = Array.from({ length: contents.size() }, (_, index) =>
      new TextDecoder().decode(
        decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode(),
      ),
    ).join("\n");
    expect(operators).not.toContain("Tj");
    expect(operators).not.toMatch(/\nS\n/);
    expect(operators).toMatch(/\nf\n/);
    const gs = result
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("ExtGState"), PDFDict);
    expect(
      gs
        .values()
        .some(
          (value) =>
            result.context
              .lookup(value, PDFDict)
              .get(PDFName.of("ca"))
              ?.toString() === "0.35",
        ),
    ).toBe(true);
  });
  it("exports a single new URL destination directly", async () => {
    await mockSource();
    const result = await PDFDocument.load(
      await buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        markups: [
          {
            ...markup,
            type: "link",
            links: [{ label: "Manual", url: "https://example.com/manual" }],
          },
        ],
      }),
    );
    const annot = result.getPage(0).node.Annots()!.lookup(0, PDFDict);
    expect(
      annot
        .lookup(PDFName.of("A"), PDFDict)
        .lookup(PDFName.of("URI"), PDFString)
        .decodeText(),
    ).toBe("https://example.com/manual");
  });
  it("exports saved branches as independent edges rather than a connecting polyline", async () => {
    await mockSource();
    const result = await PDFDocument.load(
      await buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        markups: [
          {
            ...markup,
            type: "dimension",
            unit: "ft",
            scale: 100,
            points: [
              { x: 0.2, y: 0.5 },
              { x: 0.8, y: 0.5 },
              { x: 0.5, y: 0.5 },
              { x: 0.5, y: 0.2 },
            ],
            parents: [null, 2, 0, 2],
          },
        ],
      }),
    );
    const contents = result.getPage(0).node.Contents() as PDFArray;
    const operators = Array.from({ length: contents.size() }, (_, index) =>
      new TextDecoder().decode(
        decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode(),
      ),
    ).join("\n");
    expect(operators).toContain("500 300 m\n800 300 l");
    expect(operators).toContain("200 300 m\n500 300 l");
    expect(operators).toContain("500 300 m\n500 120 l");
    expect(operators).not.toContain("800 300 m\n500 120 l");
    expect(operators).toContain("<3930B0> Tj"); // 90° remains an angle label in the PDF.
    expect(operators).toMatch(/ c\n/); // The angle arc is exported as vector curves.
  });

  it("assembles every package page in snapshot order and fetches shared sources once", async () => {
    await mockSource();
    const result = await PDFDocument.load(
      await buildDrawingPackage({
        title: "Issued drawings",
        sheets: [2, 1, 2].map((pageNumber) => ({
          pdfUrl: "/source.pdf",
          pageNumber,
        })),
      }),
    );
    expect(result.getPageCount()).toBe(3);
    expect(result.getPages().map((page) => page.getSize())).toEqual([
      { width: 100, height: 100 },
      { width: 500, height: 300 },
      { width: 100, height: 100 },
    ]);
    expect(result.getTitle()).toBe("Issued drawings");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds package page counts and total source bytes before fetching oversized bodies", async () => {
    await mockSource();
    await expect(buildDrawingPackage({ sheets: [] })).rejects.toThrow(
      /1 and 100/,
    );
    await expect(
      buildDrawingPackage({
        sheets: Array.from({ length: 101 }, () => ({
          pdfUrl: "/source.pdf",
          pageNumber: 1,
        })),
      }),
    ).rejects.toThrow(/1 and 100/);
    expect(fetch).not.toHaveBeenCalled();
    const response = new Response(new Uint8Array([1]), {
      headers: { "Content-Length": String(MAX_DRAWING_PACKAGE_BYTES + 1) },
    });
    const read = vi.spyOn(response, "arrayBuffer");
    vi.mocked(fetch).mockResolvedValueOnce(response);
    await expect(
      buildDrawingPackage({
        sheets: [{ pdfUrl: "/large.pdf", pageNumber: 1 }],
      }),
    ).rejects.toThrow(/size limit/);
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves safe native links but discards executable or external-file actions", async () => {
    const source = await PDFDocument.load(await fixture(90));
    const page = source.getPage(0);
    page.node.set(
      PDFName.of("Annots"),
      source.context.obj([
        source.context.register(
          source.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [60, 70, 180, 120],
            A: { S: "URI", URI: PDFString.of("https://example.com/spec") },
          }),
        ),
        source.context.register(
          source.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [60, 70, 180, 120],
            A: { S: "JavaScript", JS: PDFString.of("alert(1)") },
          }),
        ),
        source.context.register(
          source.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [60, 70, 180, 120],
            A: { S: "URI", URI: PDFString.of("javascript:alert(1)") },
          }),
        ),
      ]),
    );
    const bytes = await source.save();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes))),
    );
    const output = await PDFDocument.load(
      await buildDrawingPdf({ pdfUrl: "/source.pdf", pageNumber: 1 }),
    );
    const annotations = output.getPage(0).node.Annots()!;
    expect(annotations.size()).toBe(1);
    const annotation = annotations.lookup(0, PDFDict);
    const action = annotation.lookup(PDFName.of("A"), PDFDict);
    expect(action.lookup(PDFName.of("URI"), PDFHexString).decodeText()).toBe(
      "https://example.com/spec",
    );
    expect(annotation.get(PDFName.of("Rect"))?.toString()).toBe(
      "[ 30 370 80 490 ]",
    );
  });

  it.each([0, 90, 180, 270])(
    "extracts only the requested page and preserves vector content at rotation %s",
    async (rotation) => {
      await mockSource(rotation);
      const bytes = await buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        sourceSheetId: sourceId,
        markups: [markup],
      });
      const result = await PDFDocument.load(bytes);
      expect(result.getPageCount()).toBe(1);
      const page = result.getPage(0);
      expect(page.getSize()).toEqual(
        rotation % 180
          ? { width: 300, height: 500 }
          : { width: 500, height: 300 },
      );
      expect(page.getRotation().angle).toBe(0);
      const xobjects = page.node
        .Resources()!
        .lookup(PDFName.of("XObject"), PDFDict);
      expect(xobjects.keys()).toHaveLength(1);
      const source = result.context.lookup(xobjects.values()[0]);
      if (!(source instanceof PDFRawStream))
        throw new Error("Expected embedded vector content");
      expect(source.dict.get(PDFName.of("Subtype"))?.toString()).toBe("/Form");
    },
  );

  it("exports every markup primitive and binds annotations to the selected source revision", async () => {
    await mockSource();
    const types: DrawingMarkup["type"][] = [
      "freehand",
      "highlight",
      "text",
      "callout",
      "cloud",
      "polycloud",
      "rect",
      "ellipse",
      "polyline",
      "line",
      "arrow",
      "dimension",
      "area",
      "angle",
      "count",
      "link",
    ];
    const markups = types.map((type) => ({
      ...markup,
      type,
      points: [...markup.points, { x: 0.6, y: 0.3 }],
      text: "Field note",
      scale: 100,
      unit: "ft" as const,
      href:
        type === "link" ? "https://example.com/specification.pdf" : undefined,
    }));
    const result = await PDFDocument.load(
      await buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        sourceSheetId: sourceId,
        markups: [
          ...markups,
          {
            ...markup,
            sourceSheetId: otherId,
            type: "link",
            href: "https://example.com/other.pdf",
          },
        ],
      }),
    );
    expect(result.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it("prints persisted text size in the same 1000-unit system as the SVG editor", async () => {
    await mockSource();
    for (const [fontSize, expectedSize] of [
      [undefined, 9],
      [48, 24],
    ] as const) {
      const output = await PDFDocument.load(
        await buildDrawingPdf({
          pdfUrl: "/source.pdf",
          pageNumber: 1,
          markups: [
            {
              ...markup,
              type: "text",
              text: "Resized note",
              points: [markup.points[0]!],
              fontSize,
            },
          ],
        }),
      );
      const contents = output.getPage(0).node.Contents();
      const streams =
        contents instanceof PDFArray
          ? Array.from({ length: contents.size() }, (_, index) =>
              contents.lookup(index, PDFRawStream),
            )
          : contents instanceof PDFRawStream
            ? [contents]
            : [];
      const operators = streams
        .map((stream) =>
          new TextDecoder().decode(decodePDFRawStream(stream).decode()),
        )
        .join("\n");
      expect(operators).toMatch(new RegExp(`\\s${expectedSize} Tf\\b`));
    }
  });

  it("uses the account-scoped offline resolver and refuses missing pages or failed downloads", async () => {
    await mockSource();
    const resolveSource = vi.fn(async () => "blob:account-private-pdf");
    await buildDrawingPdf({
      pdfUrl: "/source.pdf",
      pageNumber: 2,
      resolveSource,
    });
    expect(resolveSource).toHaveBeenCalledWith("/source.pdf");
    expect(fetch).toHaveBeenCalledWith(
      "blob:account-private-pdf",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    await expect(
      buildDrawingPdf({ pdfUrl: "/source.pdf", pageNumber: 3 }),
    ).rejects.toThrow(/no longer available/);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(
      buildDrawingPdf({ pdfUrl: "/source.pdf", pageNumber: 1 }),
    ).rejects.toThrow(/401/);
  });

  it("does not start downloading after cancellation", async () => {
    await mockSource();
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildDrawingPdf({
        pdfUrl: "/source.pdf",
        pageNumber: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
