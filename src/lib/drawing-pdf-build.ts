import { pdfBytes, MAX_DRAWING_PACKAGE_BYTES } from "./drawing-pdf-bytes";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFDict,
  PDFArray,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { DrawingMarkup } from "./drawing-workspace";
import { drawingLinkSchema, drawingMarkupSchema } from "./drawing-workspace";
import {
  drawingBounds,
  drawingCloudPath,
  drawingFontSize,
  drawingMeasurement,
  drawingLinePath,
  drawingMarkupEdges,
} from "./drawing-annotation-geometry";
import type { SheetScale } from "./sheet-measure";
import { savedMeasureAngleArcs } from "./saved-measure-run";
import { drawingMarkupLinks } from "./drawing-links";

export type DrawingPdfExportOptions = {
  pdfUrl: string;
  /** One-based original PDF page. */
  pageNumber: number;
  markups?: DrawingMarkup[];
  sourceSheetId?: string;
  sharedScale?: SheetScale | null;
  title?: string;
  signal?: AbortSignal;
  /** Returns an account-scoped cached URL or the authenticated original. */
  resolveSource?: (url: string) => Promise<string>;
  /** Resolves sheet destinations and multi-link chooser addresses for saved markups. */
  markupLinkUrl?: (markup: DrawingMarkup) => string | null;
};

function color(value: string | undefined) {
  if (!value || value === "none") return undefined;
  return rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
}
function alpha(value: string | undefined) {
  return value?.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1;
}

/** Unicode text alone may be rasterized; the original drawing and markup paths stay vectors. */
async function label(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  stroke: string,
  opacity: number,
) {
  try {
    font.encodeText(text);
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: color(stroke),
      opacity,
      lineHeight: size * 1.25,
    });
  } catch (error) {
    if (typeof document === "undefined") throw error;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This device cannot export the note's text.");
    const scale = Math.min(3, 96 / Math.max(1, size));
    context.font = `${size * scale}px sans-serif`;
    const lines = text.split("\n");
    canvas.width = Math.max(
      1,
      Math.ceil(
        Math.max(...lines.map((line) => context.measureText(line).width)) +
          size * scale,
      ),
    );
    canvas.height = Math.max(1, Math.ceil(lines.length * size * scale * 1.3));
    if (
      canvas.width > 8192 ||
      canvas.height > 4096 ||
      canvas.width * canvas.height > 8 * 1024 * 1024
    )
      throw new Error(
        "This note is too large to export. Split it into smaller notes.",
      );
    context.font = `${size * scale}px sans-serif`;
    context.fillStyle = stroke;
    context.textBaseline = "alphabetic";
    lines.forEach((line, index) =>
      context.fillText(line, 0, size * scale + index * size * scale * 1.3),
    );
    const image = await doc.embedPng(canvas.toDataURL("image/png"));
    page.drawImage(image, {
      x,
      y: y - canvas.height / scale + size,
      width: canvas.width / scale,
      height: canvas.height / scale,
      opacity,
    });
  }
}

