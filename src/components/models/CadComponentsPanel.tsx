"use client";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  makeComponent,
  insertComponent,
  pipeRackComponent,
} from "~/lib/bim/cad-components";
import { designLayers, isEditable } from "~/lib/bim/cad-geometry";
import type { CadComponent, ModelDesign } from "~/lib/bim/design";
import type { ModelScene } from "~/lib/bim/scene";
import type { Point3 } from "~/lib/bim/types";
export function CadComponentsPanel({
  design,
  selection,
  activeLayer,
  scene,
  onChange,
  onError,
}: {
  design: ModelDesign;
  selection: string[];
  activeLayer: string;
  scene: ModelScene;
  onChange: (doc: ModelDesign, selection: string[]) => boolean;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const components = design.components ?? [];
  const safe = (fn: () => void) => {
    try {
      onError("");
      fn();
    } catch (e) {
      onError(
        e instanceof Error ? e.message : "Could not update the component.",
      );
    }
  };
  const insert = (component: CadComponent) =>
    safe(() => {
      const layer = designLayers(design).find((l) => l.name === activeLayer);
      if (!layer || layer.locked || !layer.visible)
        throw Error("Choose an unlocked, visible layer before inserting.");
      const point = scene.controls.target
        .clone()
        .add(scene.origin)
        .toArray() as Point3;
      const objects = insertComponent(component, point, activeLayer);
      onChange(
        { ...design, elements: [...design.elements, ...objects] },
        objects.map((e) => e.id),
      );
    });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <strong className="text-sm">Reusable parts & assemblies</strong>
        <p className="text-muted-foreground text-xs">
          Save a selection, then insert copies at the centre of the active view.
          Copies can be edited independently. Your library is saved with this
          design.
        </p>
      </div>
      <label className="block space-y-1 text-xs">
        Component name
        <input
          aria-label="Component name"
          className="bg-background w-full min-w-0 rounded border p-2 text-sm"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          safe(() => {
            const objects = design.elements.filter(
              (e) => selection.includes(e.id) && isEditable(design, e),
            );
            if (objects.length !== selection.length)
              throw Error(
                "Choose unlocked design objects. Imported geometry must be converted to a solid first.",
              );
            const component = makeComponent(name, objects);
            if (
              onChange(
                { ...design, components: [...components, component] },
                selection,
              )
            )
              setName("");
          })
        }
      >
        Save selection as component
      </Button>
      <div className="divide-y">
        {components.map((component) => (
          <div key={component.id} className="space-y-2 py-3">
            <strong className="block text-sm">{component.name}</strong>
            <span className="text-muted-foreground text-xs">
              {component.elements.length} objects
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => insert(component)}
              >
                Insert {component.name}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(
                    {
                      ...design,
                      components: components.filter(
                        (c) => c.id !== component.id,
                      ),
                    },
                    selection,
                  )
                }
              >
                Remove template
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t pt-3">
        <strong className="text-xs">Starter assembly</strong>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => insert(pipeRackComponent())}
        >
          Insert pipe rack
        </Button>
        <p className="text-muted-foreground text-xs">
          1.25 m wide, 2.2 m tall, three crossbars. Adjust the individual
          members after insertion.
        </p>
      </div>
    </div>
  );
}
