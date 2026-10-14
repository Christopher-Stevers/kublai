"use client";

import { loadPdfDocument, loadPdfJs } from "./pdf-client";
import type { PipeLinework } from "./pipe-system";
import { PIPE_OPS, safeLayer, pipeLineworkFromOperators, pipeLabelsFromTextItems } from "./pdf-pipe-extraction";
export * from "./pdf-pipe-extraction";

/** No additional parsed-page cache: pdf-client owns logout/identity eviction. */
export async function loadPipeLinework(source: {
  url: string;
  page: number;
  signal?: AbortSignal;
}): Promise<PipeLinework> {
  const checkAbort = () => {
    if (source.signal?.aborted)
      throw new DOMException(
        "The pipe drawing request was cancelled.",
        "AbortError",
      );
  };
  checkAbort();
  // Upload-scoped PDFs are immutable. Their saved geometry has the same
  // authorization and revision lifetime as the PDF, with no second PDF parse.
  const uuid = "[0-9a-f-]{36}";
  if (new RegExp(`^/api/job-rooms/files/${uuid}/${uuid}/plan\\.pdf$`, "i").test(source.url) && Number.isSafeInteger(source.page) && source.page > 0) {
    const savedUrl = source.url.replace(/plan\.pdf$/, `pipes-${source.page}-v1.json`);
    const response = await fetch(savedUrl, { signal: source.signal, credentials: "same-origin" }).catch(() => null);
    checkAbort();
    if (response?.status === 401 || response?.status === 403) throw new Error("Drawing access denied");
    if (response?.ok) {
      const saved = await response.json().catch(() => null) as { version?: number; linework?: PipeLinework } | null;
      if (saved?.version === 1 && saved.linework && Array.isArray(saved.linework.segments) && Array.isArray(saved.linework.labels) && Number.isFinite(saved.linework.aspect) && saved.linework.aspect > 0) {
        checkAbort();
        return saved.linework;
      }
    }
  }
  const pdfjs = await loadPdfJs();
  if (
    pdfjs.OPS.constructPath !== PIPE_OPS.constructPath ||
    pdfjs.OPS.setStrokeRGBColor !== PIPE_OPS.setStrokeRGBColor
  )
    throw new Error(
      "This PDF viewer uses operator numbers the pipe tool does not know.",
    );
  const document = await loadPdfDocument(source.url);
  checkAbort();
  const page = await document.getPage(source.page);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width || 1,
    height = viewport.height || 1;
  const toSheet = (x: number, y: number) => {
    const converted = viewport.convertToViewportPoint(x, y) as [number, number];
    return { x: converted[0] / width, y: converted[1] / height };
  };
  const [operators, text, optional] = await Promise.all([
    page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }),
    page.getTextContent(),
    document.getOptionalContentConfig({ intent: "display" }),
  ]);
  checkAbort();
  const aspect = height / width;
  const linework = pipeLineworkFromOperators(
    operators.fnArray,
    operators.argsArray,
    toSheet,
    {
      aspect,
      resolveOptionalContent: (properties) => {
        const raw = properties as { id?: unknown; type?: unknown } | null;
        const group =
          raw?.type === "OCG" && typeof raw.id === "string"
            ? (optional.getGroup(raw.id) as { name?: unknown } | null)
            : null;
        return {
          name: safeLayer(group?.name),
          visible: Boolean(optional.isVisible(properties)),
        };
      },
    },
  );
  const labels = pipeLabelsFromTextItems(text.items, toSheet, { aspect });
  checkAbort();
  return {
    ...linework,
    labels: labels.labels,
    truncated: linework.truncated || labels.truncated,
  };
}
