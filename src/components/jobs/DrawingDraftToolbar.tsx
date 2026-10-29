"use client";
import { Button } from "~/components/ui/button";
import type { DrawingTool } from "~/lib/drawing-workspace";
import { isPathTool } from "~/lib/drawing-annotation-geometry";
import { useDrawingWheelGroup } from "./DrawingQuickWheel";
import { CheckIcon, Undo2Icon, XIcon } from "lucide-react";

export function DrawingDraftToolbar({ tool, count, canFinish, onUndo, onCancel, onFinish, onDone }: {
  tool: DrawingTool; count: number; canFinish: boolean; onUndo: () => void; onCancel: () => void; onFinish: () => void; onDone?: () => void;
}) {
  const quickWheel = useDrawingWheelGroup(tool !== "pan" && tool !== "viewing" && tool !== "select" ? {
    id: "draft", title: tool === "freehand" ? "Pen" : tool === "link" ? "Hyperlink" : tool,
    priority: 10,
    items: [
      ...(onDone ? [{ id: "done", label: "Done", icon: <CheckIcon />, run: () => { if (canFinish) onFinish(); onDone(); } }] : []),
      { id: "finish", label: "Finish", icon: <CheckIcon />, disabled: !canFinish, run: onFinish },
      { id: "undo", label: "Undo point", icon: <Undo2Icon />, disabled: count === 0, run: onUndo },
      { id: "cancel", label: "Clear drawing", icon: <XIcon />, disabled: count === 0, run: onCancel },
    ],
  } : null);
  if (quickWheel) return null;
  if (tool === "pan" || tool === "viewing" || tool === "select") return null;
  if (count === 0) return null;
  return <div data-drawing-chrome className="absolute inset-x-2 bottom-2 z-20 mx-auto flex max-w-lg flex-wrap items-center justify-center gap-2 rounded-lg border bg-card/95 p-2 shadow-sm"
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    {count > 0 && <>
      <Button size="sm" variant="outline" onClick={onUndo}>Undo point</Button>
      <Button size="sm" variant="outline" onClick={onCancel}>Cancel drawing</Button>
      {isPathTool(tool) && <Button size="sm" disabled={!canFinish} onClick={onFinish}>Finish</Button>}
    </>}
  </div>;
}
