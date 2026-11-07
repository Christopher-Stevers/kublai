"use client";
import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Save,
  Undo2,
  Redo2,
  X,
  Focus,
  SlidersHorizontal,
  LayoutGrid,
  MousePointer2,
  Move,
  RotateCw,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";
import { cn } from "~/lib/utils";
import { CadModifyPanel } from "./CadModifyPanel";
import { CadIfcExport } from "./CadIfcExport";
import { CadComponentsPanel } from "./CadComponentsPanel";
import { CadDxfImport } from "./CadDxfImport";
import { bindDimension, reconcileDimensions } from "~/lib/bim/cad-dimensions";
import { DesignLayer } from "~/lib/bim/design-layer";
import { CadViews } from "~/lib/bim/cad-views";
import {
  cadViews,
  createSketch,
  designLayers,
  duplicateElements,
  isEditable,
  planeAxes,
  sketchKinds,
  transformElements,
  type CadPlane,
  type CadView,
} from "~/lib/bim/cad-geometry";
import {
  designDxf,
  downloadCadFile,
  parseCad,
  serializeCad,
} from "~/lib/bim/cad-export";
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
import type { BimWorkspace, Point3 } from "~/lib/bim/types";
const inputClass =
  "bg-background w-full min-w-0 rounded border px-2 py-2 text-sm";
