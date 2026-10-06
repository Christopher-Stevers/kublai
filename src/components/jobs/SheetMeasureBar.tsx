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
  draft,
  error,
  onToggle,
  onUndo,
  onClear,
  onStartScale,
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
  draft: string;
  error: string | null;
  onToggle: () => void;
  onUndo: () => void;
  onClear: () => void;
  onStartScale: () => void;
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
              onUndo={onUndo}
              onClear={onClear}
              onStartScale={onStartScale}
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

function Tracing({
  pointCount,
  total,
  unit,
  scaleSet,
  onUndo,
  onClear,
  onStartScale,
  onUnit,
}: {
  pointCount: number;
  total: string | null;
  unit: MeasureUnit;
  scaleSet: boolean;
  onUndo: () => void;
  onClear: () => void;
  onStartScale: () => void;
  onUnit: (unit: MeasureUnit) => void;
}) {
  return (
    <>
      {total ? (
        <p role="status" className="text-xl font-semibold tabular-nums">
          {total}
        </p>
      ) : (
        <p role="status" className="text-sm">
          {pointCount === 0
            ? "Tap each point along the path."
            : `${pointCount} ${pointCount === 1 ? "point" : "points"}. Set a scale to see the distance.`}
        </p>
      )}
      {total && (
        <p className="text-muted-foreground text-xs">Total along the points</p>
      )}
      {!scaleSet && pointCount === 0 && (
        <p className="text-muted-foreground text-xs">
          Set a scale once, from a length printed on this drawing, so the total
          is a real distance.
        </p>
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
          onClick={onStartScale}
        >
          Set scale
        </Button>
      </div>
    </>
  );
}

function Calibration({
  count,
  unit,
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
          ? "Tap one end of a length you know on the drawing."
          : count === 1
            ? "Tap the other end."
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
