"use client";

import { requestPersistentDeviceStorage } from "~/lib/persistent-device-storage";
import { drawingDownloadQueue } from "~/lib/drawing-download-queue";
import { useDrawingDownloads } from "~/hooks/use-drawing-downloads";
import {
  CheckIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
  DownloadIcon,
  Loader2Icon,
} from "lucide-react";
import { collectDrawingOfflineUrls } from "~/lib/drawing-offline";
import { warmDrawingPdfRuntime } from "~/lib/drawing-pdf-offline-runtime";
import { useSheetOfflineStatus } from "./useSheetOfflineStatus";
import { useDrawingAccount } from "./DrawingAccountProvider";

type Props = {
  sheet: { id: string; name: string; imageUrl: string };
  workspaceSheetId?: string;
  iconOnly?: boolean;
  /** Fetch and retain the metadata needed to reopen this sheet offline. */
  prepare?: (signal: AbortSignal) => Promise<void | string[]>;
};

/** The same explicit, private device download in every sheet surface. */
export function SheetOfflineButton({
  sheet,
  prepare,
  workspaceSheetId = sheet.id,
  iconOnly = false,
}: Props) {
  const store = useDrawingAccount()?.store;
  const { saved } = useSheetOfflineStatus(store, sheet, workspaceSheetId);
  const marker = `sheet-download:${sheet.id}:${sheet.imageUrl}`;
  const downloadId = `${store?.accountKey}:${marker}`;
  const task = useDrawingDownloads().find((item) => item.id === downloadId);
  const progress =
    task && ["queued", "running"].includes(task.status) ? task.progress : null;
  const error = task?.status === "failed" ? task.progress : null;
  const save = () => {
    if (!store) return;
    const protection = requestPersistentDeviceStorage();
    drawingDownloadQueue.enqueue(
      { id: downloadId, account: store.accountKey, label: sheet.name },
      async (signal, setProgress) => {
        await protection;
        await warmDrawingPdfRuntime({ signal });
        const additionalImages = await prepare?.(signal);
        signal.throwIfAborted();
        const urls = await collectDrawingOfflineUrls(
          [sheet.imageUrl, ...(additionalImages ?? [])],
          { signal },
        );
        const existing = await store.summary();
        const estimate = await navigator.storage
          ?.estimate?.()
          .catch(() => undefined);
        const budgetBytes = estimate?.quota
          ? existing.bytes +
            Math.floor(
              Math.max(0, estimate.quota - (estimate.usage ?? 0)) * 0.9,
            )
          : 2 * 1024 * 1024 * 1024;
        await store.saveAssets(urls, {
          budgetBytes,
          signal,
          onProgress: (p) => {
            if (!signal.aborted) setProgress(`${p.completed}/${p.total} files`);
          },
        });
        signal.throwIfAborted();
        await store.saveSnapshot(marker, urls);
      },
    );
  };
  return (
    <div className={iconOnly ? "shrink-0" : "min-w-0"}>
      <button
        type="button"
        className={
          iconOnly
            ? `hover:bg-accent flex size-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${saved && !progress ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:text-foreground"}`
            : "bg-background flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
        }
        disabled={!store}
        aria-label={
          progress
            ? `Cancel saving ${sheet.name} offline`
            : saved
              ? `${sheet.name} available offline; refresh`
              : `Save ${sheet.name} offline`
        }
        title={
          saved
            ? "Saved on this device. Select to refresh."
            : "Save in ForemanHQ for use without internet"
        }
        onClick={(event) => {
          // Only the control consumes the tap; blank row space still opens
          // the containing floor/drawing card.
          event.stopPropagation();
          if (progress) drawingDownloadQueue.cancel(downloadId);
          else void save();
        }}
      >
        {progress ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
        ) : iconOnly ? (
          saved ? (
            <CloudCheckIcon className="size-4 shrink-0" />
          ) : (
            <CloudDownloadIcon className="size-4 shrink-0" />
          )
        ) : saved ? (
          <CheckIcon className="size-4 shrink-0" />
        ) : (
          <DownloadIcon className="size-4 shrink-0" />
        )}
        {!iconOnly &&
          (progress ? "Cancel" : saved ? "Available offline" : "Save offline")}
      </button>
      {progress && (
        <p role="status" className={iconOnly ? "sr-only" : "mt-1 text-xs"}>
          {progress}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 max-w-64 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
