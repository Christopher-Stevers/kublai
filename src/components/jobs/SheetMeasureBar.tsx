"use client";

import type { PointerEvent } from "react";
import { RulerIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { MeasureUnit } from "~/lib/sheet-measure";

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
  onFromLength,
  onCancelScale,
  onDraft,
  onUnit,
  onApply,
}: {
  measuring: boolean;
  calibrating: boolean;
  pointCount: number;
  calibrationCount: number;
  total: string | null;
  unit: MeasureUnit;
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
  onStartScale: () => void;
  onFromLength: () => void;
  onCancelScale: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: MeasureUnit) => void;
  onApply: () => void;
}) {
  const stop = (event: PointerEvent) => event.stopPropagation();
  return (
    <div
      className="absolute top-2 right-2 z-20 flex w-[min(17rem,calc(100%-1rem))] flex-col items-stretch gap-2"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
    >
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
      {measuring && (
        <div className="bg-card/95 space-y-2 rounded-md p-3 shadow-md">
          {calibrating ? (
            <Calibration
              count={calibrationCount}
              unit={unit}
              snapping={snapping}
              draft={draft}
              error={error}
              onUndo={onUndo}
              onCancel={onCancelScale}
              onDraft={onDraft}
              onUnit={onUnit}
              onApply={onApply}
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
              onFromLength={onFromLength}
              onUnit={onUnit}
            />
          )}
        </div>
      )}
    </div>
  );
}

function UnitToggle({
  unit,
  onUnit,
}: {
  unit: MeasureUnit;
  onUnit: (unit: MeasureUnit) => void;
}) {
  return (
    <div className="flex rounded-md border p-0.5">
      {(
        [
          ["ft", "Feet"],
          ["m", "Meters"],
        ] as const
      ).map(([value, label]) => (
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
      ? "Tap each point along the path. Points snap onto lines."
      : "Tap each point along the path.";
    return scaleLabel ? `${base} ${scaleLabel}.` : base;
  }
  const count = `${pointCount} ${pointCount === 1 ? "point" : "points"}.`;
  if (!scaleSet) return `${count} Tap Scale to see the distance.`;
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
  onFromLength,
  onUnit,
}: {
  pointCount: number;
  total: string | null;
  unit: MeasureUnit;
  scaleSet: boolean;
  snapping?: boolean;
  reading?: boolean;
  scaleLabel?: string | null;
  readError?: string | null;
  onUndo: () => void;
  onClear: () => void;
  onStartScale: () => void;
  onFromLength: () => void;
  onUnit: (unit: MeasureUnit) => void;
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
        <p className="text-muted-foreground text-xs">Total along the points</p>
      )}
      {total && !reading && scaleLabel && (
        <p className="text-muted-foreground text-xs">{scaleLabel}</p>
      )}
      {!scaleSet && pointCount === 0 && !readError && !reading && (
        <p className="text-muted-foreground text-xs">
          Tap Scale and the scale printed on this drawing is applied, so the total
          is a real distance.
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
          Scale
        </Button>
        {readError && !reading && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onFromLength}
          >
            From a length
          </Button>
        )}
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
  onUndo,
  onCancel,
  onDraft,
  onUnit,
  onApply,
}: {
  count: number;
  unit: MeasureUnit;
  snapping?: boolean;
  draft: string;
  error: string | null;
  onUndo: () => void;
  onCancel: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: MeasureUnit) => void;
  onApply: () => void;
}) {
  return (
    <>
      <p role="status" className="text-sm">
        {count === 0
          ? snapping
            ? "Tap one end of a known length. It snaps onto a line."
            : "Tap one end of a length you know on the drawing."
          : count === 1
            ? snapping
              ? "Tap the other end. It snaps onto a line."
              : "Tap the other end."
            : "How long is this line?"}
      </p>
      {count >= 2 && (
        <>
          <Input
            autoFocus
            aria-label="How long is this line?"
            inputMode="decimal"
            placeholder={unit === "ft" ? "24'6\"" : "7.5"}
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
      <div className="flex gap-2">
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
    </>
  );
}
