"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
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
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Compare drawings"
    >
      <div
        data-drawing-chrome
        className="bg-background max-h-[40dvh] shrink-0 overflow-y-auto overscroll-contain border-b p-2"
      >
        {!ready && previousReady && (
          <p role="status" className="text-muted-foreground text-xs">
            Opening added drawings…
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="min-w-0 truncate text-sm font-medium"
            title={drawings.map((sheet) => sheet.name).join(" / ")}
          >
            {multi
              ? `${first.name} + ${drawings.length - 1} drawings`
              : `${first.name} / ${second.name}`}
          </span>
          <label className="text-sm">
            Comparison{" "}
            <select
              aria-label="Comparison mode"
              className="bg-background rounded border p-1"
              value={mode}
              onChange={(event) => {
                setEntryView(camera.current);
                setMode(event.target.value as typeof mode);
              }}
            >
              <option value="side-by-side" disabled={multi}>
                Side by side{multi ? " (two drawings)" : ""}
              </option>
              <option value="overlay">Overlay</option>
              <option value="difference">Red / blue changes</option>
              <option value="wipe" disabled={multi}>
                Wipe{multi ? " (two drawings)" : ""}
              </option>
            </select>
          </label>
          {onEditDrawings && (
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={onEditDrawings}
            >
              Add / remove drawings
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="ml-auto rounded border px-3 py-1"
              onClick={onClose}
            >
              Close comparison
            </button>
          )}
        </div>
        {mode !== "side-by-side" && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {multi && (
              <label>
                Overlay drawing{" "}
                <select
                  aria-label="Overlay drawing"
                  className="bg-background max-w-64 rounded border p-1"
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
              <>
                {configure.map((drawing) => {
                  const index = drawings.indexOf(drawing),
                    label = overlayLabel(index),
                    style = ink(drawing);
                  return (
                    <fieldset
                      key={drawing.id}
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded border px-2 py-1"
                    >
                      <legend
                        className="max-w-56 truncate px-1 text-xs"
                        title={drawing.name}
                      >
                        {label} · {drawing.name}
                      </legend>
                      <label className="flex items-center gap-1">
                        Colour{" "}
                        <input
                          type="color"
                          aria-label={`${label} colour`}
                          value={style.color}
                          onChange={(event) =>
                            changeInk(drawing.id, { color: event.target.value })
                          }
                          className="h-8 w-10 rounded border bg-transparent p-0.5"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        Opacity{" "}
                        <input
                          aria-label={`${label} opacity`}
                          className="w-24"
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
                        <output className="w-9 text-right tabular-nums">
                          {Math.round(style.opacity * 100)}%
                        </output>
                      </label>
                    </fieldset>
                  );
                })}
                <p className="text-muted-foreground text-xs">
                  Matching lines are black. Each drawing has its own colour,
                  opacity and alignment.
                </p>
              </>
            )}
            {mode === "wipe" && (
              <label>
                Reveal{" "}
                <input
                  aria-label="Wipe position"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={wipe}
                  onChange={(event) => setWipe(Number(event.target.value))}
                />
              </label>
            )}
            {mode === "difference" && (
              <p className="w-full text-xs">
                {drawings.map((sheet, index) => (
                  <span
                    key={sheet.id}
                    style={{ color: defaultOverlayInk(index).color }}
                  >
                    {sheet.name}
                    {index === drawings.length - 1 ? "" : " · "}
                  </span>
                ))}{" "}
                · common lines are black
              </p>
            )}
            {selected.id === first.id ? (
              <p className="text-muted-foreground text-xs">
                Drawing A anchors the stack. Select another drawing to adjust
                its alignment.
              </p>
            ) : (
              <>
                <label>
                  Horizontal %{" "}
                  <input
                    aria-label="Horizontal alignment"
                    className="bg-background w-20 rounded border p-1"
                    type="number"
                    min="-100"
                    max="100"
                    step="0.1"
                    value={alignment.x * 100}
                    onChange={(event) =>
                      change(
                        "x",
                        String(
                          Math.max(
                            -1,
                            Math.min(1, Number(event.target.value) / 100),
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Vertical %{" "}
                  <input
                    aria-label="Vertical alignment"
                    className="bg-background w-20 rounded border p-1"
                    type="number"
                    min="-100"
                    max="100"
                    step="0.1"
                    value={alignment.y * 100}
                    onChange={(event) =>
                      change(
                        "y",
                        String(
                          Math.max(
                            -1,
                            Math.min(1, Number(event.target.value) / 100),
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Scale %{" "}
                  <input
                    aria-label="Comparison scale"
                    className="bg-background w-20 rounded border p-1"
                    type="number"
                    min="25"
                    max="400"
                    step="0.1"
                    value={alignment.scale * 100}
                    onChange={(event) =>
                      change(
                        "scale",
                        String(
                          Math.max(
                            0.25,
                            Math.min(4, Number(event.target.value) / 100),
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() =>
                    setAlignments((current) => ({
                      ...current,
                      [alignmentKey(selected.id)]: IDENTITY_ALIGNMENT,
                    }))
                  }
                >
                  Reset alignment
                </button>
              </>
            )}
          </div>
        )}
      </div>
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
