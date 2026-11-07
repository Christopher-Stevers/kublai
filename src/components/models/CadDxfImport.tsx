"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import type { DxfImport, DxfUnits } from "~/lib/bim/cad-dxf-import";
import { designLayers } from "~/lib/bim/cad-geometry";
import { designSchema, type ModelDesign } from "~/lib/bim/design";
export function CadDxfImport({
  design,
  onChange,
  onError,
}: {
  design: ModelDesign;
  onChange: (design: ModelDesign) => boolean;
  onError: (message: string) => void;
}) {
  const [units, setUnits] = useState<DxfUnits>("file"),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<DxfImport | null>(null),
    [name, setName] = useState("");
  const pending = useRef<{
    worker: Worker;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const generation = useRef(0);
  const cancel = () => {
    generation.current++;
    pending.current?.worker.terminate();
    clearTimeout(pending.current?.timer);
    pending.current = null;
    setBusy(false);
  };
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.worker.terminate();
      clearTimeout(pending.current?.timer);
    },
    [],
  );
  const load = async (file: File) => {
    cancel();
    setPreview(null);
    onError("");
    if (file.size > 8_000_000) {
      onError("Choose a DXF smaller than 8 MB.");
      return;
    }
    setName(file.name);
    setBusy(true);
    const ticket = generation.current;
    try {
      const text = await file.text();
      if (generation.current !== ticket) return;
      const worker = new Worker(
        new URL("../../lib/bim/cad-dxf.worker.ts", import.meta.url),
      );
      const fail = (message: string) => {
        onError(message);
        cancel();
      };
      pending.current = {
        worker,
        timer: setTimeout(
          () => fail("DXF import took too long. Try a smaller drawing."),
          30_000,
        ),
      };
      worker.onmessage = (
        e: MessageEvent<{ result?: DxfImport; error?: string }>,
      ) => {
        if (e.data.error) fail(e.data.error);
        else {
          setPreview(e.data.result ?? null);
          cancel();
        }
      };
      worker.onerror = () =>
        fail("The DXF importer could not load. Reconnect and try again.");
      worker.postMessage({ text, units });
    } catch (e) {
      if (generation.current === ticket) {
        onError(e instanceof Error ? e.message : "DXF import failed.");
        cancel();
      }
    }
  };
  return (
    <div className="space-y-2 border-t pt-3">
      <strong className="text-sm">Import DXF linework</strong>
      <label className="block space-y-1 text-xs">
        Drawing units
        <select
          aria-label="DXF units"
          className="bg-background w-full rounded border p-2 text-sm"
          value={units}
          disabled={busy}
          onChange={(e) => {
            setUnits(e.target.value as DxfUnits);
            setPreview(null);
          }}
        >
          <option value="file">Use file units</option>
          <option value="m">Metres</option>
          <option value="mm">Millimetres</option>
          <option value="ft">Feet</option>
          <option value="in">Inches</option>
        </select>
      </label>
      <input
        aria-label="Import DXF"
        className="w-full text-xs"
        type="file"
        accept=".dxf"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void load(file);
        }}
      />
      <p className="text-muted-foreground text-xs">
        Lines, polylines, arcs, circles, ellipses and block linework. Curves
        become editable polylines. Text, hatches, splines and solid bodies are
        not imported.
      </p>
      {busy && (
        <div
          role="status"
          className="flex items-center justify-between text-xs"
        >
          Reading drawing…
          <Button size="sm" variant="outline" onClick={cancel}>
            Cancel import
          </Button>
        </div>
      )}
      {preview && (
        <div className="space-y-2 text-xs">
          <strong className="block break-all">{name}</strong>
          <p>
            {preview.elements.length} objects · {preview.layers.length} layers ·
            source units: {preview.units}
          </p>
          {preview.warnings.map((message) => (
            <p key={message} className="text-amber-600 dark:text-amber-400">
              {message}
            </p>
          ))}
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              const layers = designLayers(design),
                existing = new Set(layers.map((l) => l.name));
              const next = {
                ...design,
                elements: [...design.elements, ...preview.elements],
                layers: [
                  ...layers,
                  ...preview.layers.filter((l) => !existing.has(l.name)),
                ],
              };
              const parsed = designSchema.safeParse(next);
              if (!parsed.success) {
                onError(
                  parsed.error.issues[0]?.message ??
                    "This DXF exceeds the design limits.",
                );
                return;
              }
              if (onChange(parsed.data)) setPreview(null);
            }}
          >
            Add DXF to design
          </Button>
        </div>
      )}
    </div>
  );
}
