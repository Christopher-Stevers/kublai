"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Vector3 } from "three";
import { Button } from "~/components/ui/button";
import { downloadCadFile } from "~/lib/bim/cad-export";
import type { IfcExportObject } from "~/lib/bim/cad-ifc";
import type { ModelDesign } from "~/lib/bim/design";
import type { ModelScene } from "~/lib/bim/scene";
import type { Point3 } from "~/lib/bim/types";
export function CadIfcExport({
  design,
  scene,
  modelId,
  title,
  onError,
}: {
  design: ModelDesign;
  scene: ModelScene;
  modelId: string;
  title: string;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const current = useRef(design);
  useLayoutEffect(() => {
    current.current = design;
  }, [design]);
  const job = useRef<{
    cancelled: boolean;
    worker?: Worker;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const cancel = () => {
    if (job.current) {
      job.current.cancelled = true;
      job.current.worker?.terminate();
      clearTimeout(job.current.timer);
      job.current = null;
    }
    setBusy("");
  };
  useEffect(
    () => () => {
      const current = job.current;
      if (current) {
        current.cancelled = true;
        current.worker?.terminate();
        clearTimeout(current.timer);
      }
    },
    [],
  );
  const run = async (includeSource: boolean) => {
    const task: {
      cancelled: boolean;
      worker?: Worker;
      timer?: ReturnType<typeof setTimeout>;
    } = { cancelled: false };
    job.current = task;
    setBusy("Preparing IFC…");
    onError("");
    try {
      const source: IfcExportObject[] = [];
      let triangles = 0;
      if (includeSource) {
        const entries = [...scene.elements.values()].filter(
          (e) => e.info.modelId === modelId,
        );
        for (let i = 0; i < entries.length; i++) {
          if (task.cancelled) return;
          if (current.current !== design)
            throw Error(
              "The design changed while preparing the export. Export again to include your latest edits.",
            );
          const entry = entries[i]!,
            position = entry.bounds
              .getCenter(new Vector3())
              .add(scene.origin)
              .toArray() as Point3;
          const meshes = scene.editorGeometry(
            modelId,
            entry.info.expressId,
            position,
          );
          triangles += meshes.reduce((n, m) => n + m.indices.length / 3, 0);
          if (triangles > 2_000_000)
            throw Error(
              "This model is too large for a browser IFC export. Export the design objects only, or a smaller source model.",
            );
          if (meshes.length)
            source.push({
              id: entry.info.key,
              name: entry.info.name,
              kind: entry.info.type,
              sourceGuid: entry.info.guid,
              position,
              meshes,
              meshColors: entry.parts.map(
                (p) => p.color.toArray() as [number, number, number, number],
              ),
            });
          if (i % 25 === 0) {
            setBusy(`Preparing ${i + 1} of ${entries.length} objects…`);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      }
      if (task.cancelled) return;
      const worker = new Worker(
        new URL("../../lib/bim/cad-export.worker.ts", import.meta.url),
      );
      task.worker = worker;
      setBusy("Writing IFC…");
      const fail = (message: string) => {
        if (!task.cancelled) {
          onError(message);
          cancel();
        }
      };
      task.timer = setTimeout(
        () =>
          fail(
            "IFC export took too long. Try exporting only the design objects.",
          ),
        60_000,
      );
      worker.onerror = () =>
        fail("The export engine could not start. Reconnect and try again.");
      worker.onmessage = (
        event: MessageEvent<{ text?: string; error?: string }>,
      ) => {
        if (task.cancelled) return;
        if (event.data.error) {
          fail(event.data.error);
          return;
        }
        if (event.data.text)
          downloadCadFile(
            event.data.text,
            `${title.replace(/[^a-z0-9_-]/gi, "_")}-edited.ifc`,
            "application/x-step",
          );
        cancel();
      };
      worker.postMessage({ design, title, source });
    } catch (e) {
      if (!task.cancelled) {
        onError(e instanceof Error ? e.message : "IFC export failed.");
        cancel();
      }
    }
  };
  return (
    <div className="space-y-2 border-t pt-3">
      <Button
        variant="outline"
        className="w-full"
        disabled={!!busy}
        onClick={() => void run(false)}
      >
        Export design as IFC
      </Button>
      <Button
        variant="outline"
        className="w-full"
        disabled={!!busy}
        onClick={() => void run(true)}
      >
        Export entire edited model
      </Button>
      <p className="text-muted-foreground text-xs">
        IFC4 reference geometry, in metres. Includes final shapes, names and CAD
        properties. Original BIM relationships and parametric history are not
        retained.
      </p>
      {busy && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span>{busy}</span>
          <Button size="sm" variant="outline" onClick={cancel}>
            Cancel export
          </Button>
        </div>
      )}
    </div>
  );
}
