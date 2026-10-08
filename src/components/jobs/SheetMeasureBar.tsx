"use client";

import { useId, useState, type PointerEvent, type ReactNode } from "react";
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
  saving = false,
  canSetScale = true,
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
  zoomControl,
  gap = false,
  canGap = false,
  gapMessage,
  onGap,
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
  saving?: boolean;
  canSetScale?: boolean;
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
  zoomControl?: ReactNode;
  gap?: boolean;
  canGap?: boolean;
  gapMessage?: string | null;
  onGap?: () => void;
}) {
  const stop = (event: PointerEvent) => event.stopPropagation();
  const toggle = (
    <Button
      type="button"
      size="sm"
      variant={measuring ? "default" : "outline"}
      className="shrink-0"
      aria-pressed={measuring}
      disabled={saving}
      onClick={onToggle}
    >
      <RulerIcon className="h-4 w-4" />
      {measuring ? "Done" : "Measure"}
    </Button>
  );
  const measuringControls = (
    <div className="flex shrink-0 items-center gap-2">
      {zoomControl}
      {toggle}
    </div>
  );
  return (
    <section
      aria-label="Drawing tool options"
      className="bg-card max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain border-t px-3 py-2"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mx-auto max-w-6xl space-y-2">
        {measuring ? (
          calibrating ? (
            <Calibration
              count={calibrationCount}
              unit={unit}
              snapping={snapping}
              draft={draft}
              error={error}
              reading={reading}
              saving={saving}
              readError={readError}
              onUndo={onUndo}
              onCancel={onCancelScale}
              onDraft={onDraft}
              onUnit={onUnit}
              onApply={onApply}
              onReadPrinted={onReadPrinted}
              controls={measuringControls}
              color={color}
              onColor={onColor}
            />
          ) : (
            <Tracing
              pointCount={pointCount}
              total={total}
              unit={unit}
              scaleSet={scaleSet}
              canSetScale={canSetScale}
              snapping={snapping}
              reading={reading}
              scaleLabel={scaleLabel}
              readError={readError}
              onUndo={onUndo}
              onClear={onClear}
              onStartScale={onStartScale}
              gap={gap}
              canGap={canGap}
              gapMessage={gapMessage}
              onGap={onGap}
              onUnit={onUnit}
              controls={measuringControls}
              color={color}
              onColor={onColor}
            />
          )
        ) : (
          <div className="flex items-center justify-end gap-2">
            <div className="mr-auto">{zoomControl}</div>
            {pipeControl}
            {toggle}
          </div>
        )}
        {!measuring && pipePanel}
      </div>
    </section>
  );
}

