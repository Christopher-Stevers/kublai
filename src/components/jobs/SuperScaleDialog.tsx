"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";
import {
  drawingMetadataSchema,
  type DrawingJobSheet,
  type DrawingMetadata,
} from "~/lib/drawing-workspace";
import { createGridReader } from "~/lib/pdf-super-scale";
import {
  gridSpacing,
  transferGridScale,
  type GridRead,
} from "~/lib/super-scale";
import { formatLength, type SheetScale } from "~/lib/sheet-measure";

type Result = {
  sheet: DrawingJobSheet;
  ownerId: string;
  metadata: DrawingMetadata;
  grids?: GridRead;
  scale?: SheetScale;
  selected: boolean;
  status: string;
  saved?: boolean;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to read this drawing";
const field =
  "border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm";

function GridPreview({
  sheet,
  grids,
  first,
  second,
}: {
  sheet: DrawingJobSheet;
  grids: GridRead;
  first: string;
  second: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded border"
      style={{ aspectRatio: String(1 / grids.aspect) }}
    >
      {/* Use the original preview; SVG overlays mark the exact vectors used for scale. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sheet.imageUrl}
        alt={sheet.name}
        className="h-full w-full object-fill"
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 1000 ${1000 * grids.aspect}`}
      >
        {grids.grids
          .filter((g) => g.name === first || g.name === second)
          .map((g) => (
            <g key={g.name}>
              <line
                x1={g.line.x1 * 1000}
                x2={g.line.x2 * 1000}
                y1={g.line.y1 * grids.aspect * 1000}
                y2={g.line.y2 * grids.aspect * 1000}
                stroke={g.name === first ? "#e11d48" : "#2563eb"}
                strokeWidth={4}
              />
              <text
                x={g.line.x1 * 1000 + 8}
                y={g.line.y1 * grids.aspect * 1000 + 20}
                fontSize={22}
                fill="black"
                stroke="white"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {g.name}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}

export function SuperScaleDialog({
  jobId,
  source,
  ownerId,
  metadata,
  sheets,
  onClose,
  onSaved,
}: {
  jobId: string;
  source: DrawingJobSheet;
  ownerId: string;
  metadata: DrawingMetadata;
  sheets: DrawingJobSheet[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const utils = api.useUtils();
  const mutation = api.drawingsWorkspace.metadata.useMutation();
  const [read, setRead] = useState<GridRead | null>(null);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState("Reading grid lines…");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [finished, setFinished] = useState(false);
  const [scanReference, setScanReference] = useState<{
    revision: number;
    sourceId: string;
  } | null>(null);
  const run = useRef(0);
  const reader = useRef<ReturnType<typeof createGridReader> | null>(null);
  const stop = () => {
    run.current++;
    void reader.current?.close();
    reader.current = null;
  };
  useEffect(() => {
    const id = ++run.current;
    const active = createGridReader();
    reader.current = active;
    void active
      .read(source.imageUrl)
      .then((value) => {
        if (id !== run.current) return;
        setRead(value);
        if (value.grids.length < 2)
          setError(
            "Could not identify two labelled grid lines. Scans, angled grids and obscured labels may need manual calibration.",
          );
      })
      .catch((reason) => {
        if (id === run.current) setError(message(reason));
      })
      .finally(() => {
        void active.close();
        if (id === run.current) setBusy("");
      });
    return () => {
      run.current++;
      void active.close();
      void reader.current?.close();
    };
  }, [source.imageUrl]);
  const pair = read ? gridSpacing(read, first, second) : null;
  const distance =
    pair && metadata.scale
      ? pair.distance * metadata.scale.unitsPerSheetWidth
      : null;
  const change = (which: "first" | "second", value: string) => {
    if (which === "first") {
      setFirst(value);
      setSecond("");
    } else setSecond(value);
    setResults([]);
    setScanReference(null);
    setFinished(false);
    setError("");
  };
  const scan = async () => {
    if (!read || !pair || !metadata.scale) return;
    const id = ++run.current;
    setResults([]);
    setError("");
    setFinished(false);
    setBusy("Finding current drawings…");
    setScanReference({ revision: metadata.revision, sourceId: source.id });
    const active = createGridReader();
    reader.current = active;
    try {
      const summaries = await utils.drawingsWorkspace.list.fetch({ jobId });
      const byId = new Map(sheets.map((s) => [s.id, s]));
      const revisionSources = new Set(
        summaries
          .filter((s) => s.metadata.currentSourceSheetId !== s.sheetId)
          .map((s) => s.metadata.currentSourceSheetId),
      );
      const candidates = summaries.filter(
        (s) =>
          s.sheetId !== ownerId &&
          !revisionSources.has(s.sheetId) &&
          s.metadata.status !== "superseded",
      );
      const rows: Result[] = [];
      for (let index = 0; index < candidates.length; index++) {
        if (id !== run.current) return;
        const item = candidates[index]!;
        const target = byId.get(item.metadata.currentSourceSheetId);
        if (!target || target.id === source.id) continue;
        setBusy(
          `Checking ${index + 1} of ${candidates.length}: ${target.name}`,
        );
        const row: Result = {
          sheet: target,
          ownerId: item.sheetId,
          metadata: item.metadata,
          selected: false,
          status: "",
        };
        if (item.metadata.scale) row.status = "Already calibrated — kept";
        else {
          try {
            const grids = await active.read(target.imageUrl);
            row.grids = grids;
            const match = transferGridScale(
              read,
              grids,
              first,
              second,
              metadata.scale,
            );
            if (match.ok) {
              row.scale = match.scale;
              row.status = match.checks
                ? `Matched; ${match.checks} additional grid checks`
                : "Pair found — inspect before selecting";
              row.selected = match.checks > 0;
            } else row.status = match.reason;
          } catch (reason) {
            row.status = message(reason);
          }
        }
        rows.push(row);
        if (id === run.current) setResults([...rows]);
        // Yield between sheets so progress and cancellation remain responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (id === run.current) setFinished(true);
    } catch (reason) {
      if (id === run.current) setError(message(reason));
    } finally {
      void active.close();
      if (id === run.current) setBusy("");
    }
  };
  const apply = async () => {
    if (!scanReference) return;
    setSaving(true);
    setError("");
    let saved = 0;
    try {
      const current = await utils.drawingsWorkspace.get.fetch({
        sheetId: ownerId,
      });
      if (
        current.metadata.revision !== scanReference.revision ||
        current.metadata.currentSourceSheetId !== scanReference.sourceId
      )
        throw new Error(
          "The reference drawing changed. Close Super scale and reopen it before applying.",
        );
      for (const row of results.filter(
        (r) => r.selected && r.scale && !r.saved,
      )) {
        try {
          await mutation.mutateAsync({
            sheetId: row.ownerId,
            expectedRevision: row.metadata.revision,
            data: drawingMetadataSchema.parse({
              ...row.metadata,
              scale: row.scale,
            }),
          });
          saved++;
          setResults((old) =>
            old.map((r) =>
              r.ownerId === row.ownerId
                ? { ...r, saved: true, selected: false, status: "Scale saved" }
                : r,
            ),
          );
        } catch (reason) {
          setResults((old) =>
            old.map((r) =>
              r.ownerId === row.ownerId
                ? {
                    ...r,
                    selected: false,
                    status: `Not saved: ${message(reason)}`,
                  }
                : r,
            ),
          );
        }
      }
      setError(
        `${saved} drawing${saved === 1 ? "" : "s"} calibrated. Existing scales were kept.`,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      await utils.drawingsWorkspace.invalidate().catch(() => undefined);
      setSaving(false);
      onSaved();
    }
  };
  const selected = results.filter(
    (r) => r.selected && r.scale && !r.saved,
  ).length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          stop();
          onClose();
        }
      }}
    >
      <DialogContent
        className="block max-h-[90dvh] space-y-4 overflow-y-auto sm:max-w-2xl"
        layerClassName="z-[90]"
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Super scale</DialogTitle>
          <DialogDescription>
            Transfer this drawing’s calibration using the same named grid lines
            on other drawings in this job.
          </DialogDescription>
        </DialogHeader>
        {!metadata.scale ? (
          <p className="text-sm">
            First calibrate this drawing with Measure → Set Scale, then reopen
            Super scale.
          </p>
        ) : (
          <>
            <p className="text-sm">
              Reference: <strong>{source.name}</strong>. Choose two parallel
              grid lines from the same building. Existing scales will be kept.
            </p>
            {read && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  First grid
                  <select
                    className={field}
                    value={first}
                    disabled={!!busy || saving}
                    onChange={(e) => change("first", e.target.value)}
                  >
                    <option value="">Choose grid</option>
                    {read.grids.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Second grid
                  <select
                    className={field}
                    value={second}
                    disabled={!!busy || saving || !first}
                    onChange={(e) => change("second", e.target.value)}
                  >
                    <option value="">Choose grid</option>
                    {read.grids
                      .filter(
                        (g) =>
                          g.name !== first &&
                          g.axis ===
                            read.grids.find((a) => a.name === first)?.axis,
                      )
                      .map((g) => (
                        <option key={g.name} value={g.name}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
            {read && pair && (
              <>
                <p className="text-sm font-medium">
                  {first} to {second}:{" "}
                  {distance !== null
                    ? formatLength(distance, metadata.scale.unit)
                    : ""}
                </p>
                <GridPreview
                  sheet={source}
                  grids={read}
                  first={first}
                  second={second}
                />
              </>
            )}
            {read && read.ambiguous.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Ambiguous labels excluded: {read.ambiguous.join(", ")}
              </p>
            )}
            <Button
              disabled={!pair || !!busy || saving}
              onClick={() => void scan()}
            >
              Find matching drawings
            </Button>
          </>
        )}
        {busy && (
          <div role="status" className="text-sm">
            {busy}
            <Button
              variant="outline"
              className="ml-2"
              onClick={() => {
                stop();
                setBusy("");
                setFinished(false);
                setError("Stopped. No scales were changed.");
              }}
            >
              Stop
            </Button>
          </div>
        )}
        {!!results.length && (
          <div className="space-y-3">
            <p className="text-sm">
              Check the highlighted lines before applying. Sheets with different
              detail scales need manual calibration.
            </p>
            {results.map((row) => (
              <div key={row.ownerId} className="rounded border p-3 text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={row.selected}
                    disabled={
                      !row.scale || (row.saved ?? false) || !!busy || saving
                    }
                    onChange={(e) =>
                      setResults((old) =>
                        old.map((r) =>
                          r.ownerId === row.ownerId
                            ? { ...r, selected: e.target.checked }
                            : r,
                        ),
                      )
                    }
                  />
                  <span>
                    <strong>
                      {row.sheet.setName} / {row.sheet.name}
                    </strong>
                    <span className="text-muted-foreground block">
                      {row.status}
                    </span>
                  </span>
                </label>
                {row.scale && row.grids && (
                  <details className="mt-2">
                    <summary className="cursor-pointer">
                      Inspect grid match
                    </summary>
                    <GridPreview
                      sheet={row.sheet}
                      grids={row.grids}
                      first={first}
                      second={second}
                    />
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
        {finished && results.length === 0 && (
          <p className="text-sm">No other current drawings in this job.</p>
        )}
        {error && (
          <p role="status" className="text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Close
          </Button>
          {finished && (
            <Button
              disabled={!selected || !!busy || saving}
              onClick={() => void apply()}
            >
              {saving
                ? "Saving…"
                : `Apply to ${selected} drawing${selected === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
