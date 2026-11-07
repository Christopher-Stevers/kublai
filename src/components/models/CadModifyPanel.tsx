"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Vector3 } from "three";
import { Button } from "~/components/ui/button";
import {
  type DesignElement,
  type ModelDesign,
  newDesignElement,
} from "~/lib/bim/design";
import { designLayers, isEditable } from "~/lib/bim/cad-geometry";
import {
  offsetOutline,
  roundOutline,
  meetLines,
  mirrorElements,
} from "~/lib/bim/cad-modify";
import { elementMeshes, meshBounds } from "~/lib/bim/cad-mesh";
import { calculateSolid } from "~/lib/bim/solid-client";
import type { SolidOperation } from "~/lib/bim/solid-kernel";
import type { ModelScene } from "~/lib/bim/scene";
import type { Point3 } from "~/lib/bim/types";
const field = "bg-background w-full min-w-0 rounded border p-2 text-sm";
export function CadModifyPanel({
  design,
  selection,
  scene,
  modelId,
  canDelete,
  unit,
  factor,
  onChange,
  onError,
}: {
  design: ModelDesign;
  selection: string[];
  scene: ModelScene;
  modelId: string;
  canDelete: boolean;
  unit: string;
  factor: number;
  onChange: (doc: ModelDesign, selection: string[]) => boolean;
  onError: (message: string) => void;
}) {
  const [distance, setDistance] = useState("0.1"),
    [mirrorAxis, setMirrorAxis] = useState<0 | 1 | 2>(0),
    [mirrorAt, setMirrorAt] = useState("0"),
    [keep, setKeep] = useState(!canDelete),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  const abort = useRef<AbortController | null>(null),
    current = useRef(design);
  useLayoutEffect(() => {
    current.current = design;
  }, [design]);
  useEffect(() => () => abort.current?.abort(), []);
  const chosen = selection
    .map((id) => design.elements.find((e) => e.id === id))
    .filter((e): e is DesignElement => !!e);
  const safe = (operation: () => void) => {
    try {
      onError("");
      operation();
    } catch (e) {
      onError(
        e instanceof Error ? e.message : "Unable to edit this selection.",
      );
    }
  };
  const editable = () => {
    if (!chosen.length || chosen.length !== selection.length)
      throw Error(
        "Choose design objects for this operation. Solid tools also support imported objects.",
      );
    if (chosen.some((e) => !isEditable(design, e)))
      throw Error("Unlock and show the selected layers first.");
  };
  const modify = (
    action: "offset" | "fillet" | "chamfer" | "trim" | "extend",
  ) =>
    safe(() => {
      editable();
      const d = Number(distance) / factor;
      let updates: DesignElement[];
      if (action === "trim" || action === "extend") {
        if (chosen.length !== 2)
          throw Error(
            "Select two straight lines, with the line to change first.",
          );
        updates = [meetLines(chosen[0]!, chosen[1]!, action === "extend")];
      } else
        updates = chosen.map((e) =>
          action === "offset"
            ? {
                ...offsetOutline(e, d),
                id: crypto.randomUUID(),
                name: `${e.name.slice(0, 150)} offset`,
              }
            : roundOutline(e, d, action),
        );
      onChange(
        {
          ...design,
          elements:
            action === "offset"
              ? [...design.elements, ...updates]
              : design.elements.map(
                  (e) => updates.find((n) => n.id === e.id) ?? e,
                ),
        },
        updates.map((e) => e.id),
      );
    });
  const boolean = async (operation: SolidOperation) => {
    const base = design;
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (selection.length < (operation === "convert" ? 1 : 2))
        throw Error(
          "Select at least two solids. For subtraction, select the body to keep first.",
        );
      if (chosen.some((e) => !isEditable(design, e)))
        throw Error("Unlock and show the selected layers first.");
      if (!keep && !canDelete)
        throw Error(
          "Removing the original objects requires model delete permission.",
        );
      const origin: Point3 = chosen.find((e) => e.id === selection[0])
        ?.position ??
        (scene.elements
          .get(`${modelId}:${selection[0]?.slice(7)}`)
          ?.bounds.getCenter(new Vector3())
          .add(scene.origin)
          .toArray() as Point3) ?? [0, 0, 0];
      const objects = selection.map((id) => {
        const e = chosen.find((e) => e.id === id);
        return e
          ? { name: e.name, meshes: elementMeshes(e, origin) }
          : {
              name:
                scene.elements.get(`${modelId}:${id.slice(7)}`)?.info.name ??
                "Imported object",
              meshes: scene.editorGeometry(
                modelId,
                Number(id.slice(7)),
                origin,
              ),
            };
      });
      setBusy(true);
      onError("");
      const answer = await calculateSolid(
        { operation, objects },
        controller.signal,
      );
      if (current.current !== base)
        throw Error(
          "The design changed while calculating. Your edits are safe; run the operation again.",
        );
      const bounds = meshBounds(answer.mesh),
        centre = bounds.getCenter(new Vector3()),
        size = bounds.getSize(new Vector3());
      for (let i = 0; i < answer.mesh.positions.length; i += 3) {
        answer.mesh.positions[i]! -= centre.x;
        answer.mesh.positions[i + 1]! -= centre.y;
        answer.mesh.positions[i + 2]! -= centre.z;
      }
      const object = {
        ...newDesignElement(
          "solid",
          new Vector3(...origin).add(centre).toArray() as Point3,
        ),
        mesh: answer.mesh,
        name: `${operation === "union" ? "Union" : operation === "subtract" ? "Cut" : operation === "convert" ? "Solid" : "Intersection"} · ${objects[0]!.name}`.slice(
          0,
          160,
        ),
        color: chosen[0]?.color ?? "#38bdf8",
        layer: chosen[0]?.layer ?? designLayers(base)[0]?.name ?? "Design",
        system: chosen[0]?.system ?? "",
        material: chosen[0]?.material ?? "",
        size: size
          .toArray()
          .map((n) => Math.max(0.001, Math.min(1000, n))) as Point3,
      };
      const overrides = [...base.overrides];
      if (!keep)
        for (const id of selection.filter((id) => id.startsWith("source:"))) {
          const expressId = Number(id.slice(7)),
            old = overrides.find((o) => o.expressId === expressId);
          if (old)
            overrides.splice(overrides.indexOf(old), 1, {
              ...old,
              deleted: true,
            });
          else
            overrides.push({
              expressId,
              name: "",
              translation: [0, 0, 0],
              rotation: [0, 0, 0],
              deleted: true,
            });
        }
      if (
        !onChange(
          {
            ...base,
            elements: [
              ...base.elements.filter((e) => keep || !selection.includes(e.id)),
              object,
            ],
            overrides,
          },
          [object.id],
        )
      )
        return;
      setResult(
        `${(answer.volume * factor ** 3).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit}³ · ${(answer.area * factor ** 2).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}²`,
      );
    } catch (e) {
      if (!controller.signal.aborted)
        onError(e instanceof Error ? e.message : "Solid operation failed.");
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-xs">
        {selection.length} selected. Shift-click or enable multiple selection in
        Properties.
      </p>
      <fieldset disabled={busy} className="space-y-3 border-b pb-4">
        <legend className="mb-2 font-medium">Solid tools</legend>
        <p className="text-muted-foreground text-xs">
          Union joins bodies. Subtract cuts the remaining selection from the
          first object. Intersect keeps the shared volume.
        </p>
        <ol className="max-h-28 list-decimal overflow-auto pl-5 text-xs">
          {selection.map((id) => (
            <li key={id}>
              {chosen.find((e) => e.id === id)?.name ??
                scene.elements.get(`${modelId}:${id.slice(7)}`)?.info.name ??
                id}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {(["union", "subtract", "intersect"] as const).map((op) => (
            <Button
              key={op}
              variant="outline"
              size="sm"
              disabled={selection.length < 2}
              onClick={() => void boolean(op)}
            >
              {op[0]!.toUpperCase() + op.slice(1)}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={selection.length !== 1}
          onClick={() => void boolean("convert")}
        >
          Make editable solid
        </Button>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={keep}
            disabled={!canDelete}
            onChange={(e) => setKeep(e.target.checked)}
          />
          Keep original objects
        </label>
        {result && (
          <p className="text-muted-foreground text-xs" role="status">
            Last solid: {result}
          </p>
        )}
      </fieldset>
      {busy && (
        <div className="flex items-center justify-between" role="status">
          <span>Calculating solid…</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => abort.current?.abort()}
          >
            Cancel operation
          </Button>
        </div>
      )}
      <fieldset disabled={busy} className="space-y-3 border-b pb-4">
        <legend className="mb-2 font-medium">Outline tools</legend>
        <label className="block space-y-1 text-xs">
          Distance / radius ({unit})
          <input
            aria-label="Outline distance"
            type="number"
            step="any"
            className={field}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["offset", "fillet", "chamfer", "trim", "extend"] as const).map(
            (op) => (
              <Button
                key={op}
                variant="outline"
                size="sm"
                onClick={() => modify(op)}
              >
                {op[0]!.toUpperCase() + op.slice(1)}
              </Button>
            ),
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Positive offset goes outward on closed shapes, left on open paths.
          Fillet rounds corners; chamfer bevels them. Trim/Extend moves the
          nearest endpoint of the first line to the second line.
        </p>
      </fieldset>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-2 font-medium">Mirror a copy</legend>
        <label className="block space-y-1 text-xs">
          Across axis
          <select
            aria-label="Mirror axis"
            className={field}
            value={mirrorAxis}
            onChange={(e) => setMirrorAxis(Number(e.target.value) as 0 | 1 | 2)}
          >
            <option value={0}>X</option>
            <option value={1}>Y (height)</option>
            <option value={2}>Z</option>
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          Mirror plane coordinate ({unit})
          <input
            aria-label="Mirror coordinate"
            type="number"
            className={field}
            value={mirrorAt}
            onChange={(e) => setMirrorAt(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            safe(() => {
              editable();
              const value = Number(mirrorAt) / factor;
              if (!Number.isFinite(value))
                throw Error("Enter a mirror coordinate.");
              const copies = mirrorElements(chosen, mirrorAxis, value);
              onChange(
                { ...design, elements: [...design.elements, ...copies] },
                copies.map((e) => e.id),
              );
            })
          }
        >
          Create mirrored copy
        </Button>
      </fieldset>
    </div>
  );
}
