"use client";
import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { isTileManifest, tileBase } from "~/lib/drawing-tiles";
import type { LegendBox, LegendItemData } from "~/lib/drawing-legend";

type Sheet = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
};
type Candidate = LegendItemData & { selected: boolean };
const PAGE_SIZE = 12;

export function LegendCrop({
  sheet,
  box,
  selection,
  onSelection,
}: {
  sheet: Sheet;
  box: LegendBox;
  selection?: LegendBox;
  onSelection?: (box: LegendBox) => void;
}) {
  const clipId = "legend-crop-" + useId().replace(/:/g, "");
  const base = tileBase(sheet.imageUrl);
  const manifest = useQuery({
    queryKey: ["legend-tiles", sheet.imageUrl],
    queryFn: async () => {
      if (!base) return null;
      const response = await fetch(base + "/manifest.json");
      if (!response.ok) return null;
      const value: unknown = await response.json();
      return isTileManifest(value) ? value : null;
    },
    staleTime: Infinity,
    retry: false,
  });
  const level = manifest.data
    ? [...manifest.data.levels].sort((a, b) => b.width - a.width)[0]
    : undefined;
  const width = level?.width ?? sheet.width,
    height = level?.height ?? sheet.height,
    size = manifest.data?.tileSize ?? 512;
  const tiles: Array<{ x: number; y: number }> = [];
  if (level && base)
    for (
      let y = Math.floor((box.top * height) / size);
      y <=
      Math.min(
        Math.ceil(height / size) - 1,
        Math.floor((box.bottom * height) / size),
      );
      y++
    )
      for (
        let x = Math.floor((box.left * width) / size);
        x <=
        Math.min(
          Math.ceil(width / size) - 1,
          Math.floor((box.right * width) / size),
        );
        x++
      )
        if (tiles.length < 64) tiles.push({ x, y });
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<LegendBox | null>(null);
  const shownSelection = drag ?? selection;
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: Math.min(box.right, Math.max(box.left, p.x / width)),
      y: Math.min(box.bottom, Math.max(box.top, p.y / height)),
    };
  };
  return (
    <svg
      aria-label={onSelection ? "Drag around the symbol" : "Legend symbol"}
      role="img"
      className={
        onSelection
          ? "h-40 w-full touch-none rounded border bg-white"
          : "h-20 w-40 shrink-0 rounded border bg-white"
      }
      viewBox={`${box.left * width} ${box.top * height} ${(box.right - box.left) * width} ${(box.bottom - box.top) * height}`}
      onPointerDown={(event) => {
        if (!onSelection) return;
        start.current = point(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const end = point(event),
          first = start.current;
        if (!onSelection || !first || !end) return;
        setDrag({
          left: Math.min(first.x, end.x),
          right: Math.max(first.x, end.x),
          top: Math.min(first.y, end.y),
          bottom: Math.max(first.y, end.y),
        });
      }}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      onPointerUp={(event) => {
        const end = point(event),
          first = start.current;
        start.current = null;
        setDrag(null);
        if (!onSelection || !first || !end) return;
        if (
          Math.abs(end.x - first.x) < 0.0001 ||
          Math.abs(end.y - first.y) < 0.0001
        )
          return;
        onSelection({
          left: Math.min(first.x, end.x),
          right: Math.max(first.x, end.x),
          top: Math.min(first.y, end.y),
          bottom: Math.max(first.y, end.y),
        });
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            x={box.left * width}
            y={box.top * height}
            width={(box.right - box.left) * width}
            height={(box.bottom - box.top) * height}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <image href={sheet.imageUrl} width={width} height={height} />
        {tiles.map((t) => (
          <image
            key={`${t.x}-${t.y}`}
            href={`${base}/${level!.factor}/${t.x}_${t.y}.webp`}
            x={t.x * size}
            y={t.y * size}
            width={Math.min(size, width - t.x * size)}
            height={Math.min(size, height - t.y * size)}
          />
        ))}
      </g>
      {shownSelection && (
        <rect
          x={shownSelection.left * width}
          y={shownSelection.top * height}
          width={(shownSelection.right - shownSelection.left) * width}
          height={(shownSelection.bottom - shownSelection.top) * height}
          fill="#3b82f633"
          stroke="#2563eb"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function ItemFields({
  data,
  onChange,
  sheet,
}: {
  data: LegendItemData;
  onChange: (data: LegendItemData) => void;
  sheet: Sheet;
}) {
  const [crop, setCrop] = useState(false);
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <label className="block text-xs">
        Component name
        <Input
          aria-label="Component name"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </label>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-xs">
          Abbreviation
          <Input
            aria-label="Abbreviation"
            value={data.abbreviation}
            onChange={(e) =>
              onChange({ ...data, abbreviation: e.target.value })
            }
          />
        </label>
        <label className="min-w-0 flex-1 text-xs">
          Legend group
          <Input
            aria-label="Legend group"
            value={data.category}
            onChange={(e) => onChange({ ...data, category: e.target.value })}
          />
        </label>
      </div>
      <Button size="sm" variant="outline" onClick={() => setCrop(!crop)}>
        {crop ? "Hide crop editor" : "Adjust symbol"}
      </Button>
      {crop && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            Drag a box around the symbol in this legend row.
          </p>
          <LegendCrop
            sheet={sheet}
            box={data.row}
            selection={data.symbol}
            onSelection={(symbol) => onChange({ ...data, symbol })}
          />
        </div>
      )}
    </div>
  );
}

export function LegendItemsDialog({
  sheetId,
  sourceId,
  onClose,
  onSource,
}: {
  sheetId: string;
  sourceId: string;
  onClose: () => void;
  onSource: (id: string, box: LegendBox) => void;
}) {
  const overview = api.drawingsWorkspace.legendItems.useQuery({ sheetId });
  const scan = api.drawingsWorkspace.scanLegend.useMutation();
  const save = api.drawingsWorkspace.saveLegendItems.useMutation();
  const update = api.drawingsWorkspace.updateLegendItem.useMutation();
  const [sourceSheetId, setSourceSheetId] = useState(sourceId);
  const [scannedSource, setScannedSource] = useState(sourceId);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [tab, setTab] = useState<"saved" | "review">("saved");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    revision: number;
    data: LegendItemData;
  } | null>(null);
  const sheets = overview.data?.sheets ?? [],
    items = overview.data?.items ?? [];
  const source = sheets.find((s) => s.id === scannedSource);
  const canEdit = overview.data?.canEdit ?? false;
  const busy = scan.isPending || save.isPending || update.isPending;
  const filtered = items.filter((i) =>
    [i.data.name, i.data.abbreviation, i.data.category]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const reviewRows = candidates
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      [item.name, item.abbreviation, item.category]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const shown = tab === "review" ? reviewRows : filtered;
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageIndex = Math.min(page, totalPages - 1);
  async function read() {
    setError("");
    setMessage("");
    try {
      const result = await scan.mutateAsync({ sheetId, sourceSheetId });
      setScannedSource(sourceSheetId);
      setCandidates(result.items.map((data) => ({ ...data, selected: true })));
      setTab("review");
      setSearch("");
      setPage(0);
      setMessage(result.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this legend.");
    }
  }
  async function persist() {
    setError("");
    try {
      const result = await save.mutateAsync({
        sheetId,
        sourceSheetId: scannedSource,
        items: candidates.filter((c) => c.selected),
      });
      await overview.refetch();
      setCandidates([]);
      setTab("saved");
      setPage(0);
      setMessage(
        `${result.added} legend items saved.${result.existing ? ` ${result.existing} already saved; your edits were kept.` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save legend items.");
    }
  }
  async function change(
    id: string,
    revision: number,
    data: LegendItemData | null,
  ) {
    setError("");
    try {
      await update.mutateAsync({ sheetId, id, revision, data });
      await overview.refetch();
      setEditing(null);
      setMessage(data ? "Legend item updated." : "Legend item removed.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not change legend item.",
      );
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-full flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Legend Items</DialogTitle>
          <DialogDescription>
            Read symbols from a legend, review their meaning, and save a shared
            reference for this drawing set.
          </DialogDescription>
        </DialogHeader>
        {overview.isLoading && <p role="status">Loading legend items…</p>}
        {(error || overview.error) && (
          <p role="alert" className="text-destructive text-sm">
            {error || overview.error?.message}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            Legend sheet
            <select
              aria-label="Legend sheet"
              value={sourceSheetId}
              disabled={busy}
              onChange={(e) => setSourceSheetId(e.target.value)}
              className="bg-background mt-1 h-10 w-full rounded-md border px-2"
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !sheets.some((s) => s.id === sourceSheetId)}
            onClick={() => void read()}
          >
            {scan.isPending ? "Reading…" : "Read legend"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "saved" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTab("saved");
              setPage(0);
            }}
          >
            Saved ({items.length})
          </Button>
          <Button
            variant={tab === "review" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTab("review");
              setPage(0);
            }}
          >
            Review ({candidates.length})
          </Button>
        </div>
        {message && (
          <p role="status" className="text-muted-foreground text-sm">
            {message}
          </p>
        )}
        <Input
          aria-label="Search legend items"
          placeholder="Search symbols, names or abbreviations"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        {tab === "review" && candidates.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setCandidates((c) => c.map((i) => ({ ...i, selected: true })))
              }
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setCandidates((c) => c.map((i) => ({ ...i, selected: false })))
              }
            >
              Select none
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {!shown.length && !overview.isLoading && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {search
                ? "No matching legend items."
                : tab === "review"
                  ? "Choose a legend sheet and click Read legend."
                  : "No saved symbols yet. Read a legend to get started."}
            </p>
          )}
          {tab === "review" &&
            source &&
            reviewRows
              .slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
              .map(({ item, index }) => {
                const replace = (data: LegendItemData) =>
                  setCandidates((current) =>
                    current.map((c, i) =>
                      i === index ? { ...data, selected: c.selected } : c,
                    ),
                  );
                return (
                  <div key={index} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Include ${item.name}`}
                        checked={item.selected}
                        onChange={(e) =>
                          setCandidates((current) =>
                            current.map((c, i) =>
                              i === index
                                ? { ...c, selected: e.target.checked }
                                : c,
                            ),
                          )
                        }
                      />
                      <LegendCrop sheet={source} box={item.symbol} />
                      <span className="text-muted-foreground text-xs">
                        {source.name}
                      </span>
                    </div>
                    <ItemFields data={item} sheet={source} onChange={replace} />
                  </div>
                );
              })}
          {tab === "saved" &&
            filtered
              .slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
              .map((item) => {
                const sheet = sheets.find((s) => s.id === item.sourceSheetId);
                if (!sheet) return null;
                const active = editing?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <LegendCrop
                        sheet={sheet}
                        box={active ? editing.data.symbol : item.data.symbol}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{item.data.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {[item.data.abbreviation, item.data.category]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <button
                          className="text-primary text-sm underline"
                          onClick={() => {
                            onSource(sheet.id, item.data.row);
                            onClose();
                          }}
                        >
                          View on {sheet.name}
                        </button>
                      </div>
                    </div>
                    {active ? (
                      <>
                        <ItemFields
                          data={editing.data}
                          sheet={sheet}
                          onChange={(data) => setEditing({ ...editing, data })}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy || !editing.data.name.trim()}
                            onClick={() =>
                              void change(
                                item.id,
                                editing.revision,
                                editing.data,
                              )
                            }
                          >
                            Save changes
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      canEdit && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setEditing({
                                id: item.id,
                                revision: item.revision,
                                data: item.data,
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void change(item.id, item.revision, null)
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pageIndex === 0}
              onClick={() => setPage(pageIndex - 1)}
            >
              Previous
            </Button>
            <span className="text-xs">
              {pageIndex + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pageIndex + 1 >= totalPages}
              onClick={() => setPage(pageIndex + 1)}
            >
              Next
            </Button>
          </div>
          {tab === "review" && (
            <Button
              disabled={
                busy ||
                !canEdit ||
                !candidates.some((c) => c.selected) ||
                candidates.some((c) => c.selected && !c.name.trim())
              }
              onClick={() => void persist()}
            >
              {save.isPending
                ? "Saving…"
                : `Save selected (${candidates.filter((c) => c.selected).length})`}
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
