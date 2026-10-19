"use client";
import { useEffect, useState } from "react";
import {
  CheckIcon,
  EraserIcon,
  GitBranchIcon,
  LayersIcon,
  PaletteIcon,
  Redo2Icon,
  RulerIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { LENGTH_UNITS, type LengthUnit } from "~/lib/sheet-measure";
import { useDrawingWheelGroup } from "./DrawingQuickWheel";
import { drawingWheelStyleItems } from "./drawing-wheel-style";
import { StyleStrip } from "./StyleStrip";
import type { SheetMeasureBarProps } from "./SheetMeasureBar";

/** Wheel actions share the viewer's existing measuring callbacks and draft state. */
export function DrawingMeasureWheel({
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
  draft,
  error,
  reading = false,
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
  onReadPrinted,
  onCancelScale,
  onDraft,
  onUnit,
  onApply,
  color,
  onColor,
  lineWidth,
  onLineWidth,
  pipePanel,
  gap = false,
  canGap = false,
  gapMessage,
  onGap,
}: SheetMeasureBarProps) {
  const [wheelDialog, setWheelDialog] = useState<
    "" | "scale" | "style" | "layer"
  >("");
  const [layerName, setLayerName] = useState("");
  const [layerSaving, setLayerSaving] = useState(false);
  const [layerError, setLayerError] = useState("");
  const statusNote = error ?? readError ?? gapMessage;
  const unitItems = LENGTH_UNITS.map((option) => ({
    id: option.value,
    label: option.label,
    selected: unit === option.value,
    disabled: saving,
    run: () => onUnit(option.value),
  }));
  useDrawingWheelGroup(
    measuring
      ? {
          id: "measurement",
          title: calibrating ? "Set scale" : "Measure",
          priority: 30,
          items: calibrating
            ? [
                {
                  id: "length",
                  label: "Enter length",
                  icon: <RulerIcon />,
                  disabled: calibrationCount < 2 || saving,
                  run: () => setWheelDialog("scale"),
                },
                {
                  id: "undo",
                  label: "Undo",
                  icon: <Undo2Icon />,
                  disabled: !calibrationCount || saving,
                  run: onUndo,
                },
                {
                  id: "redo",
                  label: "Redo",
                  icon: <Redo2Icon />,
                  disabled: !canRedo || saving,
                  run: onRedo,
                },
                {
                  id: "cancel",
                  label: "Cancel scale",
                  icon: <XIcon />,
                  disabled: saving,
                  run: onCancelScale,
                },
                { id: "units", label: "Units", children: unitItems },
              ]
            : [
                {
                  id: "done",
                  label: "Done",
                  icon: <CheckIcon />,
                  disabled: saving || clearDisabled,
                  run: onToggle,
                },
                {
                  id: "undo",
                  label: "Undo",
                  icon: <Undo2Icon />,
                  disabled: !pointCount,
                  run: onUndo,
                },
                {
                  id: "branch",
                  label: "Branch",
                  icon: <GitBranchIcon />,
                  selected: gap,
                  disabled: !canGap || !onGap,
                  run: onGap,
                },
                {
                  id: "redo",
                  label: "Redo",
                  icon: <Redo2Icon />,
                  disabled: !canRedo || !onRedo,
                  run: onRedo,
                },
                {
                  id: "clear",
                  label: "Clear",
                  icon: <EraserIcon />,
                  disabled: !pointCount || clearDisabled,
                  run: onClear,
                },
                ...(onReadPrinted
                  ? [
                      {
                        id: "printed",
                        label: "Read printed scale",
                        disabled: reading || !canSetScale,
                        run: onReadPrinted,
                      },
                    ]
                  : []),
                ...(onMeasurementLayer
                  ? [
                      {
                        id: "layers",
                        label: "Layers",
                        icon: <LayersIcon />,
                        children: [
                          ...[
                            ...new Set([
                              "General",
                              ...measurementLayers,
                              ...measurementLayer,
                            ]),
                          ].map((layer) => ({
                            id: layer,
                            label: layer,
                            selected: measurementLayer.includes(layer),
                            keepOpen: true,
                            run: () => {
                              const next = measurementLayer.includes(layer)
                                ? measurementLayer.filter(
                                    (name) => name !== layer,
                                  )
                                : [...measurementLayer, layer];
                              onMeasurementLayer(
                                next.length ? next : ["General"],
                              );
                            },
                          })),
                          ...(onAddMeasurementLayer
                            ? [
                                {
                                  id: "add-layer",
                                  label: "Add layer",
                                  run: () => {
                                    setLayerError("");
                                    setWheelDialog("layer");
                                  },
                                },
                              ]
                            : []),
                        ],
                      },
                    ]
                  : []),
                {
                  id: "style",
                  label: "Style",
                  icon: <PaletteIcon />,
                  children: drawingWheelStyleItems({
                    color,
                    width: lineWidth,
                    onColor,
                    onWidth: onLineWidth,
                    onCustom: () => setWheelDialog("style"),
                  }),
                },
                { id: "units", label: "Units", children: unitItems },
              ],
        }
      : null,
  );
  useEffect(() => {
    if (calibrating && calibrationCount >= 2) setWheelDialog("scale");
    else if (!calibrating)
      setWheelDialog((current) => (current === "scale" ? "" : current));
  }, [calibrating, calibrationCount]);
  return (
    <>
      {measuring && (
        <div
          className="bg-card/90 pointer-events-none absolute top-14 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded-xl px-3 py-2 text-sm shadow-sm backdrop-blur-sm"
          data-drawing-measure-status=""
          aria-live="polite"
        >
          {calibrating ? (
            calibrationCount < 2 ? (
              "Choose two points for scale"
            ) : (
              "Enter the known length"
            )
          ) : total && pointCount ? (
            <strong className="text-xl tabular-nums">{total}</strong>
          ) : (
            "Tap points to measure"
          )}
          {!calibrating && (
            <button
              type="button"
              aria-label="Change scale"
              title="Set a custom scale"
              disabled={reading || saving || !canSetScale}
              onClick={onStartScale}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              className="bg-muted text-muted-foreground hover:bg-accent focus-visible:ring-ring pointer-events-auto ml-2 rounded-full px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scaleLabel ?? "Set scale"}
            </button>
          )}
          {statusNote && <p className="mt-1 max-w-72 text-xs">{statusNote}</p>}
        </div>
      )}
      {!measuring && pipePanel}
      <Dialog
        open={Boolean(wheelDialog)}
        onOpenChange={(open) => {
          if (!open && !saving && !layerSaving) setWheelDialog("");
        }}
      >
        <DialogContent layerClassName="z-[110]">
          <DialogHeader>
            <DialogTitle>
              {wheelDialog === "scale"
                ? "Set scale"
                : wheelDialog === "layer"
                  ? "Add measurement layer"
                  : "Measurement style"}
            </DialogTitle>
            <DialogDescription>
              {wheelDialog === "scale"
                ? "Enter the real distance between the two points."
                : wheelDialog === "layer"
                  ? "Save a layer and apply this measurement to it."
                  : "Choose a colour and line width."}
            </DialogDescription>
          </DialogHeader>
          {wheelDialog === "scale" && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                onApply();
              }}
            >
              <label className="block text-sm">
                How long is this line?
                <Input
                  autoFocus
                  aria-label="How long is this line?"
                  inputMode="decimal"
                  value={draft}
                  disabled={saving}
                  onChange={(event) => onDraft(event.target.value)}
                />
              </label>
              <select
                className="bg-background h-10 w-full rounded-md border px-2"
                aria-label="Scale units"
                value={unit}
                disabled={saving}
                onChange={(event) => onUnit(event.target.value as LengthUnit)}
              >
                {LENGTH_UNITS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={!draft.trim() || saving || reading}
              >
                {saving ? "Saving…" : "Use this length"}
              </Button>
            </form>
          )}
          {wheelDialog === "style" && (
            <StyleStrip
              color={color}
              onColor={onColor}
              colorLabel="Measuring colours"
              customColorLabel="Custom measuring color"
              width={lineWidth}
              onWidth={onLineWidth}
            />
          )}
          {wheelDialog === "layer" && (
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const next = layerName.trim();
                if (!next || layerSaving) return;
                setLayerSaving(true);
                setLayerError("");
                try {
                  await onAddMeasurementLayer?.(next);
                  onMeasurementLayer?.([
                    ...new Set([
                      ...measurementLayer.filter(
                        (layer) => layer !== "General",
                      ),
                      next,
                    ]),
                  ]);
                  setLayerName("");
                  setWheelDialog("");
                } catch (reason) {
                  setLayerError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not save layer.",
                  );
                } finally {
                  setLayerSaving(false);
                }
              }}
            >
              <Input
                autoFocus
                aria-label="New measurement layer"
                maxLength={80}
                value={layerName}
                onChange={(event) => setLayerName(event.target.value)}
              />
              {layerError && (
                <p role="alert" className="text-destructive text-sm">
                  {layerError}
                </p>
              )}
              <Button type="submit" disabled={!layerName.trim() || layerSaving}>
                {layerSaving ? "Saving…" : "Add layer"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
