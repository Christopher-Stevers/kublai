"use client";
import { MeasurementLayerPicker } from "./MeasurementLayerPicker";
import { useDrawingWheelEnabled } from "./DrawingQuickWheel";
import { DrawingMeasureWheel } from "./DrawingMeasureWheel";

import {
  ChevronDownIcon,
  EraserIcon,
  GitBranchIcon,
  Redo2Icon,
  RulerIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
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
import { MEASURE_COLORS } from "~/lib/sheet-measure-color";
import { StyleStrip } from "./StyleStrip";

/** One tile in the measuring tool row: an icon over a short label. */
export const MEASURE_TILE =
  "flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-[18px]";

/**
 * Controls for tracing a distance on a drawing.
 * Pointer events stop here so a tap on a button is not another point on the sheet.
 */
export type SheetMeasureBarProps = {
  measurementLayer?: string[];
  measurementLayers?: string[];
  onAddMeasurementLayer?: (name: string) => Promise<void>;
  onMeasurementLayer?: (layer: string[]) => void;
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
  clearDisabled?: boolean;
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
  /** Line width saved with new measurements. */
  lineWidth?: number;
  onLineWidth?: (width: number) => void;
  pipeControl?: React.ReactNode;
  pipePanel?: React.ReactNode;
  /** The Measure / Pipe system buttons live in a host toolbar instead. */
  hideIdle?: boolean;
  gap?: boolean;
  canGap?: boolean;
  gapMessage?: string | null;
  onGap?: () => void;
};

export function SheetMeasureBar(props: SheetMeasureBarProps) {
  const quickWheel = useDrawingWheelEnabled();
  return quickWheel ? <DrawingMeasureWheel {...props} /> : <RegularSheetMeasureBar {...props} />;
}

function RegularSheetMeasureBar({
  measurementLayer = ["General"],
  measurementLayers = [],
  onAddMeasurementLayer,
  onMeasurementLayer,
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
  clearDisabled = false,
  onStartScale,
  onCancelScale,
  onDraft,
  onUnit,
  onApply,
  color,
  onColor,
  lineWidth,
  onLineWidth,
  pipeControl,
  pipePanel,
  hideIdle = false,
  gap = false,
  canGap = false,
  gapMessage,
  onGap,
}: SheetMeasureBarProps) {
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
      className="bg-card/95 absolute inset-x-0 bottom-0 z-20 max-h-[45dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t px-3 pt-2.5 pb-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur"
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
              layerControl={
                onMeasurementLayer ? (
                  <MeasurementLayerPicker
                    value={measurementLayer}
                    layers={measurementLayers}
                    onChange={onMeasurementLayer}
                    onAdd={onAddMeasurementLayer}
                  />
                ) : null
              }
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
              clearDisabled={clearDisabled}
              onStartScale={onStartScale}
              gap={gap}
              canGap={canGap}
              gapMessage={gapMessage}
              onGap={onGap}
              onUnit={onUnit}
              controls={measuringControls}
              color={color}
              onColor={onColor}
              lineWidth={lineWidth}
              onLineWidth={onLineWidth}
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
  width,
  onWidth,
}: {
  color: string;
  onColor: (color: string) => void;
  width?: number;
  onWidth?: (width: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const name =
    MEASURE_COLORS.find((item) => item.value === color)?.name ?? "Custom";
  return (
    <div className="contents">
      <button
        type="button"
        className={`${MEASURE_TILE} hover:bg-accent ${open ? "bg-accent" : ""}`}
        aria-label={`Measuring color: ${name}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          aria-hidden="true"
          className="ring-background size-[18px] rounded-full shadow ring-2"
          style={{ backgroundColor: color }}
        />
        <span aria-hidden="true">{onWidth ? "Style" : "Colour"}</span>
      </button>
      {open && (
        <div id={id} className="col-span-full pt-1">
          <StyleStrip
            color={color}
            onColor={onColor}
            colorLabel="Measuring colors"
            customColorLabel="Custom measuring color"
            width={width}
            onWidth={onWidth}
            widthLabel="Measuring line width"
          />
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
          variant="secondary"
          className="h-9 shrink-0 gap-1 rounded-full px-3 font-semibold"
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
  layerControl,
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
  clearDisabled = false,
  onStartScale,
  onUnit,
  controls,
  color,
  onColor,
  lineWidth,
  onLineWidth,
  gap,
  canGap,
  gapMessage,
  onGap,
}: {
  layerControl?: ReactNode;
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
  clearDisabled?: boolean;
  onStartScale: () => void;
  onUnit: (unit: LengthUnit) => void;
  controls: ReactNode;
  color: string;
  onColor: (color: string) => void;
  lineWidth?: number;
  onLineWidth?: (width: number) => void;
  gap: boolean;
  canGap: boolean;
  gapMessage?: string | null;
  onGap?: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {/* Just the total (or the scale being read): no instructions. */}
          <p
            role="status"
            className={
              total && !reading && pointCount > 0
                ? "truncate text-2xl leading-none font-bold tabular-nums"
                : "text-muted-foreground text-sm"
            }
          >
            {reading
              ? "Reading the scale on this drawing."
              : total && pointCount > 0
                ? total
                : null}
          </p>
          <button
            type="button"
            aria-label="Change scale"
            title="Set a custom scale"
            disabled={(reading ?? false) || !canSetScale}
            onClick={onStartScale}
            className="bg-muted text-muted-foreground hover:bg-accent focus-visible:ring-ring shrink-0 rounded-full px-2 py-1 text-[11px] font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scaleLabel ?? (scaleSet ? "Scale" : "Set scale")}
            <ChevronDownIcon aria-hidden="true" className="ml-1 inline size-3" />
          </button>
        </div>
        {scaleSet && <UnitToggle unit={unit} onUnit={onUnit} />}
        {controls}
      </div>
      {readError && !reading && (
        <p className="text-destructive text-xs">{readError}</p>
      )}
      {gapMessage && (
        <p role="note" aria-live="polite" className="text-primary text-xs">
          {gapMessage}
        </p>
      )}
      <div
        className={`grid ${layerControl ? "grid-cols-6" : "grid-cols-5"} items-stretch gap-1`}
      >
        <Button
          type="button"
          variant={gap ? "default" : "ghost"}
          className={MEASURE_TILE}
          aria-pressed={gap}
          disabled={!canGap || !onGap}
          onClick={onGap}
        >
          <GitBranchIcon aria-hidden="true" />
          Branch
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          disabled={pointCount === 0}
          aria-label="Undo"
          title="Undo"
          onClick={onUndo}
        >
          <Undo2Icon aria-hidden="true" className="size-5!" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          aria-label="Redo"
          title="Redo"
          disabled={!canRedo || !onRedo}
          onClick={onRedo}
        >
          <Redo2Icon aria-hidden="true" className="size-5!" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          disabled={pointCount === 0 || clearDisabled}
          aria-label="Clear"
          onClick={onClear}
        >
          <EraserIcon aria-hidden="true" />
          Clear
        </Button>
        {layerControl}
        <MeasureColorPicker
          color={color}
          onColor={onColor}
          width={lineWidth}
          onWidth={onLineWidth}
        />
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
          <p role="status" className="min-w-0 flex-1 text-sm font-medium">
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
            className="h-10 min-w-24 flex-1 rounded-xl text-base"
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
            className="h-10 rounded-xl"
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
      <div className="grid grid-cols-4 items-stretch gap-1">
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          disabled={count === 0 || saving}
          aria-label="Undo"
          title="Undo"
          onClick={onUndo}
        >
          <Undo2Icon aria-hidden="true" className="size-5!" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          aria-label="Redo"
          title="Redo"
          disabled={!canRedo || !onRedo || saving}
          onClick={onRedo}
        >
          <Redo2Icon aria-hidden="true" className="size-5!" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={MEASURE_TILE}
          aria-label="Cancel"
          disabled={saving}
          onClick={onCancel}
        >
          <XIcon aria-hidden="true" />
          Cancel
        </Button>
        <MeasureColorPicker color={color} onColor={onColor} />
      </div>
    </>
  );
}
