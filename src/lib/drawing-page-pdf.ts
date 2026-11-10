/**
 * A sheet's own small PDF. A drawing set is uploaded as one large `plan.pdf`;
 * the server also keeps each page as a file of its own (see
 * `server/rooms/page-pdfs.ts`). Reading one sheet from its own file is one
 * request and fewer bytes, which is what counts on a weak signal.
 *
 * The set's `plan.pdf` and page number stay the sheet's identity everywhere
 * else: only the bytes come from the page file.
 */
import { hintPdfWhole } from "./pdf-range-source";

export type PdfPageSource = { url: string; page: number };
export type SheetPdfSource = PdfPageSource & {
  /** Set when `url` is the page's own file: where the page sits in the set. */
  original?: PdfPageSource;
  /** Download sizes, for choosing what to load first on a weak signal. */
  pdfBytes?: number;
  imageBytes?: number | null;
};

type Index = { pages: { pdf: number | null; image: number | null }[] };

const PLAN =
  /^(\/api\/job-rooms\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/plan\.pdf$/i;
/** A set whose pages are not split yet is asked about again after this; a
 * large set takes the server some seconds on its first open. */
const RETRY_MS = 10_000;
const TIMEOUT_MS = 8_000;
/** A page file this large is read in ranges like the set itself. */
const WHOLE_BYTES = 8 * 1024 * 1024;

const indexes = new Map<string, { at: number; found: Promise<Index | null> }>();

function readIndex(base: string): Promise<Index | null> {
  const cached = indexes.get(base);
  if (cached) return cached.found;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const entry = {
    at: Date.now(),
    found: fetch(`${base}/pages/index.json`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const index = (await response.json()) as Partial<Index> | null;
        return Array.isArray(index?.pages) ? (index as Index) : null;
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer)),
  };
  indexes.set(base, entry);
  void entry.found.then((index) => {
    if (index) return;
    setTimeout(
      () => indexes.get(base) === entry && indexes.delete(base),
      RETRY_MS,
    );
  });
  while (indexes.size > 12) indexes.delete(indexes.keys().next().value!);
  return entry.found;
}

/** True when this source may have a page file, so the answer needs a request. */
export function mayHavePagePdf(source: PdfPageSource | null | undefined) {
  return Boolean(
    source && typeof fetch === "function" && PLAN.test(source.url),
  );
}

/** Where to read this sheet's PDF from. Never rejects. */
export async function sheetPdfSource(
  source: PdfPageSource,
): Promise<SheetPdfSource> {
  const base = mayHavePagePdf(source) ? PLAN.exec(source.url)?.[1] : null;
  if (!base) return source;
  const entry = (await readIndex(base))?.pages[source.page - 1];
  const bytes = entry?.pdf;
  if (typeof bytes !== "number" || !(bytes > 0)) return source;
  const url = `${base}/pages/${source.page}.pdf`;
  if (bytes <= WHOLE_BYTES) hintPdfWhole(url, bytes);
  return {
    url,
    page: 1,
    original: source,
    pdfBytes: bytes,
    imageBytes: typeof entry?.image === "number" ? entry.image : null,
  };
}

export function clearSheetPdfSources() {
  indexes.clear();
}
