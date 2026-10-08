"use client";

import { useId, useState, type PointerEvent } from "react";
import { CheckIcon, ChevronDownIcon, RulerIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LENGTH_UNITS, type LengthUnit } from "~/lib/sheet-measure";
import { MEASURE_COLORS, measureColorHalo } from "~/lib/sheet-measure-color";

/**
 * Controls for tracing a distance on a drawing.
 * Pointer events stop here so a tap on a button is not another point on the sheet.
 */
export function SheetMeasureBar({
  measuring,
  calibrating,
  pointCount,
  calibrationCount,
  total,
  unit,
  scaleSet,
  snapping,
  draft,
  error,
  reading,
  scaleLabel,
  readError,
  onToggle,
  onUndo,
  onClear,
  onStartScale,
  onReadPrinted,
  onCancelScale,
  onDraft,
  onUnit,
  onApply,
  color,
  onColor,
  pipeControl,
  pipePanel,
}: {
  measuring: boolean;
  calibrating: boolean;
  pointCount: number;
  calibrationCount: number;
  total: string | null;
  unit: LengthUnit;
  scaleSet: boolean;
  /** Lines were read from this drawing, so a tap can land on one. */
  snapping?: boolean;
  draft: string;
  error: string | null;
  /** The printed scale is being read off this drawing. */
  reading?: boolean;
  /** The scale as printed, once it has been read. */
  scaleLabel?: string | null;
  /** Why the printed scale could not be used. */
  readError?: string | null;
  onToggle: () => void;
  onUndo: () => void;
  onClear: () => void;
  /** Set the scale from two ends of a known length. */
  onStartScale: () => void;
  /** Read the scale printed on the drawing (PDF sheets only). */
  onReadPrinted?: () => void;
  onCancelScale: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: LengthUnit) => void;
  onApply: () => void;
  color: string;
  onColor: (color: string) => void;
  pipeControl?: React.ReactNode;
  pipePanel?: React.ReactNode;
}) {
  const stop = (event: PointerEvent) => event.stopPropagation();
  return (
    <>
      <div
        className="absolute top-2 right-2 z-20 flex w-[min(17rem,calc(100%-1rem))] flex-col items-stretch gap-2"
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-end gap-2">
          {pipeControl}
          <Button
            type="button"
            variant={measuring ? "default" : "outline"}
            className="self-end shadow-md"
            aria-pressed={measuring}
            onClick={onToggle}
          >
            <RulerIcon className="h-4 w-4" />
            {measuring ? "Done" : "Measure"}
          </Button>
        </div>
        {measuring && (
          <div className="bg-card/95 max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain rounded-md p-3 shadow-md">
            {calibrating ? (
              <Calibration
                count={calibrationCount}
                unit={unit}
                snapping={snapping}
                draft={draft}
                error={error}
                reading={reading}
                readError={readError}
                onUndo={onUndo}
                onCancel={onCancelScale}
                onDraft={onDraft}
                onUnit={onUnit}
                onApply={onApply}
                onReadPrinted={onReadPrinted}
              />
            ) : (
              <Tracing
                pointCount={pointCount}
                total={total}
                unit={unit}
                scaleSet={scaleSet}
                snapping={snapping}
                reading={reading}
                scaleLabel={scaleLabel}
                readError={readError}
                onUndo={onUndo}
                onClear={onClear}
                onStartScale={onStartScale}
                onUnit={onUnit}
              />
            )}
            <MeasureColorPicker color={color} onColor={onColor} />
          </div>
        )}
      </div>
      {!measuring && pipePanel && (
        <div
          className="absolute right-2 bottom-2 z-20 w-[min(17rem,calc(100%-1rem))] sm:top-14 sm:bottom-auto"
          onPointerDown={stop}
          onPointerMove={stop}
          onPointerUp={stop}
          onWheel={(event) => event.stopPropagation()}
        >
          {pipePanel}
        </div>
      )}
    </>
  );
}