async function drawMarkup(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  data: DrawingMarkup,
  sharedScale?: SheetScale | null,
  linkUrl?: string | null,
) {
  const width = page.getWidth(),
    height = page.getHeight(),
    aspect = height / width,
    factor = width / 1000;
  const points = data.points.map((point) => ({
    x: point.x * 1000,
    y: point.y * 1000 * aspect,
  }));
  const first = points[0]!,
    last = points.at(-1)!,
    bounds = drawingBounds(points);
  const linkHighlight =
    data.type === "link" && data.linkAppearance === "highlight";
  const opacity =
    data.opacity ?? (data.type === "highlight" || linkHighlight ? 0.35 : 1);
  const fill = linkHighlight
    ? data.fill && data.fill !== "none"
      ? data.fill
      : data.stroke === "none"
        ? "#facc15"
        : data.stroke
    : data.fill;
  const style = {
    x: 0,
    y: height,
    scale: factor,
    borderColor: linkHighlight ? undefined : color(data.stroke),
    borderWidth: linkHighlight ? 0 : data.width,
    borderOpacity: opacity * alpha(data.stroke),
    color: color(fill),
    opacity: opacity * alpha(fill),
  };
  const line = data.parents
    ? drawingLinePath(data, aspect)
    : `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  const textSize = drawingFontSize(data) * factor;
  const text = (value: string, x: number, y: number) =>
    label(
      doc,
      page,
      font,
      value,
      x * factor,
      height - y * factor,
      textSize,
      data.stroke,
      opacity,
    );
  const arrow = (at: typeof first, from: typeof first) => {
    const angle = Math.atan2(at.y - from.y, at.x - from.x),
      size = Math.max(12, data.width * 4);
    page.drawSvgPath(
      `M ${at.x - Math.cos(angle - 0.5) * size} ${at.y - Math.sin(angle - 0.5) * size} L ${at.x} ${at.y} L ${at.x - Math.cos(angle + 0.5) * size} ${at.y - Math.sin(angle + 0.5) * size}`,
      { ...style, color: undefined },
    );
  };
  switch (data.type) {
    case "rect":
    case "link":
      page.drawSvgPath(
        `M ${bounds.left} ${bounds.top} H ${bounds.right} V ${bounds.bottom} H ${bounds.left} Z`,
        style,
      );
      break;
    case "ellipse":
      page.drawEllipse({
        x: ((bounds.left + bounds.right) / 2) * factor,
        y: height - ((bounds.top + bounds.bottom) / 2) * factor,
        xScale: ((bounds.right - bounds.left) / 2) * factor,
        yScale: ((bounds.bottom - bounds.top) / 2) * factor,
        borderWidth: data.width * factor,
        borderColor: color(data.stroke),
        color: color(data.fill),
        opacity: opacity * alpha(data.fill),
        borderOpacity: opacity * alpha(data.stroke),
      });
      break;
    case "cloud": {
      const box = drawingBounds(data.points);
      page.drawSvgPath(
        drawingCloudPath(
          [
            { x: box.left, y: box.top },
            { x: box.right, y: box.top },
            { x: box.right, y: box.bottom },
            { x: box.left, y: box.bottom },
          ],
          aspect,
        ),
        style,
      );
      break;
    }
    case "polycloud":
      page.drawSvgPath(drawingCloudPath(data.points, aspect), style);
      break;
    case "area":
      page.drawSvgPath(`${line} Z`, {
        ...style,
        color: color(
          data.fill && data.fill !== "none" ? data.fill : data.stroke,
        ),
        opacity:
          opacity *
          (data.fill && data.fill !== "none" ? alpha(data.fill) : 0.13),
      });
      break;
    case "text":
      await text(data.text?.length ? data.text : "Text", first.x, first.y);
      break;
    case "count":
      for (const [index, point] of points.entries()) {
        page.drawCircle({
          x: point.x * factor,
          y: height - point.y * factor,
          size: (12 + data.width) * factor,
          color: rgb(1, 1, 1),
          borderColor: color(data.stroke),
          borderWidth: data.width * factor,
          opacity,
          borderOpacity: opacity,
        });
        await label(
          doc,
          page,
          font,
          String(index + 1),
          (point.x - 4) * factor,
          height - (point.y + 5) * factor,
          15 * factor,
          data.stroke,
          opacity,
        );
      }
      break;
    default:
      page.drawSvgPath(line, {
        ...style,
        color: undefined,
        borderWidth:
          data.type === "highlight" ? Math.max(12, data.width * 5) : data.width,
      });
  }
  if (data.type === "arrow" || (data.type === "dimension" && !data.parents))
    arrow(last, first);
  if (data.type === "callout" || (data.type === "dimension" && !data.parents))
    arrow(first, last);
  if (data.type === "callout")
    await text(data.text?.length ? data.text : "Note", last.x + 8, last.y - 8);
  if (data.type === "link") {
    if (!linkHighlight)
      await text(
        data.text?.length
          ? data.text
          : data.targetSheetId
            ? "Sheet link"
            : "Link",
        bounds.left + 5,
        bounds.top + textSize / factor,
      );
    const destinations = drawingMarkupLinks(data);
    const href =
      linkUrl ?? (destinations.length === 1 ? destinations[0]?.url : null);
    if (href && drawingLinkSchema.safeParse(href).success) {
      const link = doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [
          bounds.left * factor,
          height - bounds.bottom * factor,
          bounds.right * factor,
          height - bounds.top * factor,
        ],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
      });
      page.node.addAnnot(doc.context.register(link));
    }
  }
  const measurement = drawingMeasurement(data, aspect, sharedScale);
  if (data.type === "dimension" && data.parents) {
    for (const { from, to } of drawingMarkupEdges(data)) {
      const segmentLabel = drawingMeasurement(
        {
          ...data,
          parents: undefined,
          points: [data.points[from]!, data.points[to]!],
        },
        aspect,
        sharedScale,
      );
      if (segmentLabel)
        await text(
          segmentLabel,
          (points[from]!.x + points[to]!.x) / 2,
          (points[from]!.y + points[to]!.y) / 2 - 8,
        );
    }
    for (const arc of savedMeasureAngleArcs(data, aspect)) {
      page.drawSvgPath(arc.path, { ...style, color: undefined });
      if (arc.referenceEnd)
        page.drawSvgPath(
          `M ${arc.vertex.x} ${arc.vertex.y} L ${arc.referenceEnd.x} ${arc.referenceEnd.y}`,
          { ...style, color: undefined, borderDashArray: [3, 3] },
        );
      const size = 13 * factor;
      await label(
        doc,
        page,
        font,
        arc.text,
        arc.label.x * factor - font.widthOfTextAtSize(arc.text, size) / 2,
        height - arc.label.y * factor - size * 0.35,
        size,
        data.stroke,
        opacity,
      );
    }
  }
  if (measurement && (!data.parents || drawingMarkupEdges(data).length > 1))
    await text(measurement, (bounds.left + bounds.right) / 2, bounds.top - 8);
}

/** Re-embeds the source page as vector PDF content and normalizes its display rotation. */
async function appendDrawingPage(
  output: PDFDocument,
  input: PDFDocument,
  options: DrawingPdfExportOptions,
) {
  if (
    !Number.isInteger(options.pageNumber) ||
    options.pageNumber < 1 ||
    options.pageNumber > input.getPageCount()
  )
    throw new Error("This drawing page is no longer available.");
  const source = input.getPage(options.pageNumber - 1);
  const media = source.getMediaBox(),
    crop = source.getCropBox();
  const left = Math.max(media.x, crop.x),
    bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width),
    top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right <= left || top <= bottom)
    throw new Error("The drawing has an invalid page boundary.");
  const rawUnit =
    source.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() ?? 1;
  const unit = rawUnit > 0 && Number.isFinite(rawUnit) ? rawUnit : 1;
  const width = (right - left) * unit,
    height = (top - bottom) * unit;
  const rotation = ((source.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error("This drawing has an unsupported page rotation.");
  const page = output.addPage(
    rotation === 90 || rotation === 270 ? [height, width] : [width, height],
  );
  if (source.node.Contents()) {
    const embedded = await output.embedPage(source, {
      left,
      bottom,
      right,
      top,
    });
    page.drawPage(embedded, {
      width,
      height,
      x: rotation === 180 ? width : rotation === 270 ? height : 0,
      y: rotation === 90 ? width : rotation === 180 ? height : 0,
      rotate: degrees(-rotation),
    });
  }
  // Preserve safe native URI links. Never carry JavaScript, launch/file actions
  // or source-document destinations into the exported document.
  const annotations = source.node.Annots();
  for (let i = 0; i < Math.min(1000, annotations?.size() ?? 0); i++) {
    try {
      const annotation = annotations!.lookup(i, PDFDict);
      if (annotation.get(PDFName.of("Subtype"))?.toString() !== "/Link")
        continue;
      const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action?.get(PDFName.of("S"))?.toString() !== "/URI") continue;
      const raw = action.lookup(PDFName.of("URI"));
      if (!(raw instanceof PDFString) && !(raw instanceof PDFHexString))
        continue;
      const uri = raw.decodeText();
      if (!drawingLinkSchema.safeParse(uri).success) continue;
      const rect = annotation.lookup(PDFName.of("Rect"), PDFArray);
      if (rect.size() !== 4) continue;
      const values = Array.from({ length: 4 }, (_, index) =>
        rect.lookup(index, PDFNumber).asNumber(),
      );
      if (!values.every(Number.isFinite)) continue;
      const transform = (x: number, y: number) => {
        const px = (x - left) * unit,
          py = (y - bottom) * unit;
        return rotation === 90
          ? [py, width - px]
          : rotation === 180
            ? [width - px, height - py]
            : rotation === 270
              ? [height - py, px]
              : [px, py];
      };
      const corners = [
        transform(values[0]!, values[1]!),
        transform(values[2]!, values[3]!),
      ];
      const x1 = Math.max(0, Math.min(...corners.map((point) => point[0]!))),
        y1 = Math.max(0, Math.min(...corners.map((point) => point[1]!)));
      const x2 = Math.min(
          page.getWidth(),
          Math.max(...corners.map((point) => point[0]!)),
        ),
        y2 = Math.min(
          page.getHeight(),
          Math.max(...corners.map((point) => point[1]!)),
        );
      if (x2 <= x1 || y2 <= y1) continue;
      page.node.addAnnot(
        output.context.register(
          output.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [x1, y1, x2, y2],
            Border: [0, 0, 0],
            A: { Type: "Action", S: "URI", URI: PDFHexString.fromText(uri) },
          }),
        ),
      );
    } catch {
      /* A damaged source link must not prevent drawing export. */
    }
  }
  const font = await output.embedFont(StandardFonts.Helvetica);
  for (const raw of options.markups ?? []) {
    options.signal?.throwIfAborted();
    const markup = drawingMarkupSchema.parse(raw);
    if (options.sourceSheetId && markup.sourceSheetId !== options.sourceSheetId)
      continue;
    await drawMarkup(
      output,
      page,
      font,
      markup,
      options.sharedScale,
      options.markupLinkUrl?.(raw),
    );
  }
  options.signal?.throwIfAborted();
}

export async function buildDrawingPdf(
  options: DrawingPdfExportOptions,
): Promise<Uint8Array> {
  const input = await PDFDocument.load(
    await pdfBytes(options.pdfUrl, options.signal, options.resolveSource),
  );
  const output = await PDFDocument.create();
  await appendDrawingPage(output, input, options);
  output.setTitle(options.title ?? "ForemanHQ drawing");
  return output.save();
}

export type DrawingPdfPackageOptions = {
  sheets: DrawingPdfExportOptions[];
  title?: string;
  signal?: AbortSignal;
  resolveSource?: DrawingPdfExportOptions["resolveSource"];
};
export { MAX_DRAWING_PACKAGE_BYTES } from "./drawing-pdf-bytes";
export async function buildDrawingPackage(
  options: DrawingPdfPackageOptions,
): Promise<Uint8Array> {
  if (!options.sheets.length || options.sheets.length > 100)
    throw new Error("Select between 1 and 100 sheets for a PDF package.");
  const output = await PDFDocument.create(),
    inputs = new Map<string, PDFDocument>();
  let totalBytes = 0;
  for (const sheet of options.sheets) {
    options.signal?.throwIfAborted();
    let input = inputs.get(sheet.pdfUrl);
    if (!input) {
      const bytes = await pdfBytes(
        sheet.pdfUrl,
        options.signal,
        options.resolveSource,
        MAX_DRAWING_PACKAGE_BYTES - totalBytes,
      );
      totalBytes += bytes.byteLength;
      input = await PDFDocument.load(bytes);
      inputs.set(sheet.pdfUrl, input);
    }
    await appendDrawingPage(output, input, {
      ...sheet,
      signal: options.signal,
    });
  }
  output.setTitle(options.title ?? "ForemanHQ drawing package");
  options.signal?.throwIfAborted();
  return output.save();
}
