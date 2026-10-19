"use client";

import { useId, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { LENGTH_UNITS, type LengthUnit } from "~/lib/sheet-measure";
import { PIPE_SYSTEM_NAMES } from "~/lib/pipe-system";
import { StyleStrip } from "./StyleStrip";
import { LINE_WIDTHS, MEASURE_COLORS } from "~/lib/sheet-measure-color";
import { useDrawingWheelGroup } from "./DrawingQuickWheel";

export function PipeSystemPanel({
  reading,
  selecting = false,
  error,
  hasPdf,
  hasLines,
  ready,
  codes,
  system,
  selectedSystem,
  wholeSystem = false,
  hasLayerSystems = false,
  total,
  selected,
  partial,
  warnings,
  unit,
  scaleSet,
  canSetScale,
  onSystem,
  onClear,
  onRetry,
  onScale,
  onUnit,
  onDone,
  onComponents,
  color, onColor, lineWidth, onLineWidth,
}: {
  color: string;
  onColor: (color: string) => void;
  lineWidth: number;
  onLineWidth: (width: number) => void;
  reading: boolean;
  selecting?: boolean;
  error: string | null;
  hasPdf: boolean;
  hasLines: boolean;
  ready: boolean;
  codes: string[];
  system: string;
  selectedSystem?: string | null;
  wholeSystem?: boolean;
  hasLayerSystems?: boolean;
  total: string | null;
  selected: boolean;
  partial: boolean;
  warnings: string[];
  unit: LengthUnit;
  scaleSet: boolean;
  canSetScale: boolean;
  onSystem: (value: string) => void;
  onClear: () => void;
  onRetry: () => void;
  onScale: () => void;
  onUnit: (value: LengthUnit) => void;
  onDone?: () => void;
  onComponents?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const optionsId = useId();
  const quickWheel = useDrawingWheelGroup({ id: "pipe", title: "Pipe system", priority: 20, items: [
    ...(onDone ? [{ id: "done", label: "Done", run: onDone }] : []),
    { id: "systems", label: "Choose system", disabled: codes.length === 0, children: [
      { id: "connected", label: "Tap a pipe", selected: !system, run: () => onSystem("") },
      ...codes.map(code => ({ id: code, label: PIPE_SYSTEM_NAMES[code] ?? code, selected: system === code, run: () => onSystem(code) })),
    ] },
    { id: "color", label: "Color", children: MEASURE_COLORS.map(option => ({ id: option.value, label: option.name, selected: color === option.value, run: () => onColor(option.value) })) },
    { id: "width", label: "Line width", children: LINE_WIDTHS.map(value => ({ id: String(value), label: String(value), selected: lineWidth === value, run: () => onLineWidth(value) })) },
    ...(onComponents ? [{ id: "components", label: "Fittings & valves", disabled: !selected, run: onComponents }] : []),
    { id: "clear", label: "Clear selection", disabled: !selected, run: onClear },
    { id: "scale", label: "Set scale", disabled: !canSetScale, run: onScale },
    { id: "units", label: "Units", children: LENGTH_UNITS.map(option => ({ id: option.value, label: option.label, selected: unit === option.value, run: () => onUnit(option.value) })) },
    { id: "retry", label: "Try again", disabled: !error || !hasPdf, run: onRetry },
  ] });
  if (quickWheel) return <div className="pointer-events-none absolute top-14 left-3 z-20 max-w-72 rounded-xl bg-card/90 px-3 py-2 text-sm shadow-sm backdrop-blur-sm" role="status">
    {reading ? "Reading pipe lines…" : selecting ? "Selecting pipe lines…" : selected ? total ?? "Set scale to see distance" : "Tap a pipe or choose a system"}
    {selectedSystem && <p className="text-muted-foreground text-xs">{PIPE_SYSTEM_NAMES[selectedSystem] ?? selectedSystem}</p>}
    {error && <p className="text-destructive text-xs">{error}</p>}
    {warnings.length > 0 && <p className="text-muted-foreground text-xs">{warnings.join(" · ")}</p>}
  </div>;
  const systemControl = codes.length > 0 && (
    <label className="flex items-center gap-2 text-xs">
      System
      <select
        aria-label="Pipe system"
        className="bg-background min-w-0 flex-1 rounded border px-2 py-1"
        value={system}
        onChange={(event) => onSystem(event.target.value)}
      >
        <option value="">Tap a pipe</option>
        {codes.map((code) => (
          <option key={code} value={code}>
            {PIPE_SYSTEM_NAMES[code] ? `${PIPE_SYSTEM_NAMES[code]} (${code})` : code}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section
      aria-label="Pipe system selection"
      aria-busy={reading || selecting}
      className="bg-card/95 max-h-[55dvh] space-y-2 overflow-y-auto overscroll-contain rounded-md p-3 shadow-md"
    >
      <div className="flex items-center gap-2">
        <p className="mr-auto text-sm font-medium">
          {selected
            ? selectedSystem
              ? PIPE_SYSTEM_NAMES[selectedSystem] ?? `${selectedSystem} system`
              : "Unclassified linework"
            : "Select a pipe system"}
        </p>
        {selected && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="sm:hidden"
              aria-label="Pipe options"
              aria-expanded={expanded}
              aria-controls={optionsId}
              onClick={() => setExpanded((value) => !value)}
            >
              Options
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear selection"
              title="Clear selection"
              onClick={() => {
                setExpanded(false);
                onClear();
              }}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      <StyleStrip color={color} onColor={onColor} colorLabel="Pipe colors" customColorLabel="Custom pipe color" width={lineWidth} onWidth={onLineWidth} widthLabel="Pipe line width" />
      {systemControl}
      {selected && onComponents && <Button size="sm" variant="outline" onClick={onComponents}>Fittings & valves</Button>}
      {selecting && <p role="status" className="text-muted-foreground text-xs">Selecting pipe lines…</p>}
      {!hasPdf ? (
        <p className="text-muted-foreground text-xs">
          Upload the original vector PDF to select connected pipes. For a
          scanned drawing, use Measure to trace the run.
        </p>
      ) : reading ? (
        <p role="status" className="text-muted-foreground text-xs">
          Reading pipe lines…
        </p>
      ) : ready && !hasLines ? (
        <p className="text-muted-foreground text-xs">
          This page has no selectable vector pipe lines. Use Measure to trace
          the run.
        </p>
      ) : selected ? (
        <>
          <div
            role="status"
            aria-label="Pipe total distance"
            className="space-y-1"
          >
            <span className="text-muted-foreground block text-xs">
              {partial ? "Partial distance" : wholeSystem ? "Highlighted line length" : "Total distance"} · this sheet
            </span>
            <strong className="block text-xl tabular-nums">
              {total ?? "Set scale to see distance"}
            </strong>
          </div>
          {!selectedSystem && (
            <p className="text-muted-foreground text-xs">
              System not identified. Tap a pipe or choose its system in Options.
            </p>
          )}
          {!scaleSet && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canSetScale}
              onClick={onScale}
            >
              Set scale
            </Button>
          )}
          {!scaleSet && !canSetScale && (
            <p className="text-muted-foreground text-xs">
              Ask a drawing manager to set this sheet’s scale.
            </p>
          )}
          <div
            id={optionsId}
            className={expanded ? "space-y-2" : "hidden space-y-2 sm:block"}
          >
            <div
              role="group"
              aria-label="Pipe distance units"
              className="flex rounded-md border p-0.5"
            >
              {LENGTH_UNITS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={unit === value}
                  className={`h-8 flex-1 rounded-sm text-sm ${unit === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  onClick={() => onUnit(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {warnings.length > 0 && (
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer">
                  Check highlighted run
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            {scaleSet && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canSetScale}
                onClick={onScale}
              >
                Set scale
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {hasLayerSystems ? "Tap a pipe or choose a system to highlight its source system on this sheet." : "Tap a pipe or its system label to highlight the connected run and branches."}
          </p>
        </>
      )}
      {error && (
        <div role="alert" className="space-y-1 text-xs">
          <p>{error}</p>
          {!ready && hasPdf && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
