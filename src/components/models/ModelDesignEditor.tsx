"use client";
import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Pencil,
  Plus,
  Save,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  X,
  Focus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";
import { DesignLayer } from "~/lib/bim/design-layer";
import {
  designKinds,
  designSchema,
  newDesignElement,
  emptyDesign,
  type ModelDesign,
  type DesignElement,
  type DesignKind,
  type DesignOverride,
} from "~/lib/bim/design";
import type { ModelScene } from "~/lib/bim/scene";
import type { BimWorkspace } from "~/lib/bim/types";

export function ModelDesignEditor({
  workspace: w,
  modelId,
  scene,
  ready,
  active,
  onClose,
}: {
  workspace: BimWorkspace;
  modelId: string;
  scene: ModelScene;
  ready: boolean;
  active: boolean;
  onClose: () => void;
}) {
  const query = api.models.design.useQuery(
    { jobId: w.job.id, id: modelId },
    { enabled: ready, refetchInterval: 15000 },
  );
  const save = api.models.saveDesign.useMutation();
  const [design, setDesign] = useState<ModelDesign>(emptyDesign),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [placing, setPlacing] = useState<DesignKind | null>(null),
    [collapsed, setCollapsed] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"translate" | "rotate">("translate"),
    [snap, setSnap] = useState(0.05),
    [elevation, setElevation] = useState(0),
    [history, setHistory] = useState<ModelDesign[]>([]),
    [future, setFuture] = useState<ModelDesign[]>([]);
  const layer = useRef<DesignLayer | null>(null),
    current = useRef({ design, revision, dirty, loaded });
  useLayoutEffect(() => {
    current.current = { design, revision, dirty, loaded };
  });
  const key = `foremanhq:model-design:${w.userId}:${w.job.id}:${modelId}`;
  const commit = (next: ModelDesign) => {
    if (!w.canUpload) return;
    const parsed = designSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the values.");
      return;
    }
    setHistory((h) => [...h.slice(-49), design]);
    setFuture([]);
    setDesign(parsed.data);
    setDirty(true);
    setError("");
  };
  const callbacks = useRef({ commit });
  useLayoutEffect(() => {
    callbacks.current = { commit };
  });
  useEffect(() => {
    const next = new DesignLayer(scene, modelId, {
      select: setSelected,
      place: (kind, point, end) => {
        const object = newDesignElement(kind, point);
        if (end) {
          const start = new Vector3(...point),
            finish = new Vector3(...end),
            direction = finish.clone().sub(start);
          object.position = start.add(finish).multiplyScalar(0.5).toArray() as [
            number,
            number,
            number,
          ];
          object.size[1] = direction.length();
          const rotation = new Euler().setFromQuaternion(
            new Quaternion().setFromUnitVectors(
              new Vector3(0, 1, 0),
              direction.normalize(),
            ),
          );
          object.rotation = [rotation.x, rotation.y, rotation.z].map(
            MathUtils.radToDeg,
          ) as [number, number, number];
        }
        callbacks.current.commit({
          ...current.current.design,
          elements: [...current.current.design.elements, object],
        });
        setSelected(object.id);
        setPlacing(null);
      },
      transform: (id, position, rotation) => {
        const doc = current.current.design;
        if (id.startsWith("source:")) {
          const expressId = Number(id.slice(7)),
            existing = doc.overrides.find((o) => o.expressId === expressId);
          const center = next.sourceCenter(expressId);
          if (!center) return;
          const override: DesignOverride = existing ?? {
            expressId,
            name: "",
            translation: [0, 0, 0],
            rotation: [0, 0, 0],
            deleted: false,
          };
          const translation = position.map(
            (v, i) => v - center[i]! + override.translation[i]!,
          ) as [number, number, number];
          callbacks.current.commit({
            ...doc,
            overrides: [
              ...doc.overrides.filter((o) => o.expressId !== expressId),
              {
                ...override,
                translation,
                rotation,
              },
            ],
          });
        } else
          callbacks.current.commit({
            ...doc,
            elements: doc.elements.map((e) =>
              e.id === id ? { ...e, position, rotation } : e,
            ),
          });
      },
    });
    layer.current = next;
    return () => {
      next.dispose();
      layer.current = null;
    };
  }, [scene, modelId]);
  useEffect(() => {
    if (!query.data || current.current.dirty) return;
    if (!current.current.loaded) {
      try {
        const raw = JSON.parse(localStorage.getItem(key) ?? "null") as {
          design: unknown;
          revision: number;
        } | null;
        if (raw && Number.isInteger(raw.revision) && w.canUpload) {
          const parsed = designSchema.safeParse(raw.design);
          if (parsed.success) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate an external persisted draft once.
            setDesign(parsed.data);
            setRevision(raw.revision);
            setDirty(true);
            setLoaded(true);
            setError("Recovered your unsaved model draft.");
            return;
          }
        }
      } catch {
        /* No local draft. */
      }
    }
    setDesign(query.data.design);
    setRevision(query.data.revision);
    setLoaded(true);
  }, [query.data, key, w.canUpload]);
  useEffect(() => {
    if (loaded) layer.current?.setDesign(design);
  }, [design, loaded, scene, ready]);
  useEffect(() => {
    layer.current?.setActive(active && loaded && w.canUpload);
    return () => layer.current?.setActive(false);
  }, [active, loaded, w.canUpload, scene]);
  useEffect(() => {
    layer.current?.select(selected);
  }, [selected, design]);
  useEffect(() => {
    if (layer.current) {
      layer.current.placing = placing;
      layer.current.snap = snap;
      layer.current.elevation = elevation;
      layer.current.setMode(mode);
    }
  }, [placing, snap, elevation, mode]);
  useEffect(() => {
    const persist = () => {
      const c = current.current;
      if (!c.loaded) return;
      try {
        if (c.dirty)
          localStorage.setItem(
            key,
            JSON.stringify({ design: c.design, revision: c.revision }),
          );
        else localStorage.removeItem(key);
      } catch {
        /* Server save remains available. */
      }
    };
    const timer = setTimeout(persist, 200);
    const warn = (e: BeforeUnloadEvent) => {
      if (current.current.dirty) {
        persist();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(timer);
      persist();
      window.removeEventListener("beforeunload", warn);
    };
  }, [design, dirty, revision, key]);
  if (!active) {
    if (query.error && !loaded)
      return (
        <div
          role="alert"
          className="bg-background text-destructive absolute top-3 left-3 max-w-56 rounded border p-2 text-xs"
        >
          Saved model edits could not load.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      );
    if (dirty)
      return (
        <div
          role="status"
          className="bg-background text-primary absolute top-3 left-3 max-w-56 rounded border p-2 text-xs"
        >
          Unsaved local design · {w.models.find((m) => m.id === modelId)?.name}
        </div>
      );
    return null;
  }
  const element = design.elements.find((e) => e.id === selected);
  const sourceId = selected?.startsWith("source:")
    ? Number(selected.slice(7))
    : null;
  const imported = sourceId
    ? scene.elements.get(`${modelId}:${sourceId}`)?.info
    : null;
  const override = sourceId
    ? (design.overrides.find((o) => o.expressId === sourceId) ?? {
        expressId: sourceId,
        name: imported?.name ?? "Element",
        translation: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        deleted: false,
      })
    : null;
  const update = (patch: Partial<DesignElement>) =>
    element &&
    commit({
      ...design,
      elements: design.elements.map((e) =>
        e.id === element.id ? { ...e, ...patch } : e,
      ),
    });
  const updateSource = (patch: Partial<DesignOverride>) =>
    override &&
    commit({
      ...design,
      overrides: [
        ...design.overrides.filter((o) => o.expressId !== sourceId),
        { ...override, ...patch },
      ],
    });
  const axisFields = (
    label: string,
    values: [number, number, number],
    change: (v: [number, number, number]) => void,
  ) => (
    <fieldset className="space-y-1">
      <legend className="text-muted-foreground text-xs">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {values.map((v, i) => (
          <label key={i} className="text-xs">
            {["X", "Y (height)", "Z"][i]}
            <input
              aria-label={`${label} ${["X", "Y", "Z"][i]}`}
              type="number"
              step={label.includes("rotation") ? 15 : 0.01}
              className="bg-background w-full min-w-0 rounded border p-2"
              value={Number(v.toFixed(5))}
              onChange={(e) => {
                if (!Number.isFinite(e.target.valueAsNumber)) return;
                const next = [...values] as [number, number, number];
                next[i] = e.target.valueAsNumber;
                change(next);
              }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
  const close = async () => {
    let retained = true;
    if (dirty)
      try {
        localStorage.setItem(key, JSON.stringify({ design, revision }));
      } catch {
        retained = false;
      }

    if (
      dirty &&
      !(await confirmAction({
        title: "Leave model editing?",
        description: retained
          ? "Your unsaved draft will remain on this device. Other team members only see saved changes."
          : "Local draft storage is unavailable. Save your design before leaving or these edits could be lost.",
        confirmLabel: "Leave editor",
      }))
    )
      return;
    setPlacing(null);
    onClose();
  };
  return (
    <section
      aria-label="Model editor"
      className="bg-background/95 absolute right-2 bottom-2 left-2 z-30 rounded-xl border shadow-xl sm:left-auto sm:w-[380px]"
    >
      <header className="flex items-center gap-2 border-b p-2">
        <Pencil className="size-4" />
        <strong className="flex-1 text-sm">
          Model editor {dirty ? "· Unsaved" : ""}
        </strong>
        <button
          aria-label={collapsed ? "Expand editor" : "Collapse editor"}
          className="p-2"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
        <button
          aria-label="Close editor"
          className="p-2"
          onClick={() => void close()}
        >
          <X />
        </button>
      </header>
      {!collapsed && (
        <div className="max-h-[48dvh] space-y-3 overflow-y-auto p-3 text-sm">
          {!loaded ? (
            <p>{query.error?.message ?? "Loading saved design…"}</p>
          ) : (
            <>
              <p className="text-muted-foreground text-xs">
                Saved design layer · dimensions in metres · rotations in
                degrees. Select an element or add one, then drag its handles or
                enter exact values.
              </p>
              <div className="flex gap-2">
                <select
                  aria-label="Add model element"
                  className="bg-background min-h-10 min-w-0 flex-1 rounded border px-2"
                  value={placing ?? ""}
                  onChange={(e) => {
                    setPlacing((e.target.value as DesignKind) || null);
                    setSelected(null);
                  }}
                >
                  <option value="">Add element…</option>
                  {Object.entries(designKinds).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={() => {
                    const object = newDesignElement(
                      placing ?? "equipment",
                      scene.controls.target
                        .clone()
                        .add(scene.origin)
                        .toArray() as [number, number, number],
                    );
                    commit({
                      ...design,
                      elements: [...design.elements, object],
                    });
                    setSelected(object.id);
                    setPlacing(null);
                  }}
                >
                  <Plus className="mr-1 size-4" />
                  At view
                </Button>
              </div>
              {placing && (
                <p role="status" className="text-primary">
                  {placing === "pipe" || placing === "duct"
                    ? "Tap start and end points on the model or working plane for"
                    : "Tap the model surface or working plane to place"}{" "}
                  {designKinds[placing].toLowerCase()}.{" "}
                  <button
                    className="underline"
                    onClick={() => setPlacing(null)}
                  >
                    Cancel
                  </button>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Grid snap (m)
                  <input
                    aria-label="Grid snap"
                    type="number"
                    min="0"
                    max="10"
                    step="0.01"
                    value={snap}
                    className="bg-background mt-1 w-full rounded border p-2"
                    onChange={(e) =>
                      setSnap(
                        Math.max(0, Math.min(10, e.target.valueAsNumber || 0)),
                      )
                    }
                  />
                </label>
                <label className="text-xs">
                  Working plane height (m)
                  <input
                    aria-label="Working plane height"
                    type="number"
                    step=".1"
                    value={elevation}
                    className="bg-background mt-1 w-full rounded border p-2"
                    onChange={(e) => setElevation(e.target.valueAsNumber || 0)}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={mode === "translate" ? "default" : "outline"}
                  onClick={() => setMode("translate")}
                >
                  Move
                </Button>
                <Button
                  variant={mode === "rotate" ? "default" : "outline"}
                  onClick={() => setMode("rotate")}
                >
                  Rotate
                </Button>
                {selected && (
                  <Button
                    variant="outline"
                    aria-label="Focus edited element"
                    onClick={() => layer.current?.focus(selected)}
                  >
                    <Focus className="size-4" />
                  </Button>
                )}
              </div>
              <select
                aria-label="Select design element"
                className="bg-background min-h-10 w-full rounded border px-2"
                value={selected ?? ""}
                onChange={(e) => setSelected(e.target.value || null)}
              >
                <option value="">Select in model or list…</option>
                {design.elements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
                {design.overrides.map((o) => (
                  <option key={o.expressId} value={`source:${o.expressId}`}>
                    {o.deleted ? "Removed · " : ""}
                    {o.name ? o.name : `Original #${o.expressId}`}
                  </option>
                ))}
                {sourceId &&
                  !design.overrides.some((o) => o.expressId === sourceId) && (
                    <option value={selected!}>
                      {imported?.name ?? `Original #${sourceId}`}
                    </option>
                  )}
              </select>
              {(element ?? override) && (
                <>
                  <label className="block text-xs">
                    Name
                    <input
                      aria-label="Element name"
                      className="bg-background mt-1 w-full rounded border p-2"
                      value={element?.name ?? override?.name ?? ""}
                      onChange={(e) =>
                        element
                          ? update({ name: e.target.value })
                          : updateSource({ name: e.target.value })
                      }
                    />
                  </label>
                  {element ? (
                    <>
                      {axisFields("Position (m)", element.position, (v) =>
                        update({ position: v }),
                      )}
                      {["pipe", "elbow", "tee", "valve"].includes(
                        element.kind,
                      ) ? (
                        <label className="block text-xs">
                          {element.kind === "elbow"
                            ? "Bend size (m)"
                            : "Length (m)"}
                          <input
                            aria-label="Element length"
                            className="bg-background mt-1 w-full rounded border p-2"
                            type="number"
                            min=".001"
                            max="1000"
                            step=".01"
                            value={element.size[1]}
                            onChange={(e) =>
                              Number.isFinite(e.target.valueAsNumber) &&
                              update({
                                size: [
                                  element.size[0],
                                  e.target.valueAsNumber,
                                  element.size[2],
                                ],
                              })
                            }
                          />
                        </label>
                      ) : (
                        axisFields("Size (m)", element.size, (v) =>
                          update({ size: v }),
                        )
                      )}
                      {axisFields(
                        "Element rotation (degrees)",
                        element.rotation,
                        (v) => update({ rotation: v }),
                      )}
                      {["pipe", "elbow", "tee", "valve"].includes(
                        element.kind,
                      ) && (
                        <label className="block text-xs">
                          Pipe diameter (m)
                          <input
                            aria-label="Pipe diameter"
                            className="bg-background mt-1 w-full rounded border p-2"
                            type="number"
                            min=".001"
                            max="1000"
                            step=".001"
                            value={element.diameter}
                            onChange={(e) =>
                              Number.isFinite(e.target.valueAsNumber) &&
                              update({ diameter: e.target.valueAsNumber })
                            }
                          />
                        </label>
                      )}
                      <div className="flex items-center gap-2">
                        <label>
                          Colour{" "}
                          <input
                            aria-label="Element colour"
                            type="color"
                            value={element.color}
                            onChange={(e) => update({ color: e.target.value })}
                          />
                        </label>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const copy = {
                              ...element,
                              id: crypto.randomUUID(),
                              name: `${element.name} copy`,
                              position: [
                                element.position[0] + 0.5,
                                element.position[1],
                                element.position[2],
                              ] as [number, number, number],
                            };
                            commit({
                              ...design,
                              elements: [...design.elements, copy],
                            });
                            setSelected(copy.id);
                          }}
                        >
                          <Copy className="mr-1 size-4" />
                          Duplicate
                        </Button>
                      </div>
                      {(["system", "material", "notes"] as const).map((k) => (
                        <label key={k} className="block text-xs capitalize">
                          {k}
                          <input
                            aria-label={`Element ${k}`}
                            className="bg-background mt-1 w-full rounded border p-2"
                            value={element[k]}
                            onChange={(e) => update({ [k]: e.target.value })}
                          />
                        </label>
                      ))}
                    </>
                  ) : (
                    override && (
                      <>
                        {axisFields("Offset (m)", override.translation, (v) =>
                          updateSource({ translation: v }),
                        )}
                        {axisFields(
                          "Element rotation (degrees)",
                          override.rotation,
                          (v) => updateSource({ rotation: v }),
                        )}
                        <p className="text-muted-foreground text-xs">
                          Original geometry is retained. Offsets and rotations
                          apply to this entire element.
                        </p>
                      </>
                    )
                  )}
                  {w.canDelete && (
                    <Button
                      variant="outline"
                      className="text-destructive"
                      onClick={() => {
                        if (element) {
                          commit({
                            ...design,
                            elements: design.elements.filter(
                              (e) => e.id !== element.id,
                            ),
                          });
                          setSelected(null);
                        } else updateSource({ deleted: !override!.deleted });
                      }}
                    >
                      <Trash2 className="mr-1 size-4" />
                      {override?.deleted ? "Restore element" : "Remove element"}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      {(error || save.error) && (
        <p role="alert" className="text-destructive px-3 py-2 text-xs">
          {error || save.error?.message}
        </p>
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t p-2">
        <Button
          aria-label="Undo model edit"
          variant="outline"
          disabled={!history.length || save.isPending}
          onClick={() => {
            const last = history.at(-1)!;
            setHistory((h) => h.slice(0, -1));
            setFuture((f) => [design, ...f]);
            setDesign(last);
            setDirty(true);
          }}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          aria-label="Redo model edit"
          variant="outline"
          disabled={!future.length || save.isPending}
          onClick={() => {
            setHistory((h) => [...h, design]);
            setDesign(future[0]!);
            setFuture((f) => f.slice(1));
            setDirty(true);
          }}
        >
          <Redo2 className="size-4" />
        </Button>
        <Button
          className="flex-1"
          disabled={!loaded || !dirty || save.isPending}
          onClick={() => {
            const snapshot = design;
            save.mutate(
              {
                jobId: w.job.id,
                id: modelId,
                expectedRevision: revision,
                design: snapshot,
              },
              {
                onSuccess: (result) => {
                  setRevision(result.revision);
                  if (current.current.design === snapshot) setDirty(false);
                  setError("");
                  void query.refetch();
                },
              },
            );
          }}
        >
          <Save className="mr-1 size-4" />
          {save.isPending ? "Saving…" : "Save design"}
        </Button>
        {save.error?.data?.code === "CONFLICT" && (
          <Button
            variant="outline"
            onClick={() =>
              void (async () => {
                if (
                  await confirmAction({
                    title: "Reload saved design?",
                    description:
                      "This replaces your local draft with the latest saved design.",
                    confirmLabel: "Reload",
                  })
                ) {
                  const result = await query.refetch();
                  if (result.data) {
                    setDesign(result.data.design);
                    setRevision(result.data.revision);
                    setDirty(false);
                    setHistory([]);
                    setFuture([]);
                    save.reset();
                  }
                }
              })()
            }
          >
            Reload saved
          </Button>
        )}
      </footer>
    </section>
  );
}
