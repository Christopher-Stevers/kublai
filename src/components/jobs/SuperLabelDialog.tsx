"use client";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { superLabelSchema, type LabelBox } from "~/lib/super-label";
import type { DrawingJobSheet } from "~/lib/drawing-workspace";

type LabelProgress =
  | { stage: "saving" }
  | { stage: "reading"; index: number; total: number; name: string }
  | { stage: "refreshing" };

export function SuperLabelDialog({
  source,
  onClose,
  onSaved,
}: {
  source: DrawingJobSheet;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const settings = api.drawingsWorkspace.superLabelSettings.useQuery({
    sheetId: source.id,
  });
  const save = api.drawingsWorkspace.saveSuperLabelBoxes.useMutation({
    networkMode: "always",
    retry: false,
  });
  const apply = api.drawingsWorkspace.applySuperLabel.useMutation({
    networkMode: "always",
    retry: false,
  });
  const [boxes, setBoxes] = useState<
    Partial<Record<"title" | "number", LabelBox>>
  >({});
  const [field, setField] = useState<"title" | "number">("title");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LabelProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  const loaded = useRef(false);
  const stop = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    if (settings.data && !loaded.current) {
      setBoxes(settings.data.boxes ?? {});
      loaded.current = true;
    }
  }, [settings.data]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const valid = superLabelSchema.safeParse(boxes).success;
  async function run() {
    const parsed = superLabelSchema.safeParse(boxes);
    if (running.current || !parsed.success || !settings.data) return;
    if (!navigator.onLine) {
      setError("Reconnect before applying labels.");
      return;
    }
    // Guard repeated activation before React commits the disabled button.
    running.current = true;
    start.current = null;
    const sheets = settings.data.sheets;
    let refreshing = false;
    setBusy(true);
    setProgress({ stage: "saving" });
    setStopping(false);
    setResults([]);
    setError("");
    stop.current = false;
    try {
      await save.mutateAsync({ sheetId: source.id, boxes: parsed.data });
      for (const [index, sheet] of sheets.entries()) {
        if (stop.current) break;
        if (!navigator.onLine) break;
        setProgress({
          stage: "reading",
          index: index + 1,
          total: sheets.length,
          name: sheet.name,
        });
        try {
          const result = await apply.mutateAsync({
            sheetId: source.id,
            targetId: sheet.id,
            boxes: parsed.data,
          });
          setResults((rows) => [
            ...rows,
            `${result.title || sheet.name} · ${result.number || "number unreadable"}${result.warning ? " — needs review" : ""}`,
          ]);
        } catch (e) {
          setResults((rows) => [
            ...rows,
            `${sheet.name} — ${e instanceof Error ? e.message : "Unable to read"}`,
          ]);
        }
      }
      if (!navigator.onLine) {
        setError(
          "Connection lost. Reconnect and refresh to check saved labels before running again.",
        );
        return;
      }
      refreshing = true;
      setProgress({ stage: "refreshing" });
      await onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : refreshing
            ? "Unable to refresh drawing labels"
            : "Unable to save boxes",
      );
    } finally {
      running.current = false;
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[95dvh] overflow-auto sm:max-w-[95vw]"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Super Label</DialogTitle>
          <DialogDescription>
            Draw one box around the drawing label and another around the drawing
            number. These positions apply only to this drawing set. Each
            drawing’s own text is read. Keep this window open while applying.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            variant={field === "title" ? "default" : "outline"}
            onClick={() => setField("title")}
          >
            Drawing label · blue
          </Button>
          <Button
            disabled={busy}
            variant={field === "number" ? "default" : "outline"}
            onClick={() => setField("number")}
          >
            Drawing number · orange
          </Button>
          <label>
            Zoom{" "}
            <select
              aria-label="Super Label zoom"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="bg-background rounded border p-2"
            >
              <option value={1}>100%</option>
              <option value={2}>200%</option>
              <option value={4}>400%</option>
            </select>
          </label>
        </div>
        <div className="max-h-[55dvh] overflow-auto rounded border">
          <div
            className="relative select-none"
            style={{
              width: `${zoom * 100}%`,
              aspectRatio: `${source.width}/${source.height}`,
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (busy || e.button !== 0) return;
              const r = e.currentTarget.getBoundingClientRect();
              start.current = {
                x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const r = e.currentTarget.getBoundingClientRect(),
                x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
              const a = start.current;
              setBoxes((old) => ({
                ...old,
                [field]: {
                  left: Math.min(a.x, x),
                  top: Math.min(a.y, y),
                  right: Math.max(a.x, x),
                  bottom: Math.max(a.y, y),
                },
              }));
            }}
            onPointerUp={() => {
              start.current = null;
            }}
            onPointerCancel={() => {
              start.current = null;
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={source.imageUrl}
              alt={source.name}
              draggable={false}
              className="pointer-events-none block h-full w-full"
            />
            {(["title", "number"] as const).map((key) => {
              const b = boxes[key];
              return b ? (
                <div
                  key={key}
                  className="pointer-events-none absolute border-2"
                  style={{
                    left: `${b.left * 100}%`,
                    top: `${b.top * 100}%`,
                    width: `${(b.right - b.left) * 100}%`,
                    height: `${(b.bottom - b.top) * 100}%`,
                    borderColor: key === "title" ? "#2563eb" : "#f97316",
                    background: key === "title" ? "#2563eb22" : "#f9731622",
                  }}
                />
              ) : null;
            })}
          </div>
        </div>
        {settings.error && <p role="alert">{settings.error.message}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!valid || busy || !settings.data}
            onClick={() => void run()}
          >
            Apply to {settings.data?.sheets.length ?? 0} drawings in this set
          </Button>
          {busy && progress?.stage !== "refreshing" && (
            <Button
              variant="outline"
              disabled={stopping}
              onClick={() => {
                stop.current = true;
                setStopping(true);
              }}
            >
              {stopping
                ? "Stopping…"
                : progress?.stage === "saving"
                  ? "Stop before reading"
                  : "Stop after current drawing"}
            </Button>
          )}
          <span
            role="status"
            aria-live="polite"
            className="min-w-0 basis-full text-sm"
          >
            {progress && (
              <span className="block">
                {progress.stage === "saving"
                  ? stopping
                    ? "Finishing box save; no drawings will be read."
                    : "Saving label boxes…"
                  : progress.stage === "refreshing"
                    ? "Refreshing drawing labels…"
                    : `Reading ${progress.index} of ${progress.total}: ${progress.name}${stopping ? " · Stopping after this drawing" : ""}`}
              </span>
            )}
            {results.length > 0 && (
              <span className="block">
                {results.length} / {settings.data?.sheets.length ?? 0} processed
              </span>
            )}
          </span>
        </div>
        {results.length > 0 && (
          <ul className="max-h-40 overflow-auto text-sm">
            {results.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
