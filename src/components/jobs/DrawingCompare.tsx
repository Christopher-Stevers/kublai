"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  FilesIcon,
  LayersIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import {
  defaultOverlayInk,
  IDENTITY_ALIGNMENT,
  overlayLabel,
} from "~/lib/drawing-overlay-stack";
import type { OverlayInkStyle } from "~/lib/drawing-line-overlay";
import type { DrawingAppearance } from "~/lib/drawing-appearance";
import type { DrawingComparison } from "./DrawingComparisonLayer";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotState } from "~/lib/snapshot-source";
import { useDrawingWheelGroup } from "./DrawingQuickWheel";
import { SegmentedControl } from "~/components/ui/segmented-control";

export type DrawingCompareSheet = {
  id: string;
  name: string;
  imageUrl: string;
  pdf?: { url: string; page: number } | null;
  tiles?: string | null;
};
type Alignment = DrawingComparison["alignment"];

/** A temporary, independently configurable stack; no source drawing is modified. */
export function DrawingCompare({
  first: firstSource,
  second: secondSource,
  additional = [],
  onClose,
  onEditDrawings,
  resolveAssetUrl,
  initialViewport,
  onViewportChange,
  appearance,
  toolControls,
  initialSnapshot,
}: {
  first: DrawingCompareSheet;
  second: DrawingCompareSheet;
  additional?: DrawingCompareSheet[];
  onClose?: () => void;
  onEditDrawings?: () => void;
  resolveAssetUrl?: (url: string) => Promise<string>;
  initialViewport?: DrawingViewport | null;
  onViewportChange?: (value: DrawingViewport) => void;
  appearance?: DrawingAppearance;
  toolControls?: ComponentProps<typeof DrawingSheetViewer>["toolControls"];
  initialSnapshot?: SnapshotState["overlay"];
}) {
  const requested = [firstSource, secondSource, ...additional];
  const sourceKey = JSON.stringify(requested);
  const [resolved, setResolved] = useState<{
    key: string;
    resolver: typeof resolveAssetUrl;
    sheets: DrawingCompareSheet[];
    error?: string;
  } | null>(null);
  const camera = useRef(initialViewport);
  const [entryView, setEntryView] = useState(initialViewport);
  useEffect(() => {
    let cancelled = false;
    if (!resolveAssetUrl) return;
    const sources = JSON.parse(sourceKey) as DrawingCompareSheet[];
    // Shared PDF URLs (different pages of one upload) resolve only once per stack.
    const urls = new Map<string, Promise<string>>();
    const resolve = (url: string) => {
      let pending = urls.get(url);
      if (!pending) {
        pending = resolveAssetUrl(url);
        urls.set(url, pending);
      }
      return pending;
    };
    void Promise.all(
      sources.map(async (sheet) => ({
        ...sheet,
        imageUrl: await resolve(sheet.imageUrl),
        pdf: sheet.pdf
          ? { ...sheet.pdf, url: await resolve(sheet.pdf.url) }
          : sheet.pdf,
      })),
    )
      .then((sheets) => {
        if (!cancelled) {
          setEntryView(camera.current);
          setResolved({ key: sourceKey, resolver: resolveAssetUrl, sheets });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResolved({
            key: sourceKey,
            resolver: resolveAssetUrl,
            sheets: sources,
            error:
              error instanceof Error
                ? error.message
                : "Could not open these saved drawings.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey, resolveAssetUrl]);
  const ready =
    !resolveAssetUrl ||
    (resolved?.key === sourceKey && resolved.resolver === resolveAssetUrl);
  const previousReady = Boolean(
    resolved && resolved.resolver === resolveAssetUrl && !resolved.error,
  );
  const drawings =
    (ready || previousReady) && resolveAssetUrl && resolved
      ? resolved.sheets
      : requested;
  const [first, second] = drawings as [
    DrawingCompareSheet,
    DrawingCompareSheet,
    ...DrawingCompareSheet[],
  ];
  const [wipe, setWipe] = useState(initialSnapshot?.wipe ?? 0.5);
  // Colours, opacity and alignment live in a panel so the drawing keeps the screen.
  const [adjusting, setAdjusting] = useState(false);
  const [requestedMode, setMode] = useState<
    "side-by-side" | DrawingComparison["mode"]
  >(initialSnapshot?.mode ?? "overlay");
  const multi = drawings.length > 2;
  const mode =
    multi && (requestedMode === "side-by-side" || requestedMode === "wipe")
      ? "overlay"
      : requestedMode;
  const [inkState, setInkState] = useState(() => ({
    key: sourceKey,
    values: Object.fromEntries(
      requested.map((sheet, index) => [
        sheet.id,
        initialSnapshot?.inks[sheet.id] ?? defaultOverlayInk(index),
      ]),
    ),
  }));
  // Preserve each drawing's colours when adding, removing or reordering other layers.
  let inks = inkState.values;
  if (inkState.key !== sourceKey) {
    inks = { ...inks };
    requested.forEach((sheet, index) => {
      inks[sheet.id] ??= defaultOverlayInk(index);
    });
    setInkState({ key: sourceKey, values: inks });
  }
  const ink = (sheet: DrawingCompareSheet) => inks[sheet.id]!;
  const changeInk = (id: string, patch: Partial<OverlayInkStyle>) =>
    setInkState((current) => ({
      ...current,
      values: { ...current.values, [id]: { ...current.values[id]!, ...patch } },
    }));
  const [alignments, setAlignments] = useState<Record<string, Alignment>>(
    initialSnapshot?.alignments ?? {},
  );
  const alignmentKey = (id: string) => `${firstSource.id}:${id}`;
  const alignmentFor = (id: string) =>
    alignments[alignmentKey(id)] ?? IDENTITY_ALIGNMENT;
  const [selectedId, setSelectedId] = useState(
    initialSnapshot?.selectedId ?? secondSource.id,
  );
  const selected = drawings.find((sheet) => sheet.id === selectedId) ?? second;
  const alignment = alignmentFor(selected.id);
  const change = (key: keyof Alignment, value: string) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && selected.id !== first.id)
      setAlignments((current) => ({
        ...current,
        [alignmentKey(selected.id)]: { ...alignment, [key]: numeric },
      }));
  };
  const updateViewport = (value: DrawingViewport) => {
    camera.current = value;
    onViewportChange?.(value);
  };
  useSnapshotSource("overlay", () => ({
    ids: requested.map((sheet) => sheet.id),
    mode,
    wipe,
    selectedId: selected.id,
    inks: Object.fromEntries(requested.map((sheet) => [sheet.id, ink(sheet)])),
    alignments: Object.fromEntries(
      requested
        .slice(1)
        .map((sheet) => [alignmentKey(sheet.id), alignmentFor(sheet.id)]),
    ),
  }));
  const configure = multi ? [selected] : drawings;
  const quickWheel = useDrawingWheelGroup({ id: "comparison", title: "Compare drawings", priority: 5, items: [
    ...(onEditDrawings ? [{ id: "choose", label: "Choose Drawings", icon: <FilesIcon />, run: onEditDrawings }] : []),
    { id: "mode", label: "Comparison mode", icon: <LayersIcon />, children: [
      ...([ ["overlay", "Overlay"], ["difference", "Changes"], ["side-by-side", "Side by side"], ["wipe", "Wipe"] ] as const).map(([value, label]) => ({
        id: value, label, selected: mode === value, disabled: multi && (value === "side-by-side" || value === "wipe"),
        run: () => { setEntryView(camera.current); setMode(value); },
      })),
    ] },
    { id: "adjust", label: adjusting ? "Close adjustments" : "Adjust layers", icon: <SlidersHorizontalIcon />, disabled: mode === "side-by-side", run: () => setAdjusting(value => !value) },
    ...(onClose ? [{ id: "close", label: "Close comparison", icon: <XIcon />, run: onClose }] : []),
  ] });
  return (
    <section
      className="relative flex h-full min-h-0 flex-col"
      aria-label="Compare drawings"
    >
      {(!quickWheel || adjusting) && <div
        data-drawing-chrome
        className="absolute inset-x-0 top-0 z-20 max-h-[60dvh] overflow-y-auto overscroll-contain"
      >
        {!quickWheel && <div className="bg-background/95 border-b shadow-sm backdrop-blur">
          <div className="flex h-12 items-center gap-2 px-2">
            <span
              aria-hidden
              className="bg-primary/10 text-primary hidden size-8 shrink-0 place-items-center rounded-lg sm:grid"
            >
              <LayersIcon className="size-4" />
            </span>
            {/* The legend underneath names each drawing. */}
            <span
              className="hidden min-w-0 shrink truncate text-sm font-semibold md:block"
              title={drawings.map((sheet) => sheet.name).join(" / ")}
            >
              Compare
            </span>
            <div className="flex min-w-0 flex-1 md:justify-center">
              <SegmentedControl
                label="Comparison mode"
                value={mode}
                onChange={(value) => {
                  setEntryView(camera.current);
                  setMode(value);
                }}
                options={[
                  { value: "overlay", label: "Overlay" },
                  { value: "difference", label: "Changes" },
                  {
                    value: "side-by-side",
                    label: "Side by side",
                    disabled: multi,
                    title: multi ? "Two drawings only" : undefined,
                  },
                  {
                    value: "wipe",
                    label: "Wipe",
                    disabled: multi,
                    title: multi ? "Two drawings only" : undefined,
                  },
                ]}
              />
            </div>
            {mode !== "side-by-side" && (
              <button
                type="button"
                aria-label="Adjust layers"
                title="Colours, opacity and alignment"
                aria-expanded={adjusting}
                onClick={() => setAdjusting((open) => !open)}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
                  adjusting
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-muted-foreground",
                )}
              >
                <SlidersHorizontalIcon className="size-4" />
              </button>
            )}
            {onEditDrawings && (
              <button
                type="button"
                aria-label="Choose Drawings"
                title="Choose drawings"
                onClick={onEditDrawings}
                className="hover:bg-accent text-muted-foreground grid size-9 shrink-0 place-items-center rounded-full"
              >
                <FilesIcon className="size-4" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                aria-label="Close comparison"
                title="Close comparison"
                onClick={onClose}
                className="hover:bg-accent text-muted-foreground -mr-0.5 grid size-9 shrink-0 place-items-center rounded-full"
              >
                <XIcon className="size-5" />
              </button>
            )}
          </div>
          {!ready && previousReady && (
            <p
              role="status"
              className="text-muted-foreground px-3 pb-2 text-xs"
            >
              Opening added drawings…
            </p>
          )}
          {(mode === "overlay" || mode === "difference") && (
            <div className="text-muted-foreground flex items-center gap-x-3 overflow-x-auto px-3 pb-2 text-xs whitespace-nowrap [scrollbar-width:none]">
              {drawings.map((sheet, index) => (
                <span
                  key={sheet.id}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{
                      background:
                        mode === "overlay"
                          ? ink(sheet).color
                          : defaultOverlayInk(index).color,
                    }}
                  />
                  {sheet.name}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="bg-foreground size-2.5 rounded-full"
                />
                Shared lines
              </span>
            </div>
          )}
          {mode === "wipe" && (
            <label className="text-muted-foreground flex items-center gap-3 px-3 pb-2 text-xs">
              <span className="truncate">{first.name}</span>
              <input
                aria-label="Wipe position"
                className="accent-primary min-w-0 flex-1"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={wipe}
                onChange={(event) => setWipe(Number(event.target.value))}
              />
              <span className="truncate">{second.name}</span>
            </label>
          )}
        </div>}
        {adjusting && mode !== "side-by-side" && (
          <div className="bg-card mx-2 mt-2 space-y-4 rounded-xl border p-3 shadow-lg">
            {quickWheel && mode === "wipe" && <label className="flex items-center gap-3 text-sm">
              Wipe position
              <input aria-label="Wipe position" type="range" min="0" max="1" step="0.01" value={wipe} onChange={event => setWipe(Number(event.target.value))} className="accent-primary min-w-0 flex-1" />
            </label>}
            {multi && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Adjusting</span>
                <select
                  aria-label="Overlay drawing"
                  className="bg-muted h-9 max-w-64 min-w-0 rounded-full border-0 pr-7 pl-3 text-sm font-medium"
                  value={selected.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {drawings.map((sheet, index) => (
                    <option key={sheet.id} value={sheet.id}>
                      {overlayLabel(index)} · {sheet.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === "overlay" && (
              <div className="space-y-2">
                {configure.map((drawing) => {
                  const label = overlayLabel(drawings.indexOf(drawing)),
                    style = ink(drawing);
                  return (
                    <div key={drawing.id} className="flex items-center gap-3">
                      <span className="relative size-8 shrink-0 overflow-hidden rounded-full border shadow-sm">
                        <input
                          type="color"
                          aria-label={`${label} colour`}
                          value={style.color}
                          onChange={(event) =>
                            changeInk(drawing.id, { color: event.target.value })
                          }
                          className="absolute -inset-2 size-12 cursor-pointer border-0 p-0"
                        />
                      </span>
                      <span
                        className="w-20 shrink-0 truncate text-sm font-medium"
                        title={`${label} · ${drawing.name}`}
                      >
                        {drawing.name}
                      </span>
                      <input
                        aria-label={`${label} opacity`}
                        className="accent-primary min-w-0 flex-1"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={style.opacity}
                        onChange={(event) =>
                          changeInk(drawing.id, {
                            opacity: Number(event.target.value),
                          })
                        }
                      />
                      <output className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                        {Math.round(style.opacity * 100)}%
                      </output>
                    </div>
                  );
                })}
              </div>
            )}
            {selected.id === first.id ? (
              <p className="text-muted-foreground text-xs">
                {first.name} anchors the stack. Choose another drawing to align
                it.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Align {selected.name}
                  </span>
                  <button
                    type="button"
                    className="text-primary hover:bg-primary/10 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium"
                    onClick={() =>
                      setAlignments((current) => ({
                        ...current,
                        [alignmentKey(selected.id)]: IDENTITY_ALIGNMENT,
                      }))
                    }
                  >
                    <RotateCcwIcon className="size-3.5" />
                    Reset alignment
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["x", "Horizontal alignment", "Left / right", -100, 100],
                      ["y", "Vertical alignment", "Up / down", -100, 100],
                      ["scale", "Comparison scale", "Scale", 25, 400],
                    ] as const
                  ).map(([key, aria, caption, min, max]) => (
                    <label key={key} className="space-y-1">
                      <span className="text-muted-foreground block text-[11px]">
                        {caption}
                      </span>
                      <span className="bg-background focus-within:ring-ring flex h-9 items-center rounded-lg border pr-2 focus-within:ring-2">
                        <input
                          aria-label={aria}
                          className="w-full min-w-0 bg-transparent px-2 text-sm tabular-nums outline-none"
                          type="number"
                          min={min}
                          max={max}
                          step="0.1"
                          value={alignment[key] * 100}
                          onChange={(event) => {
                            const percent = Number(event.target.value);
                            change(
                              key,
                              String(
                                key === "scale"
                                  ? Math.max(0.25, Math.min(4, percent / 100))
                                  : Math.max(-1, Math.min(1, percent / 100)),
                              ),
                            );
                          }}
                        />
                        <span className="text-muted-foreground text-xs">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>}
      {!ready && !previousReady ? (
        <p role="status" className="p-3">
          Opening comparison…
        </p>
      ) : resolved?.key === sourceKey &&
        resolved.resolver === resolveAssetUrl &&
        resolved.error ? (
        <p role="alert" className="p-3">
          {resolved.error}
        </p>
      ) : mode === "side-by-side" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-1">
          {[first, second].map((sheet) => (
            <div key={sheet.id} className="flex min-h-0 flex-col">
              <p className="truncate p-1 text-center text-xs">{sheet.name}</p>
              <div className="min-h-0 flex-1">
                <DrawingSheetViewer
                  toolControls={
                    sheet.id === first.id
                      ? toolControls
                      : toolControls
                        ? { measureRequest: 0, pipeRequest: 0 }
                        : undefined
                  }
                  appearance={appearance}
                  src={sheet.imageUrl}
                  initialViewport={entryView}
                  onViewportChange={
                    sheet.id === first.id ? updateViewport : undefined
                  }
                  alt={sheet.name}
                  pdf={sheet.pdf}
                  tiles={sheet.tiles}
                  sheetKey={sheet.id}
                  resolveAssetUrl={resolveAssetUrl}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <DrawingSheetViewer
            toolControls={toolControls}
            appearance={appearance}
            src={first.imageUrl}
            initialViewport={entryView}
            onViewportChange={updateViewport}
            alt={first.name}
            pdf={first.pdf}
            tiles={first.tiles}
            sheetKey={first.id}
            resolveAssetUrl={resolveAssetUrl}
            comparison={{
              src: second.imageUrl,
              pdf: second.pdf,
              mode,
              opacity: ink(second).opacity,
              primaryInk: ink(first),
              secondaryInk: ink(second),
              wipe,
              alignment: alignmentFor(second.id),
              additional: drawings.slice(2).map((sheet, index) => ({
                src: sheet.imageUrl,
                pdf: sheet.pdf,
                ink:
                  mode === "difference"
                    ? defaultOverlayInk(index + 2)
                    : ink(sheet),
                alignment: alignmentFor(sheet.id),
              })),
            }}
          />
        </div>
      )}
    </section>
  );
}
