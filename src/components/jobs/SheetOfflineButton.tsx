"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { collectDrawingOfflineUrls } from "~/lib/drawing-offline";
import { warmDrawingPdfRuntime } from "~/lib/drawing-pdf-offline-runtime";
import { useSheetOfflineStatus } from "./useSheetOfflineStatus";
import { useDrawingAccount } from "./DrawingAccountProvider";

type Props = {
  sheet: { id: string; name: string; imageUrl: string };
  workspaceSheetId?: string;
  /** Fetch and retain the metadata needed to reopen this sheet offline. */
  prepare?: (signal: AbortSignal) => Promise<void | string[]>;
};

/** The same explicit, private device download in every sheet surface. */
export function SheetOfflineButton({
  sheet,
  prepare,
  workspaceSheetId = sheet.id,
}: Props) {
  const store = useDrawingAccount()?.store;
  const { saved, setSaved } = useSheetOfflineStatus(
    store,
    sheet,
    workspaceSheetId,
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const marker = `sheet-download:${sheet.id}:${sheet.imageUrl}`;
  useEffect(() => {
    setProgress(null);
    setError(null);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [store, marker]);
  const save = async () => {
    if (!store || controller.current) return;
    const aborter = new AbortController();
    controller.current = aborter;
    setProgress("Preparing…");
    setError(null);
    try {
      await navigator.storage?.persist?.().catch(() => false);
      await warmDrawingPdfRuntime({ signal: aborter.signal });
      const additionalImages = await prepare?.(aborter.signal);
      aborter.signal.throwIfAborted();
      const urls = await collectDrawingOfflineUrls(
        [sheet.imageUrl, ...(additionalImages ?? [])],
        { signal: aborter.signal },
      );
      const existing = await store.summary();
      const estimate = await navigator.storage
        ?.estimate?.()
        .catch(() => undefined);
      const budgetBytes = estimate?.quota
        ? existing.bytes +
          Math.floor(Math.max(0, estimate.quota - (estimate.usage ?? 0)) * 0.9)
        : 2 * 1024 * 1024 * 1024;
      await store.saveAssets(urls, {
        budgetBytes,
        signal: aborter.signal,
        onProgress: (p) => {
          if (!aborter.signal.aborted)
            setProgress(`${p.completed}/${p.total} files`);
        },
      });
      aborter.signal.throwIfAborted();
      await store.saveSnapshot(marker, urls);
      if (!aborter.signal.aborted) setSaved(true);
    } catch (reason) {
      if (!aborter.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save this sheet offline.",
        );
    } finally {
      if (controller.current === aborter) {
        controller.current = null;
        setProgress(null);
      }
    }
  };
  return (
    <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="bg-background flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
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
        onClick={() => (progress ? controller.current?.abort() : void save())}
      >
        {progress ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
        ) : saved ? (
          <CheckIcon className="size-4 shrink-0" />
        ) : (
          <DownloadIcon className="size-4 shrink-0" />
        )}
        {progress ? "Cancel" : saved ? "Available offline" : "Save offline"}
      </button>
      {progress && (
        <p role="status" className="mt-1 text-xs">
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
