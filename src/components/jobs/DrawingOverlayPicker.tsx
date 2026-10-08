"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

export type OverlayDrawingChoice = {
  id: string;
  name: string;
  revision?: string;
};
export function DrawingOverlayPicker({
  drawings,
  initialFirstId,
  initialSecondId,
  onClose,
  onCompare,
}: {
  drawings: OverlayDrawingChoice[];
  initialFirstId: string;
  initialSecondId?: string;
  onClose: () => void;
  onCompare: (firstId: string, secondId: string) => void;
}) {
  const [firstId, setFirstId] = useState(initialFirstId);
  const [secondId, setSecondId] = useState(initialSecondId ?? "");
  const valid =
    firstId !== secondId &&
    [firstId, secondId].every((id) => drawings.some((item) => item.id === id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Overlay drawings</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Choose any two drawings or uploaded revisions from this job.
        </p>
        {(["Drawing A", "Drawing B"] as const).map((label, index) => (
          <label key={label} className="space-y-1 text-sm">
            <span>{label}</span>
            <select
              aria-label={label}
              className="bg-background h-10 w-full min-w-0 rounded border px-2"
              value={index === 0 ? firstId : secondId}
              onChange={(event) =>
                (index === 0 ? setFirstId : setSecondId)(event.target.value)
              }
            >
              <option value="">Choose a drawing or revision</option>
              {drawings.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.revision
                    ? `${item.revision} · ${item.name}`
                    : item.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        {firstId && firstId === secondId && (
          <p role="alert" className="text-destructive text-sm">
            Choose two different drawings or revisions.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onCompare(firstId, secondId)}
          >
            Open overlay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
