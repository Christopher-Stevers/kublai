"use client";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DEFAULT_DRAWING_APPEARANCE,
  type DrawingAppearance,
} from "~/lib/drawing-appearance";

export function DrawingAppearanceDialog({
  appearance,
  comparing,
  onChange,
  onClose,
}: {
  appearance: DrawingAppearance;
  comparing: boolean;
  onChange: (value: DrawingAppearance) => void;
  onClose: () => void;
}) {
  const custom = appearance.lineColor !== null;
  const defaultColor = appearance.inverted ? "#ffffff" : "#000000";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drawing appearance</DialogTitle>
        </DialogHeader>
        <label className="flex items-center justify-between gap-3 text-sm">
          Invert background
          <input
            type="checkbox"
            aria-label="Invert background"
            checked={appearance.inverted}
            onChange={(event) =>
              onChange({ ...appearance, inverted: event.target.checked })
            }
          />
        </label>
        <p className="text-muted-foreground text-sm">
          Black paper with white lines. Choose a custom colour below to change
          the lines.
        </p>
        <label className="flex items-center justify-between gap-3 text-sm">
          Custom line colour
          <input
            type="checkbox"
            aria-label="Custom line colour"
            checked={custom}
            onChange={(event) =>
              onChange({
                ...appearance,
                lineColor: event.target.checked ? defaultColor : null,
              })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Line colour
          <input
            type="color"
            aria-label="Drawing line colour"
            disabled={!custom}
            value={appearance.lineColor ?? defaultColor}
            className="h-10 w-14 rounded border bg-transparent p-1 disabled:opacity-50"
            onChange={(event) =>
              onChange({ ...appearance, lineColor: event.target.value })
            }
          />
        </label>
        {comparing && (
          <p className="text-muted-foreground text-sm">
            Overlay colours are chosen separately for Drawing A and Drawing B.
            Shared lines turn white when the background is inverted.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onChange(DEFAULT_DRAWING_APPEARANCE)}
          >
            Reset appearance
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