const units = { m: 1, mm: 1000, ft: 1 / 0.3048, in: 1 / 0.0254 };
type Unit = keyof typeof units;
function NumberField({
  label,
  value,
  onChange,
  step = 0.01,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      {label}
      <input
        key={value}
        aria-label={label}
        type="number"
        defaultValue={Number(value.toFixed(5))}
        step={step}
        min={min}
        max={max}
        className={inputClass}
        onBlur={(e) => {
          const n = e.target.valueAsNumber;
          if (
            Number.isFinite(n) &&
            (min === undefined || n >= min) &&
            (max === undefined || n <= max)
          )
            onChange(n);
          else e.target.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function VectorFields({
  label,
  value,
  change,
  factor = 1,
}: {
  label: string;
  value: Point3;
  change: (p: Point3) => void;
  factor?: number;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {value.map((v, i) => (
          <NumberField
            key={i}
            label={`${label} ${["X", "Y", "Z"][i]}`}
            value={v * factor}
            onChange={(n) => {
              const next = [...value] as Point3;
              next[i] = n / factor;
              change(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
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
  const utils = api.useUtils();
  const query = api.models.design.useQuery(
      { jobId: w.job.id, id: modelId },
      { enabled: ready, staleTime: Infinity, refetchOnWindowFocus: false },
    ),
    save = api.models.saveDesign.useMutation();
  const revisionStatus = api.models.designStatus.useQuery(
    { jobId: w.job.id, id: modelId },
    { enabled: ready, refetchInterval: 15000, staleTime: 0 },
  );
  const loadedRevision = query.data?.revision;
  const remoteRevision = revisionStatus.data?.revision;
  const refetchDesign = query.refetch;
  useEffect(() => {
    if (
      loadedRevision !== undefined &&
      remoteRevision !== undefined &&
      remoteRevision > loadedRevision
    )
      void refetchDesign();
  }, [
    loadedRevision,
    remoteRevision,
    revisionStatus.dataUpdatedAt,
    refetchDesign,
  ]);
  const [design, setDesign] = useState<ModelDesign>(emptyDesign),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const [selection, setSelection] = useState<string[]>([]),
    [placing, setPlacing] = useState<DesignKind | null>(null),
    [history, setHistory] = useState<ModelDesign[]>([]),
    [future, setFuture] = useState<ModelDesign[]>([]);
  const [view, setView] = useState<CadView>("3d"),
    [quad, setQuad] = useState(
      () => typeof window !== "undefined" && window.innerWidth >= 1024,
    ),
    [inspector, setInspector] = useState(
      () => typeof window !== "undefined" && window.innerWidth >= 1024,
    ),
    [tab, setTab] = useState<
      "properties" | "modify" | "objects" | "layers" | "library" | "file"
    >("properties");
  const [mode, setMode] = useState<"translate" | "rotate">("translate"),
    [snap, setSnap] = useState(0.05),
    [angle, setAngle] = useState<0 | 45 | 90>(0),
    [objectSnap, setObjectSnap] = useState(true),
    [surface, setSurface] = useState(false),
    [chain, setChain] = useState(false),
    [exactLength, setExactLength] = useState(0),
    [unit, setUnit] = useState<Unit>("m");
  const [plane, setPlane] = useState<CadPlane>("top"),
    [offsets, setOffsets] = useState<Point3>([0, 0, 0]),
    [activeLayer, setActiveLayer] = useState("Design"),
    [newLayer, setNewLayer] = useState(""),
    [status, setStatus] = useState("Select an object or choose a drawing tool"),
    [search, setSearch] = useState("");
  const [point, setPoint] = useState<Point3>([0, 0, 0]),
    [arrayOffset, setArrayOffset] = useState<Point3>([1, 0, 0]),
    [copies, setCopies] = useState(1),
    [multi, setMulti] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [vertexEditing, setVertexEditing] = useState(false);
  const layer = useRef<DesignLayer | null>(null),
    views = useRef<CadViews | null>(null),
    viewHost = useRef<HTMLDivElement>(null),
    current = useRef({
      design,
      revision,
      dirty,
      loaded,
      selection,
      activeLayer,
      chain,
    });
  useLayoutEffect(() => {
    current.current = {
      design,
      revision,
      dirty,
      loaded,
      selection,
      activeLayer,
      chain,
    };
  });
  const key = `foremanhq:model-design:${w.userId}:${w.job.id}:${modelId}`,
    factor = units[unit],
    layers = designLayers(design);
  const selected = selection.length === 1 ? selection[0] : null,
    element = design.elements.find((e) => e.id === selected),
    sourceId = selected?.startsWith("source:")
      ? Number(selected.slice(7))
      : null;
  const source = sourceId
    ? scene.elements.get(`${modelId}:${sourceId}`)?.info
    : null;
  const override: DesignOverride | null = sourceId
    ? (design.overrides.find((o) => o.expressId === sourceId) ?? {
        expressId: sourceId,
        name: source?.name ?? "Element",
        translation: [0, 0, 0],
        rotation: [0, 0, 0],
        deleted: false,
      })
    : null;
  const editable = element ? isEditable(design, element) : true;
  const commit = (next: ModelDesign) => {
    if (!w.canUpload) return false;
    next = reconcileDimensions(next, current.current.design);
    const parsed = designSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the drawing values.");
      return false;
    }
    setHistory((h) => [...h.slice(-49), current.current.design]);
    setFuture([]);
    // Geometry arrays are immutable. Retain their identities across property edits
    // instead of holding 50 deep mesh copies in undo history.
    setDesign({
      ...parsed.data,
      elements: parsed.data.elements.map((e, i) => ({
        ...e,
        mesh: next.elements[i]?.mesh,
        points: next.elements[i]?.points,
      })),
      components: next.components,
    });
    setDirty(true);
    setError("");
    return true;
  };
  const select = (id: string | null, extend = false) =>
    setSelection((old) =>
      !id
        ? []
        : extend || multi
          ? old.includes(id)
            ? old.filter((k) => k !== id)
            : [...old, id]
          : [id],
    );
  const update = (patch: Partial<DesignElement>) =>
    element &&
    editable &&
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
  const undo = () => {
    const last = history.at(-1);
    if (!last || save.isPending) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [design, ...f]);
    setDesign(last);
    setDirty(true);
    layer.current?.cancelDraft();
  };
  const redo = () => {
    if (!future.length || save.isPending) return;
    setHistory((h) => [...h, design]);
    setDesign(future[0]!);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };
  const saveNow = () => {
    if (!loaded || !dirty || save.isPending) return;
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
          utils.models.design.setData({ jobId: w.job.id, id: modelId }, result);
          utils.models.designStatus.setData(
            { jobId: w.job.id, id: modelId },
            { revision: result.revision },
          );
        },
      },
    );
  };
  const duplicate = (count = 1) => {
    const objects = design.elements.filter(
      (e) => selection.includes(e.id) && isEditable(design, e),
    );
    if (!objects.length) return;
    const additions = duplicateElements(objects, arrayOffset, count);
    if (!commit({ ...design, elements: [...design.elements, ...additions] }))
      return;
    setSelection(additions.map((e) => e.id));
  };
  const remove = () => {
    if (!w.canDelete) return;
    const next = {
      ...design,
      elements: design.elements.filter(
        (e) => !selection.includes(e.id) || !isEditable(design, e),
      ),
      overrides: [...design.overrides],
    };
    for (const id of selection.filter((id) => id.startsWith("source:"))) {
      const expressId = Number(id.slice(7)),
        old = next.overrides.find((o) => o.expressId === expressId);
      next.overrides = next.overrides.filter((o) => o.expressId !== expressId);
      next.overrides.push(
        old
          ? { ...old, deleted: true }
          : {
              expressId,
              name: "",
              translation: [0, 0, 0],
              rotation: [0, 0, 0],
              deleted: true,
            },
      );
    }
    if (commit(next)) setSelection([]);
  };
  const add = (object: DesignElement) => {
    const doc = current.current.design,
      l = designLayers(doc).find((l) => l.name === current.current.activeLayer);
    if (!l || l.locked || !l.visible) {
      setError("Choose an unlocked, visible layer before drawing.");
      return;
    }
    object.layer = l.name;
    if (object.kind === "dimension")
      object = bindDimension(
        {
          ...object,
          dimension: { offset: 0.2, unit, precision: unit === "mm" ? 0 : 2 },
        },
        doc,
      );
    if (!commit({ ...doc, elements: [...doc.elements, object] })) return;
    setSelection([object.id]);
    if (!current.current.chain) setPlacing(null);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (
      (event.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable='true']",
      )
    )
      return;
    const modifier = event.ctrlKey || event.metaKey,
      k = event.key.toLowerCase();
    if (modifier && k === "s") {
      event.preventDefault();
      saveNow();
    } else if (modifier && k === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (modifier && k === "y") {
      event.preventDefault();
      redo();
    } else if (modifier && k === "d") {
      event.preventDefault();
      duplicate();
    } else if (k === "escape") {
      layer.current?.cancelDraft();
      setPlacing(null);
      setSelection([]);
    } else if (k === "enter") {
      event.preventDefault();
      layer.current?.finishDraft();
    } else if (k === "delete" || k === "backspace") {
      event.preventDefault();
      remove();
    } else if (!modifier && !event.altKey) {
      const tool: Record<string, DesignKind> = {
        p: "pipe",
        l: "line",
        r: "rectangle",
        c: "circle",
        d: "dimension",
      };
      if (tool[k]) {
        setPlacing(tool[k]);
        setTab("properties");
        setSelection([]);
      } else if (k === "v") {
        setPlacing(null);
        setMode("translate");
      } else if (k === "f") views.current?.fit();
      else if (k === "f8") {
        event.preventDefault();
        setAngle((a) => (a === 90 ? 0 : 90));
      } else if (k === "f3") {
        event.preventDefault();
        setObjectSnap((s) => !s);
      } else if (["1", "2", "3", "4"].includes(k))
        views.current?.setView(
          (["3d", "top", "front", "right"] as CadView[])[Number(k) - 1]!,
        );
    }
  };
  const actions = useRef({ commit, add, select, keyboard });
  useLayoutEffect(() => {
    actions.current = { commit, add, select, keyboard };
  });
  useEffect(() => {
    const next = new DesignLayer(scene, modelId, {
      select: (id, extend) => actions.current.select(id, extend),
      status: setStatus,
      place: (kind, start, end) => {
        const object = newDesignElement(kind, start);
        if (end) {
          const a = new Vector3(...start),
            b = new Vector3(...end),
            direction = b.clone().sub(a);
          object.position = a.add(b).multiplyScalar(0.5).toArray() as Point3;
          if (kind === "wall") {
            object.size[0] = direction.length();
            object.position[1] += object.size[1] / 2;
          } else object.size[1] = direction.length();
          const euler = new Euler().setFromQuaternion(
            new Quaternion().setFromUnitVectors(
              kind === "wall" ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0),
              direction.normalize(),
            ),
          );
          object.rotation = [euler.x, euler.y, euler.z].map(
            MathUtils.radToDeg,
          ) as Point3;
        }
        actions.current.add(object);
      },
      sketch: (kind, points, plane) =>
        actions.current.add(createSketch(kind, points, plane)),
      vertex: (id, index, point) => {
        const doc = current.current.design,
          e = doc.elements.find((e) => e.id === id);
        if (!e?.points) return;
        const closed =
          new Vector3(...e.points[0]!).distanceTo(
            new Vector3(...e.points.at(-1)!),
          ) < 1e-8;
        if (
          !actions.current.commit({
            ...doc,
            elements: doc.elements.map((object) =>
              object.id === id
                ? {
                    ...object,
                    points: object.points!.map((p, i) =>
                      i === index ||
                      (closed && index === 0 && i === object.points!.length - 1)
                        ? point
                        : p,
                    ),
                  }
                : object,
            ),
          })
        )
          layer.current?.selectMany(current.current.selection);
      },
      transform: (id, position, rotation) => {
        const doc = current.current.design;
        if (id.startsWith("source:")) {
          const expressId = Number(id.slice(7)),
            old = doc.overrides.find((o) => o.expressId === expressId) ?? {
              expressId,
              name: "",
              translation: [0, 0, 0] as Point3,
              rotation: [0, 0, 0] as Point3,
              deleted: false,
            },
            center = next.sourceCenter(expressId);
          if (!center) return;
          actions.current.commit({
            ...doc,
            overrides: [
              ...doc.overrides.filter((o) => o.expressId !== expressId),
              {
                ...old,
                translation: position.map(
                  (n, i) => n - center[i]! + old.translation[i]!,
                ) as Point3,
                rotation,
              },
            ],
          });
        } else
          actions.current.commit({
            ...doc,
            elements: doc.elements.map((e) =>
              e.id === id ? { ...e, position, rotation } : e,
            ),
          });
      },
      transformMany: (ids, delta, rotation, pivot) =>
        actions.current.commit(
          transformElements(
            current.current.design,
            ids,
            delta,
            rotation,
            pivot,
            (id) => next.sourceCenter(id),
          ),
        ),
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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the durable local draft once.
            setDesign(parsed.data);
            setRevision(raw.revision);
            setDirty(true);
            setLoaded(true);
            setError("Recovered your unsaved design.");
            return;
          }
        }
      } catch {
        /* No recoverable draft. */
      }
    }
    setDesign(designSchema.parse(query.data.design));
    setRevision(query.data.revision);
    setLoaded(true);
  }, [query.data, key, w.canUpload]);
  useEffect(() => {
    if (loaded) layer.current?.setDesign(design);
  }, [design, loaded, scene, ready]);
  const planesInitialized = useRef(false);
  useEffect(() => {
    if (!active || !loaded || planesInitialized.current) return;
    const bounds = scene.bounds();
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3()).add(scene.origin);
    planesInitialized.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize workplanes from the loaded IFC's world coordinates once.
    setOffsets([center.x, bounds.min.y + scene.origin.y, center.z]);
    setPoint(center.toArray() as Point3);
  }, [active, loaded, scene]);
  useEffect(() => {
    layer.current?.setActive(active && loaded && w.canUpload);
    return () => layer.current?.setActive(false);
  }, [active, loaded, w.canUpload, scene]);
  useEffect(() => {
    layer.current?.selectMany(selection);
  }, [selection, design]);
  useEffect(() => {
    if (!active || !loaded || !viewHost.current) return;
    const controller = new CadViews(scene, viewHost.current, {
      view: (v) => {
        setView(v);
        layer.current?.syncCamera();
      },
      hover: (x, y) => layer.current?.hover(x, y),
      tap: (x, y, extend) => layer.current?.tapAt(x, y, extend),
      key: (e) => actions.current.keyboard(e),
    });
    views.current = controller;
    return () => {
      controller.dispose();
      views.current = null;
    };
  }, [active, loaded, scene]);
  useEffect(() => {
    views.current?.setLayout(quad ? "quad" : "single");
  }, [quad, active, loaded]);
  useEffect(() => {
    if (views.current) {
      views.current.workplanes = { plane, offsets, grid: showGrid };
      scene.invalidate();
    }
  }, [plane, offsets, showGrid, active, loaded, scene]);
  useEffect(() => {
    const l = layer.current;
    if (!l) return;
    l.plane = view === "3d" ? plane : view;
    l.elevation = offsets[planeAxes(l.plane).axis]!;
    l.placing = placing;
    l.snap = snap;
    l.angle = angle;
    l.objectSnap = objectSnap;
    l.surface = surface && view === "3d";
    l.exactLength = exactLength;
    l.chain = chain;
    l.vertexMode = vertexEditing;
    l.setMode(mode);
  }, [
    view,
    plane,
    offsets,
    placing,
    snap,
    angle,
    objectSnap,
    surface,
    exactLength,
    chain,
    vertexEditing,
    mode,
    active,
    loaded,
  ]);
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
        /* The server save is still available. */
      }
    };
    const timer = setTimeout(persist, 200),
      warn = (event: BeforeUnloadEvent) => {
        if (current.current.dirty) {
          persist();
          event.preventDefault();
          event.returnValue = "";
        }
      };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(timer);
      persist();
      window.removeEventListener("beforeunload", warn);
    };
  }, [design, dirty, revision, key]);
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
        title: "Leave CAD editing?",
        description: retained
          ? "Your draft remains on this device. Save it to share with your team."
          : "Draft storage is unavailable. Save before leaving to avoid losing your edits.",
        confirmLabel: "Leave editor",
      }))
    )
      return;
    setPlacing(null);
    onClose();
  };
  if (!active) {
    if (query.error && !loaded)
      return (
        <div
          role="alert"
          className="bg-background text-destructive absolute top-3 left-3 rounded border p-2 text-xs"
        >
          Saved design could not load.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      );
    return dirty ? (
      <p className="bg-background absolute top-3 left-3 p-2 text-xs">
        Unsaved local design · {w.models.find((m) => m.id === modelId)?.name}
      </p>
    ) : null;
  }
  const workingPlane = view === "3d" ? plane : view,
    axis = planeAxes(workingPlane).axis;
  const startTool = (kind: DesignKind | null) => {
    setPlacing(kind);
    if (kind) setTab("properties");
    setSelection([]);
  };
  const buttonClass =
    "grid h-10 min-w-10 shrink-0 place-items-center rounded px-2 text-xs hover:bg-muted disabled:opacity-40";
  return (
    <section
      aria-label="Model editor"
      className="pointer-events-none absolute inset-0 z-20"
    >
      <header className="bg-background pointer-events-auto absolute inset-x-0 top-0 z-20 border-b">
        <div
          className="flex h-12 min-w-0 items-center gap-1 px-2"
          role="toolbar"
          aria-label="CAD commands"
        >
          <strong className="mr-2 text-sm whitespace-nowrap">
            CAD{" "}
            <span className="text-muted-foreground text-xs font-normal">
              {dirty ? "· Unsaved" : ""}
            </span>
          </strong>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <button
              aria-label="Select objects"
              title="Select (V)"
              className={cn(
                buttonClass,
                !placing && "bg-primary/15 text-primary",
              )}
              onClick={() => startTool(null)}
            >
              <MousePointer2 className="size-4" />
            </button>
            <select
              aria-label="Add model element"
              className="bg-background h-10 max-w-40 shrink-0 rounded border px-2 text-sm"
              value={placing ?? ""}
              onChange={(e) =>
                startTool((e.target.value as DesignKind) || null)
              }
            >
              <option value="">Draw / add…</option>
              {Object.entries(designKinds)
                .filter(([id]) => id !== "profile" && id !== "solid")
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
            <button
              aria-label="Move selected objects"
              title="Move"
              className={cn(
                buttonClass,
                mode === "translate" && !placing && "text-primary",
              )}
              onClick={() => {
                setMode("translate");
                setPlacing(null);
              }}
            >
              <Move className="size-4" />
            </button>
            <button
              aria-label="Rotate selected objects"
              title="Rotate"
              className={cn(
                buttonClass,
                mode === "rotate" && !placing && "text-primary",
              )}
              onClick={() => {
                setMode("rotate");
                setPlacing(null);
              }}
            >
              <RotateCw className="size-4" />
            </button>
            <button
              aria-label="Undo model edit"
              title="Undo (Ctrl Z)"
              disabled={!history.length || save.isPending}
              className={buttonClass}
              onClick={undo}
            >
              <Undo2 className="size-4" />
            </button>
            <button
              aria-label="Redo model edit"
              title="Redo (Ctrl Shift Z)"
              disabled={!future.length || save.isPending}
              className={buttonClass}
              onClick={redo}
            >
              <Redo2 className="size-4" />
            </button>
          </div>
          <button
            aria-label="Toggle CAD inspector"
            title="Properties, layers and files"
            aria-pressed={inspector}
            className={cn(
              buttonClass,
              inspector && "bg-primary/15 text-primary",
            )}
            onClick={() => setInspector(!inspector)}
          >
            <SlidersHorizontal className="size-4" />
          </button>
          <button
            aria-label="Save design"
            title="Save (Ctrl S)"
            disabled={!loaded || !dirty || save.isPending}
            className={cn(
              buttonClass,
              "bg-primary text-primary-foreground ml-auto",
            )}
            onClick={saveNow}
          >
            <Save className="size-4" />
          </button>
          <button
            aria-label="Close editor"
            className={buttonClass}
            onClick={() => void close()}
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className="flex h-11 items-center gap-1 overflow-x-auto border-t px-2"
          role="toolbar"
          aria-label="CAD views"
        >
          {(Object.keys(cadViews) as CadView[]).map((v) => (
            <button
              key={v}
              aria-label={`${cadViews[v]} view`}
              aria-pressed={view === v}
              className={cn(
                buttonClass,
                view === v && "bg-primary/15 text-primary",
              )}
              onClick={() => views.current?.setView(v)}
            >
              {cadViews[v]}
            </button>
          ))}
          <button
            aria-label="Four views"
            aria-pressed={quad}
            className={cn(buttonClass, quad && "text-primary")}
            onClick={() => setQuad(!quad)}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            aria-label="Fit all CAD views"
            className={buttonClass}
            onClick={() => views.current?.fit()}
          >
            <Focus className="size-4" />
          </button>
          <button
            aria-label="Object snapping"
            aria-pressed={objectSnap}
            className={cn(buttonClass, objectSnap && "text-primary")}
            onClick={() => setObjectSnap(!objectSnap)}
          >
            Snap
          </button>
          <select
            aria-label="Angle constraint"
            className="bg-background h-9 rounded border px-1 text-xs"
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value) as 0 | 45 | 90)}
          >
            <option value={0}>Free angle</option>
            <option value={90}>Ortho 90°</option>
            <option value={45}>45°</option>
          </select>
          <select
            aria-label="CAD units"
            className="bg-background h-9 rounded border px-1 text-xs"
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            {Object.keys(units).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </header>
      <div
        ref={viewHost}
        data-testid="cad-viewports"
        className={cn(
          "pointer-events-auto absolute inset-x-0 top-[92px] bottom-9",
          inspector && "bottom-[43dvh] md:right-[384px] md:bottom-9",
        )}
      />
      {!loaded && (
        <p
          role="status"
          className="bg-background pointer-events-auto absolute top-28 left-3 p-3"
        >
          {query.error?.message ?? "Loading your design…"}
        </p>
      )}
      {placing && (
        <div
          className={cn(
            "bg-background/95 pointer-events-auto absolute bottom-10 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs",
            inspector &&
              "bottom-[calc(43dvh+4px)] md:bottom-10 md:max-w-[calc(100%-400px)]",
          )}
        >
          <span>
            {designKinds[placing]} ·{" "}
            {placing === "polyline"
              ? "Tap points, then Finish"
              : sketchKinds.has(placing) ||
                  ["pipe", "duct", "wall"].includes(placing)
                ? "Choose two points"
                : "Tap to place"}
          </span>
          {placing === "polyline" && (
            <>
              <button
                className="text-primary underline"
                onClick={() => layer.current?.finishDraft()}
              >
                Finish
              </button>
              <button
                className="text-primary underline"
                onClick={() => layer.current?.finishDraft(true)}
              >
                Close shape
              </button>
            </>
          )}
          <button className="underline" onClick={() => startTool(null)}>
            Cancel
          </button>
        </div>
      )}
      {inspector && (
        <aside
          aria-label="CAD inspector"
          className="bg-background pointer-events-auto absolute inset-x-0 bottom-9 z-20 flex h-[calc(43dvh-36px)] flex-col border-t md:top-[92px] md:right-0 md:left-auto md:h-auto md:w-[384px] md:border-t-0 md:border-l"
        >
          <nav
            className="flex shrink-0 overflow-x-auto border-b"
            aria-label="CAD inspector tabs"
          >
            {(
              [
                "properties",
                "modify",
                "objects",
                "layers",
                "library",
                "file",
              ] as const
            ).map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                className={cn(
                  "h-11 flex-1 shrink-0 px-2 text-xs capitalize",
                  tab === t && "text-primary border-primary border-b-2",
                )}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm">
            {tab === "modify" && (
              <CadModifyPanel
                design={design}
                selection={selection}
                scene={scene}
                modelId={modelId}
                canDelete={w.canDelete}
                unit={unit}
                factor={factor}
                onChange={(next, ids) => {
                  if (!commit(next)) return false;
                  setSelection(ids);
                  return true;
                }}
                onError={setError}
              />
            )}
            {tab === "library" && (
              <CadComponentsPanel
                design={design}
                selection={selection}
                activeLayer={activeLayer}
                scene={scene}
                onChange={(next, ids) => {
                  if (!commit(next)) return false;
                  setSelection(ids);
                  return true;
                }}
                onError={setError}
              />
            )}
            {tab === "properties" && (
              <>
                <label className="flex gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  Show workplane grid
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label={`Grid snap (${unit})`}
                    value={snap * factor}
                    min={0}
                    onChange={(n) => setSnap(n / factor)}
                  />
                  <NumberField
                    label={`Plane ${["X", "Y", "Z"][axis]} (${unit})`}
                    value={offsets[axis]! * factor}
                    onChange={(n) =>
                      setOffsets(
                        (o) =>
                          o.map((v, i) =>
                            i === axis ? n / factor : v,
                          ) as Point3,
                      )
                    }
                  />
                </div>
                {view === "3d" && (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="3D working plane"
                      className={inputClass}
                      value={plane}
                      onChange={(e) => setPlane(e.target.value as CadPlane)}
                    >
                      <option value="top">Horizontal (XZ)</option>
                      <option value="front">Front (XY)</option>
                      <option value="right">Right (YZ)</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={surface}
                        onChange={(e) => setSurface(e.target.checked)}
                      />
                      Surface
                    </label>
                  </div>
                )}
                {placing && (
                  <>
                    <NumberField
                      label={`Exact segment length (${unit}, 0 = free)`}
                      value={exactLength * factor}
                      min={0}
                      max={1000 * factor}
                      onChange={(n) => setExactLength(n / factor)}
                    />
                    <label className="flex gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={chain}
                        onChange={(e) => setChain(e.target.checked)}
                      />
                      Continue drawing after each object
                    </label>
                    <details>
                      <summary className="cursor-pointer text-xs font-medium">
                        Enter a precise point
                      </summary>
                      <div className="mt-2 space-y-2">
                        <VectorFields
                          label={`Point (${unit})`}
                          value={point}
                          factor={factor}
                          change={setPoint}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => layer.current?.addPoint(point)}
                        >
                          Add point
                        </Button>
                      </div>
                    </details>
                    {!sketchKinds.has(placing) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          add(
                            newDesignElement(
                              placing,
                              scene.controls.target
                                .clone()
                                .add(scene.origin)
                                .toArray() as Point3,
                            ),
                          )
                        }
                      >
                        At view
                      </Button>
                    )}
                  </>
                )}
                <div className="border-t pt-3">
                  <strong className="text-xs">
                    {selection.length > 1
                      ? `${selection.length} selected`
                      : (element?.name ?? source?.name ?? "Selection")}
                  </strong>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {selection.length
                      ? "Drag the handles or enter dimensions below."
                      : "Tap an object to edit. Shift-click adds to the selection."}
                  </p>
                </div>
                <label className="flex gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={multi}
                    onChange={(e) => setMulti(e.target.checked)}
                  />
                  Select multiple objects
                </label>
                {(element ?? override) && (
                  <>
                    {!editable && (
                      <p className="text-muted-foreground text-xs">
                        Unlock and show this layer to edit its objects.
                      </p>
                    )}
                    <fieldset disabled={!editable} className="space-y-3">
                      <label className="block space-y-1 text-xs">
                        Name
                        <input
                          aria-label="Element name"
                          className={inputClass}
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
                          <VectorFields
                            label={`Position (${unit})`}
                            value={element.position}
                            change={(v) => update({ position: v })}
                            factor={factor}
                          />
                          <VectorFields
                            label="Rotation (°)"
                            value={element.rotation}
                            change={(v) => update({ rotation: v })}
                          />
                          {element.kind !== "solid" &&
                            !sketchKinds.has(element.kind) &&
                            (["pipe", "elbow", "tee", "valve"].includes(
                              element.kind,
                            ) ? (
                              <>
                                <NumberField
                                  label={`Element length (${unit})`}
                                  value={element.size[1] * factor}
                                  min={0.001 * factor}
                                  max={1000 * factor}
                                  onChange={(n) =>
                                    update({
                                      size: [
                                        element.size[0],
                                        n / factor,
                                        element.size[2],
                                      ],
                                    })
                                  }
                                />
                                <NumberField
                                  label={`Pipe diameter (${unit})`}
                                  value={element.diameter * factor}
                                  min={0.001 * factor}
                                  max={1000 * factor}
                                  onChange={(n) =>
                                    update({ diameter: n / factor })
                                  }
                                />
                              </>
                            ) : (
                              <VectorFields
                                label={`Size (${unit})`}
                                value={element.size}
                                factor={factor}
                                change={(v) => update({ size: v })}
                              />
                            ))}
                          {element.kind === "profile" && (
                            <NumberField
                              label={`Extrusion depth (${unit})`}
                              value={element.size[1] * factor}
                              min={0.001 * factor}
                              onChange={(n) =>
                                update({
                                  size: [
                                    element.size[0],
                                    n / factor,
                                    element.size[2],
                                  ],
                                })
                              }
                            />
                          )}
                          <VectorFields
                            label="Scale"
                            value={element.scale ?? [1, 1, 1]}
                            change={(scale) => update({ scale })}
                          />
                          {element.kind === "dimension" && (
                            <div className="space-y-3">
                              <NumberField
                                label={`Dimension offset (${unit})`}
                                value={
                                  (element.dimension?.offset ?? 0.2) * factor
                                }
                                onChange={(offset) =>
                                  update({
                                    dimension: {
                                      offset: offset / factor,
                                      unit: element.dimension?.unit ?? "m",
                                      precision:
                                        element.dimension?.precision ?? 2,
                                      anchors: element.dimension?.anchors,
                                    },
                                  })
                                }
                              />
                              <label className="block space-y-1 text-xs">
                                Dimension units
                                <select
                                  aria-label="Dimension units"
                                  className={inputClass}
                                  value={element.dimension?.unit ?? "m"}
                                  onChange={(event) =>
                                    update({
                                      dimension: {
                                        offset:
                                          element.dimension?.offset ?? 0.2,
                                        precision:
                                          element.dimension?.precision ?? 2,
                                        anchors: element.dimension?.anchors,
                                        unit: event.target.value as Unit,
                                      },
                                    })
                                  }
                                >
                                  {Object.keys(units).map((u) => (
                                    <option key={u}>{u}</option>
                                  ))}
                                </select>
                              </label>
                              <NumberField
                                label="Dimension decimal places"
                                value={element.dimension?.precision ?? 2}
                                min={0}
                                max={4}
                                step={1}
                                onChange={(precision) =>
                                  update({
                                    dimension: {
                                      offset: element.dimension?.offset ?? 0.2,
                                      unit: element.dimension?.unit ?? "m",
                                      anchors: element.dimension?.anchors,
                                      precision: Math.floor(precision),
                                    },
                                  })
                                }
                              />
                              {element.dimension?.anchors?.some(Boolean) && (
                                <>
                                  <p className="text-muted-foreground text-xs">
                                    Attached to object snap points. The
                                    dimension follows changes to those objects.
                                  </p>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      update({
                                        dimension: {
                                          ...element.dimension!,
                                          anchors: [null, null],
                                        },
                                      })
                                    }
                                  >
                                    Detach dimension
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                          {element.kind === "solid" && (
                            <p className="text-muted-foreground text-xs">
                              {(
                                (element.mesh?.indices.length ?? 0) / 3
                              ).toLocaleString()}{" "}
                              triangles · Use Scale to resize this solid, or
                              Modify to cut and combine it.
                            </p>
                          )}
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-xs">
                              Colour
                              <input
                                aria-label="Element colour"
                                type="color"
                                value={element.color}
                                onChange={(e) =>
                                  update({ color: e.target.value })
                                }
                              />
                            </label>
                            <select
                              aria-label="Element layer"
                              className={inputClass}
                              value={element.layer ?? "Design"}
                              onChange={(e) =>
                                update({ layer: e.target.value })
                              }
                            >
                              {layers.map((l) => (
                                <option key={l.name}>{l.name}</option>
                              ))}
                            </select>
                          </div>
                          {element.points && (
                            <>
                              {element.kind !== "dimension" && (
                                <label className="flex gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={vertexEditing}
                                    onChange={(e) =>
                                      setVertexEditing(e.target.checked)
                                    }
                                  />
                                  Edit vertices on drawing
                                </label>
                              )}
                              <details>
                                <summary className="cursor-pointer text-xs">
                                  Edit vertices ({element.points.length})
                                </summary>
                                <p className="text-muted-foreground my-2 text-xs">
                                  Local coordinates, relative to the object’s
                                  position and rotation.
                                </p>
                                {element.points.map((p, i) => (
                                  <VectorFields
                                    key={i}
                                    label={`Vertex ${i + 1} (${unit})`}
                                    value={p}
                                    factor={factor}
                                    change={(next) =>
                                      update({
                                        points: element.points!.map((p, j) =>
                                          j === i ? next : p,
                                        ),
                                      })
                                    }
                                  />
                                ))}
                              </details>
                            </>
                          )}
                          {element.points &&
                            element.points.length >= 3 &&
                            element.kind !== "profile" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  update({
                                    kind: "profile",
                                    size: [
                                      element.size[0],
                                      0.3,
                                      element.size[2],
                                    ],
                                    name: `${element.name.slice(0, 140)} extrusion`,
                                  })
                                }
                              >
                                Extrude shape
                              </Button>
                            )}
                          <details>
                            <summary className="cursor-pointer text-xs">
                              System, material and notes
                            </summary>
                            <div className="mt-2 space-y-2">
                              {(["system", "material", "notes"] as const).map(
                                (k) => (
                                  <label
                                    key={k}
                                    className="block text-xs capitalize"
                                  >
                                    {k}
                                    <input
                                      aria-label={`Element ${k}`}
                                      className={inputClass}
                                      value={element[k]}
                                      onChange={(e) =>
                                        update({ [k]: e.target.value })
                                      }
                                    />
                                  </label>
                                ),
                              )}
                            </div>
                          </details>
                        </>
                      ) : (
                        override && (
                          <>
                            <VectorFields
                              label={`Offset (${unit})`}
                              value={override.translation}
                              factor={factor}
                              change={(v) => updateSource({ translation: v })}
                            />
                            <VectorFields
                              label="Rotation (°)"
                              value={override.rotation}
                              change={(v) => updateSource({ rotation: v })}
                            />
                            <p className="text-muted-foreground text-xs">
                              Imported element: move or rotate the original
                              geometry as a unit.
                            </p>
                          </>
                        )
                      )}
                    </fieldset>
                  </>
                )}
                {selection.length > 1 && (
                  <VectorFields
                    label={`Move selection (${unit})`}
                    value={[0, 0, 0]}
                    factor={factor}
                    change={(delta) =>
                      commit(
                        transformElements(
                          design,
                          selection,
                          delta,
                          [0, 0, 0],
                          [0, 0, 0],
                          (id) => layer.current?.sourceCenter(id),
                        ),
                      )
                    }
                  />
                )}
                {selection.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const bounds =
                          layer.current?.selectionBounds(selection);
                        if (bounds)
                          views.current?.fit(
                            bounds.getCenter(new Vector3()),
                            bounds,
                          );
                      }}
                    >
                      Focus
                    </Button>
                    {selection.some((id) => !id.startsWith("source:")) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => duplicate()}
                      >
                        Duplicate
                      </Button>
                    )}
                    {w.canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() =>
                          override?.deleted
                            ? updateSource({ deleted: false })
                            : remove()
                        }
                      >
                        {override?.deleted
                          ? "Restore element"
                          : "Remove selection"}
                      </Button>
                    )}
                  </div>
                )}
                {selection.some((id) => !id.startsWith("source:")) && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Repeat / array
                    </summary>
                    <div className="mt-2 space-y-2">
                      <VectorFields
                        label={`Copy spacing (${unit})`}
                        value={arrayOffset}
                        factor={factor}
                        change={setArrayOffset}
                      />
                      <NumberField
                        label="Number of copies"
                        value={copies}
                        min={1}
                        max={100}
                        step={1}
                        onChange={(n) => setCopies(Math.floor(n))}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => duplicate(copies)}
                      >
                        Create array
                      </Button>
                    </div>
                  </details>
                )}
              </>
            )}
            {tab === "objects" && (
              <>
                <input
                  aria-label="Find design object"
                  placeholder="Find an object…"
                  className={inputClass}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelection(
                        design.elements
                          .filter((e) => isEditable(design, e))
                          .map((e) => e.id),
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelection([])}
                  >
                    Clear
                  </Button>
                </div>
                <div className="divide-y">
                  {design.elements
                    .filter((e) =>
                      `${e.name} ${e.layer ?? "Design"}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((e) => (
                      <button
                        key={e.id}
                        className={cn(
                          "block w-full px-2 py-3 text-left text-xs",
                          selection.includes(e.id) &&
                            "bg-primary/15 text-primary",
                        )}
                        onClick={(event) => select(e.id, event.shiftKey)}
                      >
                        <strong className="block">{e.name}</strong>
                        <span className="text-muted-foreground">
                          {designKinds[e.kind]} · {e.layer ?? "Design"}
                        </span>
                      </button>
                    ))}
                  {design.overrides.map((o) => (
                    <button
                      key={o.expressId}
                      className="block w-full px-2 py-3 text-left text-xs"
                      onClick={() => select(`source:${o.expressId}`)}
                    >
                      {o.deleted ? "Removed · " : "Original · "}
                      {o.name || `#${o.expressId}`}
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  {design.elements.length} design objects. Select imported
                  objects directly in a view.
                </p>
              </>
            )}
            {tab === "layers" && (
              <>
                <p className="text-muted-foreground text-xs">
                  Choose the layer for new objects. Hidden or locked layers
                  cannot be selected in a view.
                </p>
                {layers.map((l, i) => (
                  <div key={l.name} className="space-y-2 border-b py-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="cad-layer"
                        checked={activeLayer === l.name}
                        onChange={() => setActiveLayer(l.name)}
                      />
                      {l.name}
                    </label>
                    <div className="flex gap-4 text-xs">
                      {(["visible", "locked"] as const).map((k) => (
                        <label
                          key={k}
                          className="flex items-center gap-2 capitalize"
                        >
                          <input
                            type="checkbox"
                            aria-label={`${l.name} ${k}`}
                            checked={l[k]}
                            onChange={(e) =>
                              commit({
                                ...design,
                                layers: layers.map((l, j) =>
                                  j === i ? { ...l, [k]: e.target.checked } : l,
                                ),
                              })
                            }
                          />
                          {k}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newLayer.trim();
                    if (!name || layers.some((l) => l.name === name)) return;
                    commit({
                      ...design,
                      layers: [
                        ...layers,
                        { name, visible: true, locked: false },
                      ],
                    });
                    setActiveLayer(name);
                    setNewLayer("");
                  }}
                >
                  <input
                    aria-label="New layer name"
                    placeholder="New layer"
                    maxLength={80}
                    className={inputClass}
                    value={newLayer}
                    onChange={(e) => setNewLayer(e.target.value)}
                  />
                  <Button type="submit" variant="outline" size="sm">
                    Add
                  </Button>
                </form>
              </>
            )}
            {tab === "file" && (
              <>
                <CadIfcExport
                  design={design}
                  scene={scene}
                  modelId={modelId}
                  title={
                    w.models.find((m) => m.id === modelId)?.name ?? "Design"
                  }
                  onError={setError}
                />
                <CadDxfImport
                  design={design}
                  onChange={(next) => {
                    if (!commit(next)) return false;
                    const ids = next.elements
                      .filter(
                        (e) => !design.elements.some((old) => old.id === e.id),
                      )
                      .map((e) => e.id);
                    setSelection(ids);
                    setTab("properties");
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => {
                        const bounds = layer.current?.selectionBounds(ids);
                        if (bounds)
                          views.current?.fit(
                            bounds.getCenter(new Vector3()),
                            bounds,
                          );
                      }),
                    );
                    return true;
                  }}
                  onError={setError}
                />
                <strong className="block text-sm">Drawing files</strong>
                <p className="text-muted-foreground text-xs">
                  CAD files preserve editable objects, layers and source-model
                  placements.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    downloadCadFile(
                      serializeCad(design, modelId),
                      `design-${modelId}.fhcad.json`,
                    )
                  }
                >
                  Download CAD file
                </Button>
                <label className="block space-y-2 text-xs">
                  Import a CAD file
                  <input
                    aria-label="Import CAD file"
                    className="w-full text-xs"
                    type="file"
                    accept=".json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > 8_000_000) {
                        setError("Choose a CAD file smaller than 8 MB.");
                        return;
                      }
                      void file.text().then(async (text) => {
                        try {
                          const next = parseCad(text, modelId);
                          if (
                            await confirmAction({
                              title: "Replace this design?",
                              description:
                                "Your current design will be replaced. You can undo before saving.",
                              confirmLabel: "Import design",
                            })
                          ) {
                            commit(next);
                            setSelection([]);
                            setActiveLayer(
                              designLayers(next)[0]?.name ?? "Design",
                            );
                          }
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Unable to import the drawing.",
                          );
                        }
                      });
                    }}
                  />
                </label>
                <div className="space-y-2 border-t pt-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      downloadCadFile(
                        designDxf(design),
                        `design-${modelId}.dxf`,
                        "application/dxf",
                      )
                    }
                  >
                    Export DXF linework
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    Exports sketch outlines, dimensions and pipe / duct
                    centrelines in metres, with elevation. Solid bodies and the
                    imported IFC stay in the model and CAD file.
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs font-medium">
                    Keyboard & touch guide
                  </summary>
                  <p className="text-muted-foreground mt-2 text-xs leading-6">
                    V select · P pipe · L line · R rectangle · C circle · D
                    dimension · F fit · 1–4 change view · Enter finish · Escape
                    cancel · Delete remove · Ctrl D duplicate · Ctrl Z undo ·
                    Ctrl Shift Z redo · Ctrl S save. Shift-click or Select
                    multiple adds objects. Middle mouse pans in every tool. Drag
                    to pan in an elevation or orbit in 3D. On touch, pinch to
                    zoom and use two fingers to pan.
                  </p>
                </details>
              </>
            )}
          </div>
        </aside>
      )}
      {(error || save.error) && (
        <div
          role="alert"
          className="bg-background text-destructive pointer-events-auto absolute inset-x-2 bottom-10 z-30 rounded border p-3 text-xs"
        >
          {error || save.error?.message}
          <button
            aria-label="Dismiss CAD error"
            className="float-right ml-3"
            onClick={() => {
              setError("");
              save.reset();
            }}
          >
            ×
          </button>
          {save.error?.data?.code === "CONFLICT" && (
            <button
              className="ml-2 underline"
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
            </button>
          )}
        </div>
      )}
      <footer className="bg-background pointer-events-auto absolute inset-x-0 bottom-0 flex h-9 items-center gap-2 border-t px-3 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{status}</span>
        <span className="text-muted-foreground shrink-0">
          {workingPlane} · {unit}
        </span>
      </footer>
    </section>
  );
}
