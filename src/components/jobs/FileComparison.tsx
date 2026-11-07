"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { PassiveDocumentPdfPreview } from "./documents/PassiveDocumentPdfPreview";
import { DrawingSheetViewer } from "./DrawingSheetViewer";
import { sourcePdfPage } from "~/lib/pdf-client";
import { tileBase } from "~/lib/drawing-tiles";
import type { DocumentOverview } from "~/server/documents/types";

type Sheet = {
  id: string;
  name: string;
  imageUrl: string;
  setId?: string | null;
  setName?: string | null;
};
type Source = {
  id: string;
  name: string;
  url?: string;
  image?: boolean;
  sheets?: Sheet[];
};
const EMPTY_SHEETS: Sheet[] = [];

/** Two independent, read-only viewers. Selecting or paging one never navigates the other. */
export function FileComparison({
  jobId,
  sheets = EMPTY_SHEETS,
  initialDocumentIds,
  initialSheetId,
  onClose,
  resolveAssetUrl,
}: {
  jobId: string;
  sheets?: Sheet[];
  initialDocumentIds?: [string, string];
  initialSheetId?: string;
  onClose: () => void;
  resolveAssetUrl?: (url: string) => Promise<string>;
}) {
  const [documents, setDocuments] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<[string, string]>(() =>
    initialDocumentIds
      ? (initialDocumentIds.map((id) => `document:${id}`) as [string, string])
      : ["", ""],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/job-documents?jobId=${encodeURIComponent(jobId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw Error("Could not load this job’s PDFs. Try again.");
        const data = (await response.json()) as DocumentOverview;
        const versions = new Map(
          data.versions.map((version) => [version.id, version]),
        );
        const sources = data.documents.flatMap((document) => {
          const version = versions.get(document.currentVersionId ?? "");
          if (
            document.deletedAt ||
            !version ||
            (version.mimeType !== "application/pdf" &&
              !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                version.mimeType,
              ))
          )
            return [];
          return [
            {
              id: `document:${document.id}`,
              name: document.name,
              url: `/api/job-documents/files/${encodeURIComponent(version.id)}?jobId=${encodeURIComponent(jobId)}`,
              image: version.mimeType !== "application/pdf",
            },
          ];
        });
        if (!controller.signal.aborted) setDocuments(sources);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Could not load PDFs.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [jobId, retry]);
  const sets = new Map<string, Source>();
  for (const sheet of sheets) {
    const id = `set:${sheet.setId ?? "other"}`;
    if (!sets.has(id))
      sets.set(id, { id, name: sheet.setName || "Drawings", sheets: [] });
    sets.get(id)!.sheets!.push(sheet);
  }
  const sources = [...sets.values(), ...documents];
  const initialSet = sources.find((source) =>
    source.sheets?.some((sheet) => sheet.id === initialSheetId),
  );
  const leftId = selected[0] || initialSet?.id || sources[0]?.id || "";
  const rightId = selected[1];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        layerClassName="z-[90]"
        className="flex h-[94dvh] w-[98vw] max-w-[98vw] flex-col gap-2 overflow-hidden p-2 sm:max-w-[98vw]"
      >
        <DialogHeader className="shrink-0 px-2 pr-10 text-left">
          <DialogTitle>Compare files</DialogTitle>
          <DialogDescription>
            View two PDFs or drawing sets side by side. Pan, zoom and change
            pages independently.
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p role="status" className="px-2 text-sm">
            Loading PDFs…
          </p>
        )}
        {error && (
          <div role="alert" className="px-2 text-sm">
            {error}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </Button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x overflow-hidden rounded border">
          {([leftId, rightId] as const).map((id, index) => (
            <ComparisonPane
              key={index}
              side={index === 0 ? "Left" : "Right"}
              sources={sources}
              id={id}
              loading={loading}
              initialSheetId={index === 0 ? initialSheetId : undefined}
              resolveAssetUrl={resolveAssetUrl}
              onSelect={(value) =>
                setSelected((current) =>
                  index === 0 ? [value, current[1]] : [leftId, value],
                )
              }
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComparisonPane({
  side,
  sources,
  id,
  loading,
  onSelect,
  initialSheetId,
  resolveAssetUrl,
}: {
  side: string;
  sources: Source[];
  id: string;
  loading: boolean;
  onSelect: (id: string) => void;
  initialSheetId?: string;
  resolveAssetUrl?: (url: string) => Promise<string>;
}) {
  const source = sources.find((source) => source.id === id);
  return (
    <section
      aria-label={`${side} comparison`}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <label className="flex shrink-0 flex-col gap-1 border-b p-2 text-xs font-medium">
        {side} file
        <select
          aria-label={`${side} file`}
          className="bg-background h-10 w-full min-w-0 rounded border px-1 text-sm"
          value={id}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">Choose a PDF or drawing set</option>
          {id && !source && (
            <option value={id}>
              {loading ? "Loading selected file…" : "Selected file unavailable"}
            </option>
          )}
          <optgroup label="Drawing sets">
            {sources
              .filter((source) => source.sheets)
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Documents">
            {sources
              .filter((source) => !source.sheets)
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      {source?.sheets ? (
        <SetPane
          key={source.id}
          sheets={source.sheets}
          side={side}
          initialSheetId={initialSheetId}
          resolveAssetUrl={resolveAssetUrl}
        />
      ) : source?.url ? (
        source.image ? (
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source.url} alt={source.name} className="h-auto w-full" />
          </div>
        ) : (
          <PassiveDocumentPdfPreview
            key={source.url}
            url={source.url}
            title={`${side}: ${source.name}`}
            fillHeight
          />
        )
      ) : (
        <p className="text-muted-foreground m-auto p-3 text-center text-sm">
          {id
            ? loading
              ? "Opening file…"
              : "This file is unavailable. Choose another file."
            : "Choose a file to compare."}
        </p>
      )}
    </section>
  );
}
function SetPane({
  sheets,
  side,
  initialSheetId,
  resolveAssetUrl,
}: {
  sheets: Sheet[];
  side: string;
  initialSheetId?: string;
  resolveAssetUrl?: (url: string) => Promise<string>;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      sheets.findIndex((sheet) => sheet.id === initialSheetId),
    ),
  );
  const sheet = sheets[Math.min(index, sheets.length - 1)]!;
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <DrawingSheetViewer
          key={sheet.id}
          toolControls={{ measureRequest: 0, pipeRequest: 0 }}
          src={sheet.imageUrl}
          alt={sheet.name}
          sheetKey={sheet.id}
          pdf={sourcePdfPage(sheet.imageUrl)}
          tiles={tileBase(sheet.imageUrl)}
          resolveAssetUrl={resolveAssetUrl}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t p-1">
        <Button
          variant="outline"
          size="sm"
          aria-label={`${side} previous sheet`}
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
        >
          ‹
        </Button>
        <select
          aria-label={`${side} sheet`}
          className="bg-background h-9 min-w-0 flex-1 text-xs"
          value={sheet.id}
          onChange={(event) =>
            setIndex(
              sheets.findIndex((sheet) => sheet.id === event.target.value),
            )
          }
        >
          {sheets.map((sheet, index) => (
            <option key={sheet.id} value={sheet.id}>
              {index + 1}. {sheet.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${side} next sheet`}
          disabled={index >= sheets.length - 1}
          onClick={() => setIndex((value) => value + 1)}
        >
          ›
        </Button>
      </div>
    </>
  );
}
