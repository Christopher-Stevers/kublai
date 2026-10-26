"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  equipmentCoverageLabels,
  equipmentReportCsv,
  type EquipmentCoverage,
} from "~/lib/super-equipment";
import { downloadReport } from "~/lib/download-report";

const colors: Record<EquipmentCoverage, string> = {
  matched:
    "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  review:
    "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  missing: "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-300",
  incomplete: "border-muted-foreground/40 bg-muted text-muted-foreground",
};
export function SuperEquipmentDialog({
  sheetId,
  jobId,
  onClose,
}: {
  sheetId: string;
  jobId: string;
  onClose: () => void;
}) {
  const sources = api.drawingsWorkspace.superEquipmentSources.useQuery({
    sheetId,
  });
  const [documentIds, setDocumentIds] = useState<string[] | undefined>();
  const report = api.drawingsWorkspace.superEquipmentReport.useQuery(
    { sheetId, documentIds },
    {
      staleTime: 0,
      refetchInterval: (q) => (q.state.data?.pending ? 2000 : false),
    },
  );
  const recognize =
    api.drawingsWorkspace.recognizeEquipmentSource.useMutation();
  const [filter, setFilter] = useState<"all" | EquipmentCoverage>("all"),
    [search, setSearch] = useState(""),
    [sheet, setSheet] = useState("");
  const [page, setPage] = useState(0),
    [sourceSearch, setSourceSearch] = useState(""),
    [draft, setDraft] = useState<string[] | undefined>();
  const [recognizing, setRecognizing] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const stop = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      stop.current = true;
      alive.current = false;
    };
  }, []);
  const data = report.data;
  const lines = data?.lines ?? [];
  const shown = lines.filter(
    (l) =>
      (filter === "all" || l.status === filter) &&
      (!sheet || l.sheetId === sheet) &&
      `${l.tag} ${l.schedule} ${l.sheet} ${l.cells.join(" ")} ${l.matches.map((m) => m.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / 30)),
    index = Math.min(page, pageCount - 1);
  const documents = sources.data?.documents ?? [];
  const selected = draft ?? documentIds ?? documents.map((d) => d.id);
  async function recognizePages() {
    if (!data) return;
    stop.current = false;
    setRecognizing(true);
    setError("");
    // Run sequentially: never render a whole job of scanned PDFs in parallel.
    const queue = [
      ...new Map(
        data.ocr.map((p) => [`${p.kind}:${p.id}:${p.page}`, p]),
      ).values(),
    ];
    let failed = 0;
    for (const [i, source] of queue.entries()) {
      if (stop.current) break;
      setProgress(
        `Recognizing ${source.name}, page ${source.page} · ${i + 1} of ${queue.length}`,
      );
      try {
        await recognize.mutateAsync({ sheetId, ...source });
      } catch {
        failed++;
      }
    }
    if (alive.current) {
      setProgress(
        `${stop.current ? "Text recognition stopped." : "Text recognition finished."}${failed ? ` ${failed} pages could not be read; try again or review them manually.` : ""}`,
      );
      await report.refetch();
    }
    setRecognizing(false);
  }
  function exportCsv() {
    if (!data) return;
    const absolute = (url: string) => new URL(url, window.location.origin).href;
    downloadReport(
      "super-equipment.csv",
      equipmentReportCsv(
        shown.map((l) => ({
          ...l,
          sourceUrl: absolute(l.sourceUrl),
          matches: l.matches.map((m) => ({ ...m, url: absolute(m.url) })),
        })),
        data.warnings,
        data.generatedAt,
      ),
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          stop.current = true;
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Super Equipment</DialogTitle>
          <DialogDescription>
            Compare every detected equipment schedule line with shop drawings
            and submittals in this job’s Documents.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={report.isFetching || recognizing}
              onClick={() => void report.refetch()}
            >
              Refresh report
            </Button>
            <Button
              variant="outline"
              disabled={!shown.length || report.isFetching || recognizing}
              onClick={exportCsv}
            >
              Export report ({shown.length})
            </Button>
            <Button variant="outline" asChild>
              <a href={`/jobs/${jobId}/documents`}>Job documents</a>
            </Button>
          </div>
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm">
              Submittal sources · {documentIds?.length ?? documents.length}{" "}
              documents selected
            </summary>
            <div className="mt-3 space-y-3">
              <Input
                aria-label="Search submittal sources"
                placeholder="Search documents or folders"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
              />
              {sources.error && <p role="alert">{sources.error.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recognizing}
                  onClick={() => setDraft(documents.map((d) => d.id))}
                >
                  All documents
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recognizing}
                  onClick={() =>
                    setDraft(
                      documents
                        .filter(
                          (d) =>
                            d.submittal ||
                            /submittal|shop[ _-]*drawing/i.test(
                              `${d.name} ${d.folder}`,
                            ),
                        )
                        .map((d) => d.id),
                    )
                  }
                >
                  Submittals only
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recognizing}
                  onClick={() => setDraft([])}
                >
                  None
                </Button>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {documents
                  .filter((d) =>
                    `${d.name} ${d.folder}`
                      .toLowerCase()
                      .includes(sourceSearch.toLowerCase()),
                  )
                  .map((d) => (
                    <label
                      key={d.id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(d.id)}
                        disabled={recognizing}
                        onChange={(e) =>
                          setDraft(
                            e.target.checked
                              ? [...selected, d.id]
                              : selected.filter((id) => id !== d.id),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {d.name}
                        <span className="text-muted-foreground block text-xs">
                          {d.folder || "Documents"}
                          {d.version ? ` · v${d.version}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
              </div>
              <Button
                size="sm"
                disabled={recognizing || draft === undefined}
                onClick={() => {
                  setDocumentIds([...selected]);
                  setDraft(undefined);
                  setPage(0);
                }}
              >
                Apply sources
              </Button>
            </div>
          </details>
          {(error || report.error) && (
            <p role="alert" className="text-destructive">
              {error || report.error?.message}
            </p>
          )}
          {report.isFetching && (
            <p role="status">
              {data
                ? "Updating source coverage…"
                : "Reading current drawing schedules and document versions…"}
            </p>
          )}
          {data && (
            <>
              <p className="text-sm">
                {data.coverage.sheets} / {data.coverage.totalSheets} drawing
                sheets read · {data.coverage.documents} /{" "}
                {data.coverage.totalDocuments} selected documents indexed ·{" "}
                {lines.length} schedule lines
              </p>
              {data.warnings.length > 0 && (
                <div className="rounded border border-amber-500/40 p-3">
                  <p className="mb-1 text-sm font-medium">Search coverage</p>
                  <ul className="space-y-1 text-sm">
                    {data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.ocr.length > 0 && (
                <Button
                  variant="outline"
                  disabled={recognizing || report.isFetching}
                  onClick={() => void recognizePages()}
                >
                  Recognize scanned pages ({data.ocr.length})
                </Button>
              )}
              {progress && (
                <p role="status" className="text-sm">
                  {progress}
                </p>
              )}
              {recognizing && (
                <Button
                  variant="outline"
                  onClick={() => {
                    stop.current = true;
                    setProgress("Stopping after the current page…");
                  }}
                >
                  Stop recognition
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  Object.keys(equipmentCoverageLabels) as EquipmentCoverage[]
                ).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    aria-label={`${lines.filter((l) => l.status === key).length} ${equipmentCoverageLabels[key]}`}
                    className={`rounded-lg border p-3 text-left ${colors[key]} ${filter === key ? "ring-2 ring-current" : ""}`}
                    onClick={() => {
                      setFilter(filter === key ? "all" : key);
                      setPage(0);
                    }}
                  >
                    <span className="block text-2xl font-semibold">
                      {lines.filter((l) => l.status === key).length}
                    </span>
                    <span className="text-sm">
                      {equipmentCoverageLabels[key]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-0 flex-1 basis-48"
                  aria-label="Search equipment report"
                  placeholder="Equipment tag, schedule or document"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
                <select
                  className="bg-background h-10 max-w-full min-w-0 rounded border px-2"
                  aria-label="Filter equipment sheet"
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All sheets</option>
                  {[
                    ...new Map(
                      lines.map((l) => [l.sheetId, l.sheet]),
                    ).entries(),
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                {filter !== "all" && (
                  <Button variant="outline" onClick={() => setFilter("all")}>
                    Show all results
                  </Button>
                )}
              </div>
              {!shown.length && (
                <p className="py-6 text-center text-sm">
                  {lines.length
                    ? "No results match these filters."
                    : "No equipment schedule lines identified yet. Check search coverage, recognize scanned pages, or inspect the schedule manually."}
                </p>
              )}
              {shown.slice(index * 30, (index + 1) * 30).map((line) => (
                <section
                  key={line.id}
                  className="space-y-3 rounded-lg border p-3 sm:p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{line.tag}</h3>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs ${colors[line.status]}`}
                    >
                      {equipmentCoverageLabels[line.status]}
                    </span>
                  </div>
                  <p className="text-sm">
                    {line.schedule} ·{" "}
                    <a
                      className="underline"
                      href={line.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {line.sheet} · View schedule line
                    </a>
                  </p>
                  <p className="text-muted-foreground text-sm break-words">
                    {line.cells.join(" · ") ||
                      "See the source schedule for equipment details."}
                  </p>
                  {line.matches.map((match) => (
                    <div
                      key={match.documentId}
                      className="space-y-1 border-t pt-2 text-sm"
                    >
                      <a
                        href={match.url}
                        className="font-medium break-words underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {match.name}
                        {match.version ? ` · v${match.version}` : ""}
                      </a>
                      <p className="text-muted-foreground">
                        {match.status}
                        {match.pages.length
                          ? ` · Pages ${match.pages.slice(0, 12).join(", ")}${match.pages.length > 12 ? "…" : ""}`
                          : ""}
                      </p>
                      <p>{match.reason}</p>
                    </div>
                  ))}
                  {line.status === "missing" && (
                    <p className="text-sm">
                      No matching submittal tag found in the selected,
                      accessible documents. Check for untagged shop drawings
                      before treating this item as missing.
                    </p>
                  )}
                  {line.status === "incomplete" && (
                    <p className="text-sm">
                      Some selected sources could not be searched. This item’s
                      submittal coverage is unknown.
                    </p>
                  )}
                </section>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => setPage(index - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  {index + 1} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index + 1 >= pageCount}
                  onClick={() => setPage(index + 1)}
                >
                  Next
                </Button>
              </div>
              <details className="text-sm">
                <summary>About equipment matches</summary>{" "}
                <p className="text-muted-foreground text-sm">
                  Exact equipment tags provide the match evidence. “Submittal
                  found” confirms a document is present, not engineering
                  approval. Untagged items, model-only references and unusual
                  schedule layouts need manual review.
                </p>
              </details>
              <p className="text-muted-foreground text-xs">
                Generated {new Date(data.generatedAt).toLocaleString()}.
                Coverage includes only sources you can access and the selected
                current versions.
              </p>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => {
              stop.current = true;
              onClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
