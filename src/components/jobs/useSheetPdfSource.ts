"use client";

import { useEffect, useState } from "react";
import {
  mayHavePagePdf,
  sheetPdfSource,
  type PdfPageSource,
  type SheetPdfSource,
} from "~/lib/drawing-page-pdf";

/**
 * Where a sheet's PDF bytes come from: its own small file when the server has
 * one, otherwise the set. Null while that is being found out, which is one
 * small request per drawing set.
 */
export function useSheetPdfSource(
  pdf: PdfPageSource | null | undefined,
): SheetPdfSource | null {
  const url = pdf?.url;
  const page = pdf?.page;
  const key = url && page !== undefined ? `${url}#${page}` : "";
  const asks = mayHavePagePdf(pdf);
  const [found, setFound] = useState<{
    key: string;
    source: SheetPdfSource;
  } | null>(null);
  useEffect(() => {
    if (!asks || !url || page === undefined) return;
    let cancelled = false;
    void sheetPdfSource({ url, page }).then((source) => {
      if (!cancelled) setFound({ key, source });
    });
    return () => {
      cancelled = true;
    };
  }, [asks, key, url, page]);
  if (!url || page === undefined) return null;
  if (!asks) return { url, page };
  return found?.key === key ? found.source : null;
}
