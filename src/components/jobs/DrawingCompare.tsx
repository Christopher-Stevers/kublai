"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import { DEFAULT_OVERLAY_STYLES } from "~/lib/drawing-line-overlay";
import type { DrawingAppearance } from "~/lib/drawing-appearance";
import type { DrawingComparison } from "./DrawingComparisonLayer";

export type DrawingCompareSheet = {
  id: string;
  name: string;
  imageUrl: string;
  pdf?: { url: string; page: number } | null;
  tiles?: string | null;
};

/** The comparison is a temporary view; alignment never modifies either source. */
export function DrawingCompare({
  first: firstSource,
  second: secondSource,
  onClose,
  resolveAssetUrl,
  initialViewport,
  onViewportChange,
  appearance,
  toolControls,
}: {
  first: DrawingCompareSheet;
  second: DrawingCompareSheet;
  onClose?: () => void;
  resolveAssetUrl?: (url: string) => Promise<string>;
  initialViewport?: DrawingViewport | null;
  onViewportChange?: (value: DrawingViewport) => void;
  appearance?: DrawingAppearance;
  toolControls?: ComponentProps<typeof DrawingSheetViewer>["toolControls"];
}) {
  const sourceKey = JSON.stringify([firstSource, secondSource]);
  const [resolved, setResolved] = useState<{
    key: string;
    resolver: typeof resolveAssetUrl;
    first: DrawingCompareSheet;
    second: DrawingCompareSheet;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!resolveAssetUrl) return;
    const [first, second] = JSON.parse(sourceKey) as [
      DrawingCompareSheet,
      DrawingCompareSheet,
    ];
    const prepare = async (sheet: DrawingCompareSheet) => ({
      ...sheet,
      imageUrl: await resolveAssetUrl(sheet.imageUrl),
      pdf: sheet.pdf
        ? { ...sheet.pdf, url: await resolveAssetUrl(sheet.pdf.url) }
        : sheet.pdf,
    });
    void Promise.all([prepare(first), prepare(second)])
      .then(([a, b]) => {
        if (!cancelled)
          setResolved({
            key: sourceKey,
            resolver: resolveAssetUrl,
            first: a,
            second: b,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResolved({
            key: sourceKey,
            resolver: resolveAssetUrl,
            first,
            second,
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
  const first =
    ready && resolveAssetUrl && resolved ? resolved.first : firstSource;
  const second =
    ready && resolveAssetUrl && resolved ? resolved.second : secondSource;
  const [mode, setMode] = useState<"side-by-side" | DrawingComparison["mode"]>(
    "overlay",
  );
  const [inks, setInks] = useState(DEFAULT_OVERLAY_STYLES);
  const camera = useRef(initialViewport);
  const [entryView, setEntryView] = useState(initialViewport);
  const updateViewport = (value: DrawingViewport) => {
    camera.current = value;
    onViewportChange?.(value);
  };
  const [wipe, setWipe] = useState(0.5);
  const alignmentKey = `${firstSource.id}:${secondSource.id}`;
  const [alignmentState, setAlignment] = useState({
    key: alignmentKey,
    value: { x: 0, y: 0, scale: 1 },
  });
  const alignment =
    alignmentState.key === alignmentKey
      ? alignmentState.value
      : { x: 0, y: 0, scale: 1 };
  const change = (key: keyof typeof alignment, value: string) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric))
      setAlignment({
        key: alignmentKey,
        value: { ...alignment, [key]: numeric },
      });
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Compare drawings"
    >
      <div data-drawing-chrome className="bg-background flex flex-wrap items-center gap-2 border-b p-2">
        <span className="text-sm font-medium">
          {first.name} / {second.name}
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
            <option value="side-by-side">Side by side</option>
            <option value="overlay">Overlay</option>
            <option value="difference">Red / blue changes</option>
            <option value="wipe">Wipe</option>
          </select>
        </label>
        {onClose && (
          <button
            type="button"
            className="ml-auto rounded border px-3 py-1"
            onClick={onClose}
          >
            Close comparison
          </button>
        )}
        {mode !== "side-by-side" && (
          <div className="flex w-full flex-wrap items-center gap-3 text-sm">
            {mode === "overlay" && (
              <>
                {[first, second].map((drawing, index) => {
                  const slot = index === 0 ? 0 : 1;
                  const label = index === 0 ? "Drawing A" : "Drawing B";
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
                          value={inks[slot].color}
                          onChange={(event) =>
                            setInks(
                              (current) =>
                                current.map((style, at) =>
                                  at === slot
                                    ? { ...style, color: event.target.value }
                                    : style,
                                ) as typeof current,
                            )
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
                          value={inks[slot].opacity}
                          onChange={(event) =>
                            setInks(
                              (current) =>
                                current.map((style, at) =>
                                  at === slot
                                    ? {
                                        ...style,
                                        opacity: Number(event.target.value),
                                      }
                                    : style,
                                ) as typeof current,
                            )
                          }
                        />
                        <output className="w-9 text-right tabular-nums">
                          {Math.round(inks[slot].opacity * 100)}%
                        </output>
                      </label>
                    </fieldset>
                  );
                })}
                <p className="text-muted-foreground text-xs">
                  Matching lines are black. Align the drawings below if their
                  positions differ.
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
              <span>
                <span className="text-red-600">First sheet</span> ·{" "}
                <span className="text-blue-600">Second sheet</span> · common
                lines are black
              </span>
            )}
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
                setAlignment({
                  key: alignmentKey,
                  value: { x: 0, y: 0, scale: 1 },
                })
              }
            >
              Reset alignment
            </button>
          </div>
        )}
      </div>
      {!ready ? (
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
              opacity: inks[1].opacity,
              primaryInk: inks[0],
              secondaryInk: inks[1],
              wipe,
              alignment,
            }}
          />
        </div>
      )}
    </section>
  );
}
