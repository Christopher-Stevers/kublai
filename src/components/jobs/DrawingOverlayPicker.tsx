"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { overlayLabel } from "~/lib/drawing-overlay-stack";

export type OverlayDrawingChoice = {
  id: string;
  name: string;
  revision?: string;
  setId?: string;
  setName?: string | null;
};
export function DrawingOverlayPicker({
  drawings,
  initialFirstId,
  initialSecondId,
  initialAdditionalIds = [],
  onClose,
  onCompare,
}: {
  drawings: OverlayDrawingChoice[];
  initialFirstId: string;
  initialSecondId?: string;
  initialAdditionalIds?: string[];
  onClose: () => void;
  onCompare: (
    firstId: string,
    secondId: string,
    additionalIds?: string[],
  ) => void;
}) {
  const [ids, setIds] = useState(() => [...new Set([
    initialFirstId, initialSecondId ?? "", ...initialAdditionalIds,
  ].filter(Boolean))]);
  const choices = new Map(drawings.map(drawing => [drawing.id, drawing]));
  const groups = new Map<string, { name: string; drawings: OverlayDrawingChoice[] }>();
  for (const drawing of drawings) {
    const key = drawing.setId ?? "unassigned";
    if (!groups.has(key)) groups.set(key, { name: drawing.setName?.trim() || "Other drawings", drawings: [] });
    groups.get(key)!.drawings.push(drawing);
  }
  const valid = ids.length >= 2 && ids.every(id => choices.has(id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Drawings</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Choose drawings or uploaded revisions from this job. Add as many
          layers as you need.
        </DialogDescription>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {ids.length} selected · Choose at least two drawings
        </p>
        <div className="space-y-2">
          {[...groups.entries()].map(([id, group]) => (
            <details key={id} className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-3 font-medium">
                {group.name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {group.drawings.filter(drawing => ids.includes(drawing.id)).length} / {group.drawings.length}
                </span>
              </summary>
              <div className="border-t px-3 py-1">
                {group.drawings.map(drawing => {
                  const index = ids.indexOf(drawing.id);
                  return <label key={drawing.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
                    <input type="checkbox" aria-label={`${drawing.revision ? `${drawing.revision} · ` : ""}${drawing.name}`} className="h-4 w-4 shrink-0 accent-primary"
                      checked={index >= 0}
                      onChange={event => {
                        const checked = event.target.checked;
                        setIds(current => checked ? [...current, drawing.id] : current.filter(id => id !== drawing.id));
                      }} />
                    <span className="min-w-0 flex-1 break-words">
                      {drawing.revision ? `${drawing.revision} · ` : ""}{drawing.name}
                    </span>
                    {index >= 0 && <span aria-hidden="true" className="text-muted-foreground shrink-0 text-xs">{overlayLabel(index)}</span>}
                  </label>;
                })}
              </div>
            </details>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              ids.length === 2
                ? onCompare(ids[0]!, ids[1]!)
                : onCompare(ids[0]!, ids[1]!, ids.slice(2))
            }
          >
            Open overlay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