function MeasureColorPicker({ color, onColor }: { color: string; onColor: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const name = MEASURE_COLORS.find((item) => item.value === color)?.name ?? "Custom";
  return (
    <div className="border-t pt-2">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 text-sm"
        aria-label={`Measuring color: ${name}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="h-5 w-5 rounded-full border border-current/30" style={{ backgroundColor: color }} />
        <span>Color</span>
        <span className="text-muted-foreground ml-auto text-xs">{name}</span>
        <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={id} className="space-y-2 pt-1">
          <div role="group" aria-label="Measuring colors" className="grid grid-cols-5 gap-1">
            {MEASURE_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-label={item.name}
                aria-pressed={color === item.value}
                title={item.name}
                className="flex h-11 items-center justify-center rounded-md border border-current/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                style={{ backgroundColor: item.value, color: measureColorHalo(item.value) }}
                onClick={() => { onColor(item.value); setOpen(false); }}
              >
                {color === item.value && <CheckIcon aria-hidden="true" className="h-5 w-5" />}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            Custom color
            <input
              type="color"
              aria-label="Custom measuring color"
              value={color}
              onChange={(event) => onColor(event.target.value)}
              className="h-10 w-12 cursor-pointer rounded border bg-transparent p-0.5"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function UnitToggle({
  unit,
  onUnit,
}: {
  unit: LengthUnit;
  onUnit: (unit: LengthUnit) => void;
}) {
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label="Units">
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
  );
}

function traceStatus(
  pointCount: number,
  scaleSet: boolean,
  snapping: boolean | undefined,
  scaleLabel: string | null | undefined,
): string {
  if (pointCount === 0) {
    const base = snapping
      ? "Tap each point along the path. Points snap onto lines and lock at 45° or 90°."
      : "Tap each point along the path. Angles lock at 45° or 90°.";
    return scaleLabel ? `${base} ${scaleLabel}.` : base;
  }
  const count = `${pointCount} ${pointCount === 1 ? "point" : "points"}.`;
  if (!scaleSet) return `${count} Tap Set Scale to see the distance.`;
  return scaleLabel ? `${count} ${scaleLabel}.` : count;
}

function Tracing({
  pointCount,
  total,
  unit,
  scaleSet,
  snapping,
  reading,
  scaleLabel,
  readError,
  onUndo,
  onClear,
  onStartScale,
  onUnit,
}: {
  pointCount: number;
  total: string | null;
  unit: LengthUnit;
  scaleSet: boolean;
  snapping?: boolean;
  reading?: boolean;
  scaleLabel?: string | null;
  readError?: string | null;
  onUndo: () => void;
  onClear: () => void;
  onStartScale: () => void;
  onUnit: (unit: LengthUnit) => void;
}) {
  return (
    <>
      {total && !reading ? (
        <p role="status" className="text-xl font-semibold tabular-nums">
          {total}
        </p>
      ) : (
        <p role="status" className="text-sm">
          {reading
            ? "Reading the scale on this drawing."
            : traceStatus(pointCount, scaleSet, snapping, scaleLabel)}
        </p>
      )}
      {total && !reading && (
        <p className="text-muted-foreground text-xs">Total along the points · Drag a point to adjust</p>
      )}
      {total && !reading && scaleLabel && (
        <p className="text-muted-foreground text-xs">{scaleLabel}</p>
      )}
      {!scaleSet && pointCount === 0 && !readError && !reading && (
        <p className="text-muted-foreground text-xs">
          Tap Set Scale and mark a length you know, so the total is a real
          distance.
        </p>
      )}
      {readError && !reading && (
        <p className="text-destructive text-xs">{readError}</p>
      )}
      {scaleSet && <UnitToggle unit={unit} onUnit={onUnit} />}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pointCount === 0}
          onClick={onUndo}
        >
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pointCount === 0}
          onClick={onClear}
        >
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reading}
          onClick={onStartScale}
        >
          Set Scale
        </Button>
      </div>
    </>
  );
}

function Calibration({
  count,
  unit,
  snapping,
  draft,
  error,
  reading,
  readError,
  onUndo,
  onCancel,
  onDraft,
  onUnit,
  onApply,
  onReadPrinted,
}: {
  count: number;
  unit: LengthUnit;
  snapping?: boolean;
  draft: string;
  error: string | null;
  reading?: boolean;
  readError?: string | null;
  onUndo: () => void;
  onCancel: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: LengthUnit) => void;
  onApply: () => void;
  onReadPrinted?: () => void;
}) {
  return (
    <>
      <p role="status" className="text-sm">
        {reading
          ? "Reading the scale on this drawing."
          : count === 0
            ? snapping
              ? "Set Scale: tap one end of a length you know. It snaps onto a line."
              : "Set Scale: tap one end of a length you know."
            : count === 1
              ? "Tap the other end. It snaps to lines, and locks square or at 45° when close."
              : "How long is this line?"}
      </p>
      {count >= 2 && (
        <>
          <Input
            autoFocus
            aria-label="How long is this line?"
            inputMode="decimal"
            placeholder={unit === "ft" ? "24'6\"" : unit === "in" ? "18" : unit === "mm" ? "7500" : "7.5"}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApply();
              }
            }}
          />
          <UnitToggle unit={unit} onUnit={onUnit} />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Button
            type="button"
            size="sm"
            disabled={!draft.trim()}
            onClick={onApply}
          >
            Use this length
          </Button>
        </>
      )}
      {readError && !reading && <p className="text-destructive text-xs">{readError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={count === 0}
          onClick={onUndo}
        >
          Undo
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {onReadPrinted && count === 0 && (
        <button
          type="button"
          className="text-primary text-left text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50"
          disabled={reading}
          onClick={onReadPrinted}
        >
          Read the scale printed on this drawing instead
        </button>
      )}
    </>
  );
}