function MeasureColorPicker({
  color,
  onColor,
}: {
  color: string;
  onColor: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const name =
    MEASURE_COLORS.find((item) => item.value === color)?.name ?? "Custom";
  return (
    <div className={`min-w-0 ${open ? "basis-full" : "ml-auto"}`}>
      <button
        type="button"
        className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-sm"
        aria-label={`Measuring color: ${name}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="h-5 w-5 rounded-full border border-current/30"
          style={{ backgroundColor: color }}
        />
        <span>Color</span>
        <span className="sr-only">{name}</span>
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={id} className="space-y-2 pt-1">
          <div
            role="group"
            aria-label="Measuring colors"
            className="grid max-w-sm grid-cols-5 gap-1"
          >
            {MEASURE_COLORS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-label={item.name}
                aria-pressed={color === item.value}
                title={item.name}
                className="focus-visible:outline-primary flex h-11 items-center justify-center rounded-md border border-current/25 focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  backgroundColor: item.value,
                  color: measureColorHalo(item.value),
                }}
                onClick={() => {
                  onColor(item.value);
                  setOpen(false);
                }}
              >
                {color === item.value && (
                  <CheckIcon aria-hidden="true" className="h-5 w-5" />
                )}
              </button>
            ))}
          </div>
          <label className="flex max-w-sm items-center justify-between gap-2 text-sm">
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
  disabled = false,
}: {
  unit: LengthUnit;
  onUnit: (unit: LengthUnit) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex w-36 shrink-0 rounded-md border p-0.5"
      role="group"
      aria-label="Units"
    >
      {LENGTH_UNITS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={unit === value}
          disabled={disabled}
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
  canSetScale,
  snapping,
  reading,
  scaleLabel,
  readError,
  onUndo,
  onClear,
  onStartScale,
  onUnit,
  controls,
  color,
  onColor,
  gap,
  canGap,
  gapMessage,
  onGap,
}: {
  pointCount: number;
  total: string | null;
  unit: LengthUnit;
  scaleSet: boolean;
  canSetScale: boolean;
  snapping?: boolean;
  reading?: boolean;
  scaleLabel?: string | null;
  readError?: string | null;
  onUndo: () => void;
  onClear: () => void;
  onStartScale: () => void;
  onUnit: (unit: LengthUnit) => void;
  controls: ReactNode;
  color: string;
  onColor: (color: string) => void;
  gap: boolean;
  canGap: boolean;
  gapMessage?: string | null;
  onGap?: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {total && !reading ? (
            <p role="status" className="text-lg font-semibold tabular-nums">
              {total}
            </p>
          ) : (
            <p role="status" className="text-sm">
              {reading
                ? "Reading the scale on this drawing."
                : traceStatus(pointCount, scaleSet, snapping, scaleLabel)}
            </p>
          )}
        </div>
        {scaleSet && <UnitToggle unit={unit} onUnit={onUnit} />}
        {controls}
      </div>
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
      {(gap || gapMessage) && (
        <p role="note" aria-live="polite" className="text-primary text-xs">
          {gapMessage ??
            "Gap: tap anywhere on a measured segment to start a branch."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={gap ? "default" : "outline"}
          aria-pressed={gap}
          disabled={!canGap || !onGap}
          onClick={onGap}
        >
          Gap
        </Button>
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
          disabled={(reading ?? false) || !canSetScale}
          onClick={onStartScale}
        >
          Set Scale
        </Button>
        <MeasureColorPicker color={color} onColor={onColor} />
      </div>
      {total && !reading && (
        <p className="text-muted-foreground text-xs">
          Total measured run · Use Gap to add a branch · Drag a point to adjust
        </p>
      )}
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
  saving,
  readError,
  onUndo,
  onCancel,
  onDraft,
  onUnit,
  onApply,
  onReadPrinted,
  controls,
  color,
  onColor,
}: {
  count: number;
  unit: LengthUnit;
  snapping?: boolean;
  draft: string;
  error: string | null;
  reading?: boolean;
  saving: boolean;
  readError?: string | null;
  onUndo: () => void;
  onCancel: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: LengthUnit) => void;
  onApply: () => void;
  onReadPrinted?: () => void;
  controls: ReactNode;
  color: string;
  onColor: (color: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <p role="status" className="min-w-0 flex-1 text-sm">
          {saving
            ? "Saving scale…"
            : reading
              ? "Reading the scale on this drawing."
              : count === 0
                ? snapping
                  ? "Set Scale: tap one end of a length you know. It snaps onto a line."
                  : "Set Scale: tap one end of a length you know."
                : count === 1
                  ? "Tap the other end. It snaps to lines, and locks square or at 45° when close."
                  : "How long is this line?"}
        </p>
        {controls}
      </div>
      {count >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-24 flex-1"
            autoFocus
            disabled={saving}
            aria-label="How long is this line?"
            inputMode="decimal"
            placeholder={
              unit === "ft"
                ? "24'6\""
                : unit === "in"
                  ? "18"
                  : unit === "mm"
                    ? "7500"
                    : "7.5"
            }
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApply();
              }
            }}
          />
          <UnitToggle unit={unit} onUnit={onUnit} disabled={saving} />

          <Button
            type="button"
            size="sm"
            disabled={!draft.trim() || saving || reading}
            onClick={onApply}
          >
            Use this length
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {readError && !reading && (
        <p className="text-destructive text-xs">{readError}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={count === 0 || saving}
          onClick={onUndo}
        >
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <MeasureColorPicker color={color} onColor={onColor} />
      </div>
      {onReadPrinted && count === 0 && (
        <button
          type="button"
          className="text-primary text-left text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50"
          disabled={(reading ?? false) || saving}
          onClick={onReadPrinted}
        >
          Read the scale printed on this drawing instead
        </button>
      )}
    </>
  );
}
