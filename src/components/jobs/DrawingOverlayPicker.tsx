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
  const [ids, setIds] = useState([
    initialFirstId,
    initialSecondId ?? "",
    ...initialAdditionalIds,
  ]);
  const [editing, setEditing] = useState<number | null>(null);
  const choices = new Map(drawings.map((drawing) => [drawing.id, drawing]));
  const duplicate =
    new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length;
  const valid =
    ids.length >= 2 && !duplicate && ids.every((id) => choices.has(id));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Overlay drawings</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Choose drawings or uploaded revisions from this job. Add as many
          layers as you need.
        </DialogDescription>
        {ids.map((id, index) => (
          <div key={index} className="space-y-1 text-sm">
            <span className="flex items-center justify-between">
              {overlayLabel(index)}
              <span className="flex items-center gap-1">
                {index >= 2 && id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Change ${overlayLabel(index)}`}
                    onClick={() => setEditing(index)}
                  >
                    Change
                  </Button>
                )}
                {ids.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${overlayLabel(index)}`}
                    onClick={() => {
                      setEditing(null);
                      setIds((current) =>
                        current.filter((_, at) => at !== index),
                      );
                    }}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </span>
            {index < 2 || !id || editing === index ? (
              <select
                aria-label={overlayLabel(index)}
                className="bg-background h-10 w-full min-w-0 rounded border px-2"
                value={id}
                onChange={(event) => {
                  const value = event.target.value;
                  setIds((current) =>
                    current.map((id, at) => (at === index ? value : id)),
                  );
                  setEditing(null);
                }}
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
            ) : (
              <p className="rounded border px-2 py-2">
                {choices.get(id)?.revision
                  ? `${choices.get(id)!.revision} · `
                  : ""}
                {choices.get(id)?.name ?? "Drawing no longer available"}
              </p>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={ids.some((id) => !id)}
          onClick={() => {
            setEditing(null);
            setIds((current) => [...current, ""]);
          }}
        >
          Add drawing
        </Button>
        {duplicate && (
          <p role="alert" className="text-destructive text-sm">
            Choose different drawings or revisions for each layer.
          </p>
        )}
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
