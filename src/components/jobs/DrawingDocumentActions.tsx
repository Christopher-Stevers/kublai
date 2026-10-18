"use client";

import { useSheetOfflineStatus } from "./useSheetOfflineStatus";
import { useEffect, useRef, useState } from "react";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import { drawingMarkupLinks } from "~/lib/drawing-links";
import { isAppLink } from "~/lib/app-links";
import type { SheetScale } from "~/lib/sheet-measure";
import { sourcePdfPage } from "~/lib/pdf-client";
import {
  collectDrawingOfflineUrls,
  DRAWING_OFFLINE_BUDGET,
  type DrawingOfflineProgress,
  type DrawingOfflineStore,
} from "~/lib/drawing-offline";

type Sheet = {
  id: string;
  name: string;
  imageUrl: string;
  sourceFilename?: string | null;
  setId?: string;
};
export type DrawingDocumentActionsProps = {
  sheet: Sheet;
  jobId?: string;
  /** Immutable version id if different from the workspace's logical sheet id. */
  sourceSheetId?: string;
  workspaceSheetId?: string;
  sheets?: Sheet[];
  entities?: DrawingEntity[];
  scale?: SheetScale | null;
  store?: DrawingOfflineStore | null;
  resolveAssetUrl?: (url: string) => Promise<string>;
  onOfflineSaved?: () => void | Promise<void>;
  packageMode?: boolean;
  allowBatchOffline?: boolean;
  title?: string;
};
const button = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function DrawingDocumentActions({
  sheet,
  jobId,
  sourceSheetId = sheet.id,
  workspaceSheetId = sheet.id,
  sheets = [sheet],
  entities = [],
  scale,
  store,
  resolveAssetUrl,
  onOfflineSaved,
  packageMode = false,
  allowBatchOffline = false,
  title,
}: DrawingDocumentActionsProps) {
  const { saved: savedOffline } = useSheetOfflineStatus(store, sheet, workspaceSheetId);
  const [annotations, setAnnotations] = useState(true);
  const [includeTiles, setIncludeTiles] = useState(false);
  const [scope, setScope] = useState<"sheet" | "folder">("sheet");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<DrawingOfflineProgress | null>(null);
  const [summary, setSummary] = useState<{
    files: number;
    bytes: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const pdf = sourcePdfPage(sheet.imageUrl);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    controller.current?.abort();
    setBusy(null);
    setMessage(null);
    setSummary(null);
    setProgress(null);
    if (store)
      void store
        .summary()
        .then((value) => {
          if (mounted.current && generation === epoch.current)
            setSummary(value);
        })
        .catch(() => undefined);
    return () => {
      epoch.current = generation + 1;
      controller.current?.abort();
    };
  }, [store, sheet.id]);

  const run = async (
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (controller.current && !controller.current.signal.aborted) return;
    const generation = epoch.current;
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(label);
    setMessage(null);
    setProgress(null);
    try {
      await action(aborter.signal);
      if (mounted.current && generation === epoch.current)
        setMessage(
          label === "Saving offline"
            ? "Drawings saved for offline viewing."
            : label === "Removing downloads"
              ? "Saved drawings removed from this device."
              : "Drawing prepared.",
        );
    } catch (error) {
      if (mounted.current && generation === epoch.current)
        setMessage(
          aborter.signal.aborted
            ? "Cancelled. Files already saved offline were kept."
            : error instanceof Error
              ? error.message
              : "This action could not be completed.",
        );
    } finally {
      if (mounted.current && generation === epoch.current) {
        setBusy(null);
        controller.current = null;
        if (store)
          void store
            .summary()
            .then((value) => {
              if (mounted.current && generation === epoch.current)
                setSummary(value);
            })
            .catch(() => undefined);
      }
    }
  };
  const markupLinkUrl = (markup: DrawingMarkup) => {
    const links = drawingMarkupLinks(markup);
    if (links.length === 1 && links[0]?.url && isAppLink(links[0].url))
      return new URL(links[0].url, location.origin).href;
    if (!jobId) return null;
    const entity = entities.find(
      (item) => item.kind === "markup" && item.data === markup,
    );
    const targetId =
      links.length === 1 ? links[0]?.targetSheetId : entity?.sheetId;
    const target = sheets.find((item) => item.id === targetId);
    if (!target?.setId) return null;
    const url = new URL(`/dashboard/jobs/${jobId}/drawings`, location.origin);
    url.searchParams.set("drawingSet", target.setId);
    url.searchParams.set("drawingSheet", target.id);
    if (links.length > 1 && entity)
      url.searchParams.set("drawingLink", entity.id);
    return url.href;
  };
  const options = (signal: AbortSignal) => ({
    pdfUrl: pdf!.url,
    pageNumber: pdf!.page,
    sourceSheetId,
    title: sheet.name,
    signal,
    resolveSource: resolveAssetUrl,
    sharedScale: scale,
    markupLinkUrl,
    markups: annotations
      ? entities.flatMap((item) =>
          item.kind === "markup" && item.visibility !== "archived"
            ? [item.data]
            : [],
        )
      : [],
  });
  const packageOptions = (signal: AbortSignal) => ({
    title: title ?? "Drawing package",
    signal,
    resolveSource: resolveAssetUrl,
    sheets: sheets.map((item) => {
      const source = sourcePdfPage(item.imageUrl);
      if (!source)
        throw new Error(`The original PDF for ${item.name} is unavailable.`);
      return {
        pdfUrl: source.url,
        pageNumber: source.page,
        sourceSheetId: item.id,
        title: item.name,
        markupLinkUrl,
        markups: annotations
          ? entities.flatMap((entity) =>
              entity.kind === "markup" && entity.visibility !== "archived"
                ? [entity.data]
                : [],
            )
          : [],
      };
    }),
  });
  return (
    <section
      className="space-y-3 p-3"
      aria-label="Drawing downloads and printing"
    >
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={!pdf || Boolean(busy)}
          onClick={() => {
            if (pdf)
              void run("Downloading original", (signal) =>
                import("~/lib/drawing-pdf-export").then(
                  ({ downloadOriginalDrawing }) =>
                    downloadOriginalDrawing(
                      pdf.url,
                      sheet.sourceFilename ?? "original-drawings.pdf",
                      { signal, resolveSource: resolveAssetUrl },
                    ),
                ),
              );
          }}
        >
          Original PDF
        </button>
        <button
          className={button}
          disabled={!pdf || Boolean(busy)}
          onClick={() => {
            if (pdf)
              void run(
                packageMode ? "Exporting package" : "Exporting sheet",
                async (signal) => {
                  const helpers = await import("~/lib/drawing-pdf-export");
                  if (packageMode)
                    await helpers.downloadDrawingPackage(
                      packageOptions(signal),
                      `${title ?? "Drawing package"}.pdf`,
                    );
                  else
                    await helpers.downloadDrawingPdf(
                      options(signal),
                      `${sheet.name}.pdf`,
                    );
                },
              );
          }}
        >
          {packageMode ? "Download package" : "Download this sheet"}
        </button>
        <button
          className={button}
          disabled={!pdf || Boolean(busy)}
          onClick={() => {
            if (pdf)
              void run("Preparing print", async (signal) => {
                // Reserve the window in the click turn, before loading pdf-lib.
                const target = window.open("", "_blank");
                if (!target)
                  throw new Error(
                    "Allow this app to open the drawing's print window.",
                  );
                target.opener = null;
                try {
                  const helpers = await import("~/lib/drawing-pdf-export");
                  if (packageMode)
                    await helpers.printDrawingPackage(
                      packageOptions(signal),
                      target,
                    );
                  else await helpers.printDrawingPdf(options(signal), target);
                } catch (error) {
                  target.close();
                  throw error;
                }
              });
          }}
        >
          {packageMode ? "Print package" : "Print"}
        </button>
      </div>
      {!packageMode && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={annotations}
            onChange={(event) => setAnnotations(event.target.checked)}
          />{" "}
          Include visible markups in sheet download and print
        </label>
      )}
      {packageMode && (
        <p className="text-muted-foreground text-xs">
          Packages contain the original source sheets recorded when the
          transmittal was created. Export individual sheets to include current
          markups.
        </p>
      )}
      {!pdf && (
        <p className="text-muted-foreground text-xs">
          The original PDF is not available for this sheet.
        </p>
      )}
      {!packageMode && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Offline drawings</p>
          <p className="text-muted-foreground text-xs">
            Save while connected, then view drawings without a connection.
            Limit: {megabytes(DRAWING_OFFLINE_BUDGET)} on this device. Private
            drafts can be saved offline and synced after reconnecting.
            Publishing requires a connection.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {allowBatchOffline && (
              <select
                aria-label="Offline download selection"
                className="bg-background rounded border p-2 text-sm"
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value as "sheet" | "folder")
                }
                disabled={Boolean(busy)}
              >
                <option value="sheet">This sheet</option>
                <option value="folder">
                  All {sheets.length} available job sheets
                </option>
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeTiles}
                disabled={Boolean(busy)}
                onChange={(event) => setIncludeTiles(event.target.checked)}
              />{" "}
              Include sharp tiles (larger download)
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={!store || Boolean(busy)}
              onClick={() => {
                if (store)
                  void run("Saving offline", async (signal) => {
                    const { warmDrawingPdfRuntime } =
                      await import("~/lib/drawing-pdf-offline-runtime");
                    await warmDrawingPdfRuntime({ signal });
                    const urls = await collectDrawingOfflineUrls(
                      (allowBatchOffline && scope === "folder"
                        ? sheets
                        : [sheet]
                      ).map((item) => item.imageUrl),
                      { includeTiles, signal },
                    );
                    const generation = epoch.current;
                    await store.saveAssets(urls, {
                      signal,
                      onProgress: (value) => {
                        if (mounted.current && generation === epoch.current)
                          setProgress(value);
                      },
                    });
                    signal.throwIfAborted();
                    await onOfflineSaved?.();
                    window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
                  });
              }}
            >
              {savedOffline && scope === "sheet" ? "Available offline · Refresh" : "Save offline"}
            </button>
            <button
              className={button}
              disabled={!store || Boolean(busy) || !summary?.files}
              onClick={() => {
                if (store) void run("Removing downloads", () => store.clear());
              }}
            >
              Remove saved drawings
            </button>
            {busy && (
              <button
                className={button}
                onClick={() => controller.current?.abort()}
              >
                Cancel
              </button>
            )}
          </div>
          {summary && (
            <p className="text-muted-foreground text-xs">
              {summary.files} saved files · {megabytes(summary.bytes)}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm">
              {busy}…{" "}
              {progress &&
                `${progress.completed}/${progress.total} files · ${megabytes(progress.bytes)}`}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
