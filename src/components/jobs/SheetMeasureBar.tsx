"use client";

import { CheckIcon, ChevronDownIcon, RulerIcon, Undo2Icon, Redo2Icon } from "lucide-react";
import { useId, useState, type PointerEvent, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  onRedo,
  canRedo = false,
  onClear,
  onStartScale,
  onCancelScale,
  onDraft,
  onUnit,
  onApply,
  color,
  onColor,
  pipeControl,
  pipePanel,
  hideIdle = false,
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
  onRedo?: () => void;
  canRedo?: boolean;
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
  /** The Measure / Pipe system buttons live in a host toolbar instead. */
  hideIdle?: boolean;
  gap?: boolean;
  canGap?: boolean;
  gapMessage?: string | null;
  onGap?: () => void;
}) {
  const stop = (event: PointerEvent) => event.stopPropagation();
  if (hideIdle && !measuring && !pipePanel) return null;
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
  // With the drawing's main bar, its Measure button is the Done button.
  const measuringControls = hideIdle ? null : (
    <div className="flex shrink-0 items-center gap-2">{toggle}</div>
  );
  return (
    <section
      data-drawing-chrome
      aria-label="Drawing tool options"
      data-snapping={snapping ? "ready" : undefined}
      className="bg-card absolute inset-x-0 bottom-0 z-20 max-h-[45dvh] overflow-y-auto overscroll-contain border-t px-3 py-1"
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
              draft={draft}
              error={error}
              reading={reading}
              saving={saving}
              readError={readError}
              onUndo={onUndo}
              onRedo={onRedo}
              canRedo={canRedo}
              onCancel={onCancelScale}
              onDraft={onDraft}
              onUnit={onUnit}
              onApply={onApply}
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
              onRedo={onRedo}
              canRedo={canRedo}
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
        ) : hideIdle ? null : (
          <div className="flex items-center justify-end gap-2">
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
    <div className="contents">
      <button
        type="button"
        className="flex h-8 w-full items-center justify-center gap-1 rounded-md border px-1 text-xs"
        aria-label={`Measuring color: ${name}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="h-5 w-5 rounded-full border border-current/30"
          style={{ backgroundColor: color }}
        />
        <span className="sr-only">Color</span>
        <span className="sr-only">{name}</span>
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={id} className="col-span-full space-y-2 pt-1">
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

/** The current unit as one button; tapping it offers m, mm, in and ft. */
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1"
          disabled={disabled}
          aria-label={`Units: ${unit}`}
        >
          {unit}
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-28">
        <DropdownMenuRadioGroup
          value={unit}
          onValueChange={(value) => onUnit(value as LengthUnit)}
        >
          {LENGTH_UNITS.map(({ value, label }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Tracing({
  pointCount,
  total,
  unit,
  scaleSet,
  canSetScale,
  reading,
  scaleLabel,
  readError,
  onUndo,
  onRedo,
  canRedo = false,
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
  onRedo?: () => void;
  canRedo?: boolean;
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
      <div
        className={`flex flex-wrap items-center gap-2 ${reading || (total && pointCount > 0) || scaleSet || controls ? "" : "hidden"}`}
      >
        <div className="min-w-0 flex-1">
          {/* Just the total (or the scale being read): no instructions. */}
          <p
            role="status"
            className={
              total && !reading
                ? "text-lg font-semibold tabular-nums"
                : "text-sm"
            }
          >
            {reading
              ? "Reading the scale on this drawing."
              : total && pointCount > 0
                ? total
                : null}
          </p>
        </div>
        {scaleSet && <UnitToggle unit={unit} onUnit={onUnit} />}
        {controls}
      </div>
      {!reading && scaleLabel && (
        <p className="text-muted-foreground text-xs">{scaleLabel}</p>
      )}
      {readError && !reading && (
        <p className="text-destructive text-xs">{readError}</p>
      )}
      {gapMessage && (
        <p role="note" aria-live="polite" className="text-primary text-xs">
          {gapMessage}
        </p>
      )}
      <div className="grid grid-cols-6 items-center gap-1 [&>button]:min-w-0 [&>button]:px-1 [&>button]:text-xs [&>button]:whitespace-normal [&>button]:leading-tight">
        <Button
          type="button"
          size="sm"
          variant={gap ? "default" : "outline"}
          aria-pressed={gap}
          disabled={!canGap || !onGap}
          onClick={onGap}
        >
          Branch
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pointCount === 0}
          aria-label="Undo"
          title="Undo"
          onClick={onUndo}
        >
          <Undo2Icon aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label="Redo" title="Redo" disabled={!canRedo || !onRedo} onClick={onRedo}>
          <Redo2Icon aria-hidden="true" className="size-4" />
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
    </>
  );
}

function Calibration({
  count,
  unit,
  draft,
  error,
  reading,
  saving,
  readError,
  onUndo,
  onRedo,
  canRedo = false,
  onCancel,
  onDraft,
  onUnit,
  onApply,
  controls,
  color,
  onColor,
}: {
  count: number;
  unit: LengthUnit;
  draft: string;
  error: string | null;
  reading?: boolean;
  saving: boolean;
  readError?: string | null;
  onUndo: () => void;
  onRedo?: () => void;
  canRedo?: boolean;
  onCancel: () => void;
  onDraft: (value: string) => void;
  onUnit: (unit: LengthUnit) => void;
  onApply: () => void;
  controls: ReactNode;
  color: string;
  onColor: (color: string) => void;
}) {
  return (
    <>
      {(saving || reading || count >= 2 || Boolean(controls)) && (
        <div className="flex items-center gap-2">
          <p role="status" className="min-w-0 flex-1 text-sm">
            {saving
              ? "Saving scale…"
              : reading
                ? "Reading the scale on this drawing."
                : count >= 2
                  ? "How long is this line?"
                  : null}
          </p>
          {controls}
        </div>
      )}
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
      <div className="grid grid-cols-4 items-center gap-1 [&>button]:min-w-0 [&>button]:px-1 [&>button]:text-xs [&>button]:whitespace-normal [&>button]:leading-tight">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={count === 0 || saving}
          aria-label="Undo"
          title="Undo"
          onClick={onUndo}
        >
          <Undo2Icon aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label="Redo" title="Redo" disabled={!canRedo || !onRedo || saving} onClick={onRedo}>
          <Redo2Icon aria-hidden="true" className="size-4" />
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
    </>
  );
}
