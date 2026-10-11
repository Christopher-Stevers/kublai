"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Layers3,
  MousePointer2,
  Ruler,
  ScanLine,
  Scissors,
  Footprints,
  MapPin,
  Expand,
  Minimize,
  Focus,
  Eye,
  EyeOff,
  PanelLeftClose,
  Plus,
  Search,
  Bookmark,
  Camera,
  Download,
  Settings2,
  X,
  RotateCcw,
  LoaderCircle,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Info,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { useModelScene } from "./use-model-scene";
import {
  AutodeskDialog,
  IssueDialog,
  UploadModelDialog,
  inputClass,
} from "./ModelDialogs";
import type { ModelTool } from "~/lib/bim/scene";
import type {
  BimElement,
  BimIssueData,
  BimModel,
  BimViewState,
  BimWorkspace,
  Point3,
} from "~/lib/bim/types";
import { downloadBlob, modelFileUrl } from "~/lib/bim/client";
import { elementCsv, issueCsv, issueBcf } from "~/lib/bim/exports";
import {
  formatModelMeasure,
  measureArea,
  measureDistance,
} from "~/lib/bim/geometry";
import { cn } from "~/lib/utils";
type Panel =
  | "models"
  | "elements"
  | "properties"
  | "views"
  | "issues"
  | "section"
  | null;
const titleCase = (s: string) =>
  s
    .replace(/^IFC/i, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
const toolInfo: Record<ModelTool, string> = {
  inspect:
    "Drag to orbit · pinch to zoom · two fingers to pan · tap an element to inspect",
  distance: "Pick two points on the model. Corners snap within 12 pixels.",
  area: "Pick points around a flat surface, then choose Finish area.",
  pin: "Tap the location of the issue on the model.",
  walk: "Drag to look · use arrows to move · W A S D on a keyboard · Q / E to change elevation",
};
export function JobModelsView({ jobId }: { jobId: string }) {
  const query = api.models.workspace.useQuery(
    { jobId },
    { refetchInterval: 15000, refetchIntervalInBackground: false },
  );
  if (query.error)
    return (
      <div className="p-6">
        <p role="alert">{query.error.message}</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  if (!query.data)
    return (
      <div
        role="status"
        className="text-muted-foreground flex min-h-96 items-center justify-center gap-3"
      >
        <LoaderCircle className="size-5 animate-spin" />
        Opening model workspace…
      </div>
    );
  return (
    <ModelWorkspace
      key={jobId}
      workspace={query.data}
      refresh={() => void query.refetch()}
    />
  );
}
export function ModelWorkspace({
  workspace: w,
  refresh,
}: {
  workspace: BimWorkspace;
  refresh: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [ids, setIds] = useState<string[]>([]),
    [panel, setPanel] = useState<Panel>("models"),
    [selected, setSelected] = useState<BimElement | null>(null),
    [tool, setTool] = useState<ModelTool>("inspect"),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState(false),
    [upload, setUpload] = useState<{ revision: BimModel | null } | null>(null),
    [autodesk, setAutodesk] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [level, setLevel] = useState(""),
    [units, setUnits] = useState<"metric" | "imperial">("metric"),
    [xray, setXray] = useState(false),
    [reset, setReset] = useState(0),
    [restore, setRestore] = useState<BimViewState | null>(null),
    [issueOpen, setIssueOpen] = useState<{
      id: string | null;
      draft: BimIssueData;
    } | null>(null),
    [saveView, setSaveView] = useState(false),
    [viewName, setViewName] = useState(""),
    [help, setHelp] = useState(false),
    [allRevisions, setAllRevisions] = useState(false),
    [section, setSection] = useState<BimViewState["section"]>(null);
  const viewport = useModelScene(host, w.job.id, ids, restore, reset, {
    select: (e) => {
      setSelected(e);
      if (e) setPanel("properties");
    },
    pin: (e, p) => newIssue(e, p),
    issue: (id) => openIssue(id),
    error: setError,
  });
  const { scene, elements, progress, properties, measures, ready } = viewport;
  const mutationOptions = {
    onSuccess: refresh,
    onError: (e: { message: string }) => setError(e.message),
  };
  const publication = api.models.publication.useMutation(mutationOptions),
    convert = api.models.convert.useMutation(mutationOptions),
    save = api.models.saveView.useMutation({
      ...mutationOptions,
      onSuccess: () => {
        refresh();
        setSaveView(false);
        setViewName("");
        setPanel("views");
      },
    }),
    removeView = api.models.removeView.useMutation(mutationOptions);
  const latest = useMemo(() => {
    const map = new Map<string, BimModel>();
    for (const m of w.models) {
      const old = map.get(m.seriesId);
      if (!old || old.version < m.version) map.set(m.seriesId, m);
    }
    return map;
  }, [w.models]);
  const modelRows = w.models.filter(
    (m) =>
      (allRevisions || latest.get(m.seriesId)?.id === m.id) &&
      m.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredElements = useMemo(
    () =>
      elements.filter(
        (e) =>
          (!category || category === e.type) &&
          (!level || level === e.level) &&
          `${e.name} ${e.type} ${e.guid} ${e.expressId}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [elements, category, level, search],
  );
  const categories = [...new Set(elements.map((e) => e.type))].sort(),
    levels = [
      ...new Map(
        elements.filter((e) => e.level).map((e) => [e.level, e.levelName]),
      ).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1]));
  useEffect(() => {
    scene?.setIssues(w.issues);
  }, [scene, w.issues, elements]);
  useEffect(() => {
    scene?.setTool(tool);
  }, [scene, tool]);
  useEffect(() => {
    scene?.setUnits(units);
  }, [scene, units]);
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [expanded]);
  const capture = () => scene?.capture(ids);
  const closeMobilePanel = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setPanel(null);
  };
  function restoreView(v: BimViewState) {
    setError("");
    setSelected(null);
    setRestore(v);
    setIds(v.modelIds);
    setCategory(v.categories[0] ?? "");
    setLevel(v.levels[0] ?? "");
    setXray(v.xray);
    setSection(v.section);
    setTool("inspect");
    setReset((n) => n + 1);
    closeMobilePanel();
  }
  function newIssue(element: BimElement, point: Point3) {
    const view = capture();
    if (!view) return;
    setTool("inspect");
    setIssueOpen({
      id: null,
      draft: {
        title: "",
        description: "",
        kind: "coordination",
        status: "open",
        priority: "normal",
        assigneeId: null,
        dueDate: null,
        point,
        element: {
          modelId: element.modelId,
          expressId: element.expressId,
          guid: element.guid,
        },
        view,
      },
    });
  }
  function openIssue(id: string) {
    const issue = w.issues.find((i) => i.id === id);
    if (issue) setIssueOpen({ id, draft: issue });
  }
  const toggleModel = (m: BimModel) => {
    setError("");
    setRestore(null);
    setIds((old) =>
      old.includes(m.id)
        ? old.filter((id) => id !== m.id)
        : [
            ...old.filter(
              (id) =>
                w.models.find((row) => row.id === id)?.seriesId !== m.seriesId,
            ),
            m.id,
          ],
    );
    closeMobilePanel();
  };
  const changeFilter = (cat: string, lev: string) => {
    setCategory(cat);
    setLevel(lev);
    scene?.filter(cat ? [cat] : [], lev ? [lev] : []);
  };
  const bounds = scene?.bounds(),
    axis = section?.axis ?? "y",
    axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2,
    min = bounds && !bounds.isEmpty() ? bounds.min.getComponent(axisIndex) : 0,
    max = bounds && !bounds.isEmpty() ? bounds.max.getComponent(axisIndex) : 10;
  const panelNames = {
    models: "Model register",
    elements: "Model elements",
    properties: "Element properties",
    views: "Saved views",
    issues: "Issues",
    section: "Section tools",
  };
  const panelButton = (
    id: Exclude<Panel, null>,
    Icon: typeof Box,
    label: string,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={panel === id}
      className={cn(
        "hover:bg-muted flex min-h-11 items-center gap-2 rounded-md px-3 text-sm",
        panel === id && "bg-muted text-blue-600",
      )}
      onClick={() => {
        setPanel((p) => (p === id ? null : id));
        setSearch("");
      }}
    >
      <Icon className="size-4" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
  return (
    <section
      aria-label="Construction model workspace"
      className={cn(
        "bg-background text-foreground flex min-h-[560px] flex-col overflow-hidden",
        expanded
          ? "fixed inset-0 z-40 h-dvh"
          : "relative h-[calc(100dvh-155px)] border-y",
      )}
    >
      <header className="bg-background z-10 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="size-6 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">Models</h1>
            <p className="text-muted-foreground truncate text-xs">
              {w.job.name}
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-0.5" aria-label="Model panels">
          {panelButton("models", Layers3, "Models")}
          {panelButton("elements", Search, "Elements")}
          {panelButton("views", Bookmark, "Views")}
          {panelButton("issues", MapPin, "Issues")}
          <button
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            title="Full screen"
            className="hover:bg-muted grid size-11 place-items-center rounded-md"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <Minimize className="size-4" />
            ) : (
              <Expand className="size-4" />
            )}
          </button>
        </nav>
      </header>
      {error && (
        <div
          role="alert"
          className="bg-destructive/10 z-20 flex items-start gap-2 border-b px-4 py-3 text-sm"
        >
          <span className="flex-1">{error}</span>
          <button
            aria-label="Dismiss error"
            className="p-1"
            onClick={() => setError("")}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden bg-slate-100 dark:bg-slate-950">
          <div
            ref={host}
            className="absolute inset-0"
            data-testid="model-canvas"
          />
          {!ids.length && (
            <div className="bg-background/80 absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-5 grid size-24 place-items-center rounded-3xl border border-blue-500/20 bg-blue-500/5 text-blue-600">
                <Box className="size-14 stroke-1" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">
                See the whole job in 3D
              </h2>
              <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-relaxed">
                Bring architecture, structure and building services together.
                Inspect the details, measure a clearance and give every issue a
                place.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {w.canUpload && (
                  <Button onClick={() => setUpload({ revision: null })}>
                    <Plus className="mr-2 size-4" />
                    Add a model
                  </Button>
                )}
                {w.models.length > 0 && (
                  <Button variant="outline" onClick={() => setPanel("models")}>
                    Open model register
                  </Button>
                )}
              </div>
              <button
                className="text-muted-foreground mt-5 text-xs underline underline-offset-4"
                onClick={() => setHelp(true)}
              >
                Viewer controls and supported files
              </button>
            </div>
          )}
          {progress && (
            <div
              role="status"
              className="bg-background/95 absolute top-4 right-4 left-4 mx-auto flex max-w-sm items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-sm"
            >
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
              {progress}
            </div>
          )}
          {ids.length > 0 && (
            <>
              <div className="bg-background/95 absolute top-3 right-3 flex flex-col gap-1 rounded-lg border p-1 shadow-sm">
                <button
                  aria-label="Fit model"
                  title="Fit model"
                  className="hover:bg-muted grid size-10 place-items-center rounded"
                  onClick={() => scene?.fit()}
                >
                  <Focus className="size-5" />
                </button>
                <select
                  aria-label="Camera orientation"
                  className="bg-background h-10 w-20 rounded border-0 text-center text-xs"
                  defaultValue="iso"
                  onChange={(e) =>
                    scene?.preset(
                      e.target.value as
                        | "iso"
                        | "top"
                        | "front"
                        | "left"
                        | "right",
                    )
                  }
                >
                  <option value="iso">3D</option>
                  <option value="top">Top</option>
                  <option value="front">Front</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
                <button
                  aria-label="Toggle x-ray"
                  aria-pressed={xray}
                  title="X-ray"
                  className={cn(
                    "hover:bg-muted grid size-10 place-items-center rounded",
                    xray && "text-blue-600",
                  )}
                  onClick={() => {
                    scene?.setXray(!xray);
                    setXray(!xray);
                  }}
                >
                  <Eye className="size-5" />
                </button>
              </div>
              {tool === "walk" && (
                <div className="bg-background/95 absolute right-4 bottom-24 grid grid-cols-3 gap-1 rounded-xl border p-2">
                  {[
                    ["q", ChevronDown, "Move down"],
                    ["w", ArrowUp, "Move forward"],
                    ["e", ChevronUp, "Move up"],
                    ["a", ArrowLeft, "Move left"],
                    ["s", ArrowDown, "Move back"],
                    ["d", ArrowRight, "Move right"],
                  ].map(([key, Icon, label]) => {
                    const Symbol = Icon as typeof ArrowUp;
                    return (
                      <button
                        key={String(key)}
                        aria-label={String(label)}
                        className="bg-muted grid size-12 touch-none place-items-center rounded-lg"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          scene?.moveWalk(String(key), true);
                        }}
                        onPointerUp={() => scene?.moveWalk(String(key), false)}
                        onPointerCancel={() =>
                          scene?.moveWalk(String(key), false)
                        }
                        onLostPointerCapture={() =>
                          scene?.moveWalk(String(key), false)
                        }
                      >
                        <Symbol className="size-5" />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="absolute right-3 bottom-3 left-3 flex flex-col items-center gap-2">
                <p className="bg-background/85 text-muted-foreground max-w-lg rounded px-3 py-1 text-center text-[11px]">
                  {toolInfo[tool]}
                </p>
                <div
                  className="bg-background/95 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border p-1.5 shadow-lg"
                  role="toolbar"
                  aria-label="Construction tools"
                >
                  {(
                    [
                      ["inspect", MousePointer2, "Select"],
                      ["distance", Ruler, "Measure"],
                      ["area", ScanLine, "Area"],
                      ["pin", MapPin, "Issue"],
                      ["walk", Footprints, "Walk"],
                    ] as const
                  ).map(([id, Icon, label]) => (
                    <button
                      key={id}
                      disabled={!ready}
                      className={cn(
                        "flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] disabled:opacity-40",
                        tool === id
                          ? "bg-blue-600 text-white"
                          : "hover:bg-muted",
                      )}
                      aria-pressed={tool === id}
                      onClick={() => {
                        setTool(id);
                        setPanel(null);
                      }}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  ))}
                  <button
                    className={cn(
                      "flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px]",
                      panel === "section"
                        ? "bg-blue-600 text-white"
                        : "hover:bg-muted",
                    )}
                    onClick={() =>
                      setPanel((p) => (p === "section" ? null : "section"))
                    }
                  >
                    <Scissors className="size-4" />
                    Section
                  </button>
                  <button
                    disabled={!ready}
                    className="hover:bg-muted flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] disabled:opacity-40"
                    onClick={() => setSaveView(true)}
                  >
                    <Bookmark className="size-4" />
                    Save view
                  </button>
                </div>
                {tool === "area" && (
                  <Button size="sm" onClick={() => scene?.finishMeasurement()}>
                    Finish area
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
        {panel && (
          <aside
            aria-label={panelNames[panel]}
            className="bg-background absolute inset-y-0 left-0 z-20 flex w-[min(88%,340px)] shrink-0 flex-col border-r shadow-xl md:static md:order-first md:w-80 md:shadow-none"
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between border-b px-4">
              <h2 className="text-sm font-semibold">{panelNames[panel]}</h2>
              <button
                aria-label="Close panel"
                className="hover:bg-muted grid size-10 place-items-center rounded"
                onClick={() => setPanel(null)}
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
              {panel === "models" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      {latest.size} model{latest.size === 1 ? "" : "s"} ·{" "}
                      {w.models.length} revision
                      {w.models.length === 1 ? "" : "s"}
                    </span>
                    {w.canUpload && (
                      <Button
                        size="sm"
                        onClick={() => setUpload({ revision: null })}
                      >
                        <Plus className="mr-1 size-4" />
                        Add
                      </Button>
                    )}
                  </div>
                  <input
                    className={inputClass}
                    aria-label="Search models"
                    placeholder="Search models…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={allRevisions}
                      onChange={(e) => setAllRevisions(e.target.checked)}
                    />
                    Show earlier revisions
                  </label>
                  <div className="divide-y">
                    {modelRows.map((m) => (
                      <article key={m.id} className="space-y-3 py-4 first:pt-0">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Open ${m.name} version ${m.version}`}
                            className="mt-1 size-5 accent-blue-600"
                            disabled={m.status !== "ready"}
                            checked={ids.includes(m.id)}
                            onChange={() => toggleModel(m)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium break-words">
                              {m.name}
                            </p>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {titleCase(m.discipline)} · v{m.version} ·{" "}
                              {(m.size / 1024 / 1024).toFixed(1)} MB
                            </p>
                            <span
                              className={cn(
                                "mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                                m.publication === "construction"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {m.publication === "construction"
                                ? "For construction"
                                : m.publication}
                            </span>
                            {latest.get(m.seriesId)?.id !== m.id && (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                Earlier revision
                              </p>
                            )}
                          </div>
                        </div>
                        {m.status !== "ready" && (
                          <div className="bg-muted space-y-2 rounded p-2 text-xs">
                            <p>
                              {m.status === "awaiting_conversion"
                                ? "Revit file uploaded · preparation required"
                                : (m.conversionMessage ?? titleCase(m.status))}
                            </p>
                            {w.canUpload &&
                              m.status !== "processing" &&
                              (w.conversionAvailable ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={convert.isPending}
                                    onClick={() =>
                                      convert.mutate({
                                        jobId: w.job.id,
                                        id: m.id,
                                      })
                                    }
                                  >
                                    Convert with Autodesk
                                  </Button>
                                  <p className="text-muted-foreground text-[10px]">
                                    Sends this model to Autodesk. Usage charges
                                    may apply.
                                  </p>
                                </>
                              ) : (
                                <button
                                  className="font-medium text-blue-600 underline"
                                  onClick={() => setAutodesk(true)}
                                >
                                  Connect Autodesk to open
                                </button>
                              ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                          <a
                            className="text-muted-foreground inline-flex min-h-8 items-center gap-1 hover:underline"
                            href={modelFileUrl(w.job.id, m.id, true)}
                            download
                          >
                            <Download className="size-3" />
                            Source
                          </a>
                          {w.canUpload &&
                            latest.get(m.seriesId)?.id === m.id && (
                              <button
                                className="min-h-8 text-blue-600"
                                onClick={() => setUpload({ revision: m })}
                              >
                                New revision
                              </button>
                            )}
                          {w.canUpload && (
                            <select
                              aria-label={`Publication status for ${m.name} version ${m.version}`}
                              className="bg-background min-h-8 max-w-full rounded border text-xs"
                              value={m.publication}
                              disabled={publication.isPending}
                              onChange={(e) =>
                                publication.mutate({
                                  jobId: w.job.id,
                                  id: m.id,
                                  publication: e.target
                                    .value as BimModel["publication"],
                                })
                              }
                            >
                              <option value="coordination">Coordination</option>
                              <option value="construction">
                                For construction
                              </option>
                              {(w.canDelete ||
                                m.publication === "archived") && (
                                <option value="archived">Archived</option>
                              )}
                            </select>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!w.models.length && (
                    <p className="text-muted-foreground py-3 text-sm leading-relaxed">
                      Add your first model, then select it here to open the
                      viewer. Shared coordinates align separate trade models.
                    </p>
                  )}
                  <button
                    className="text-muted-foreground flex min-h-11 w-full items-center gap-2 border-t pt-3 text-xs"
                    onClick={() => setAutodesk(true)}
                  >
                    <Settings2 className="size-4" />
                    {w.conversionAvailable
                      ? "Autodesk connected · Manage"
                      : "Set up Revit conversion"}
                  </button>
                </>
              )}
              {panel === "elements" && (
                <>
                  <input
                    className={inputClass}
                    placeholder="Name, type or IFC GUID…"
                    aria-label="Search elements"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="block space-y-1 text-xs">
                    Category
                    <select
                      className={inputClass}
                      value={category}
                      onChange={(e) => changeFilter(e.target.value, level)}
                    >
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {titleCase(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs">
                    Level
                    <select
                      className={inputClass}
                      value={level}
                      onChange={(e) => changeFilter(category, e.target.value)}
                    >
                      <option value="">All levels</option>
                      {levels.map(([id, name]) => (
                        <option value={id} key={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>{filteredElements.length} elements</span>
                    <button
                      className="min-h-9 underline"
                      onClick={() =>
                        downloadBlob(
                          new Blob([elementCsv(filteredElements, w.models)], {
                            type: "text/csv;charset=utf-8",
                          }),
                          "model-elements.csv",
                        )
                      }
                    >
                      Export CSV
                    </button>
                  </div>
                  <div className="divide-y">
                    {filteredElements.slice(0, 150).map((e) => (
                      <button
                        className={cn(
                          "block w-full py-3 text-left",
                          selected?.key === e.key && "text-blue-600",
                        )}
                        key={e.key}
                        onClick={() => {
                          viewport.inspect(e);
                          setPanel("properties");
                        }}
                      >
                        <span className="block text-sm break-words">
                          {e.name}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {titleCase(e.type)} · {e.levelName}
                        </span>
                      </button>
                    ))}
                  </div>
                  {filteredElements.length > 150 && (
                    <p className="text-muted-foreground text-xs">
                      Showing the first 150 matches. Narrow your search to find
                      an element.
                    </p>
                  )}
                </>
              )}
              {panel === "properties" &&
                (!selected ? (
                  <p className="text-muted-foreground text-sm">
                    Tap an element in the model to inspect it.
                  </p>
                ) : (
                  <>
                    <div>
                      <h3 className="font-medium break-words">
                        {selected.name}
                      </h3>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {titleCase(selected.type)} · {selected.levelName}
                      </p>
                      <p className="text-muted-foreground mt-1 font-mono text-[10px] break-all">
                        {selected.guid}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          scene?.fit([selected.key]);
                          closeMobilePanel();
                        }}
                      >
                        <Focus className="mr-1 size-4" />
                        Focus
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          scene?.isolateSelection();
                          closeMobilePanel();
                        }}
                      >
                        Isolate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => scene?.hideSelection()}
                      >
                        <EyeOff className="mr-1 size-4" />
                        Hide
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          scene?.boxSelection();
                          setSection(null);
                          closeMobilePanel();
                        }}
                      >
                        Section box
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        scene?.showAll();
                        setCategory("");
                        setLevel("");
                      }}
                    >
                      <RotateCcw className="mr-1 size-4" />
                      Show all elements
                    </Button>
                    {properties.length ? (
                      <dl className="divide-y">
                        {properties.map((p, i) => (
                          <div key={i} className="py-2">
                            <dt className="text-muted-foreground text-[10px] tracking-wide uppercase">
                              {p.group} · {p.name}
                            </dt>
                            <dd className="mt-1 text-sm break-words">
                              {p.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Reading element properties…
                      </p>
                    )}
                  </>
                ))}
              {panel === "views" && (
                <>
                  <Button
                    className="w-full"
                    disabled={!ready}
                    onClick={() => setSaveView(true)}
                  >
                    <Bookmark className="mr-2 size-4" />
                    Save current view
                  </Button>
                  <div className="divide-y">
                    {w.views.map((v) => (
                      <div className="py-3" key={v.id}>
                        <button
                          className="w-full text-left"
                          onClick={() => restoreView(v.view)}
                        >
                          <span className="block text-sm font-medium">
                            {v.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {v.authorName} · {v.view.modelIds.length} model
                            {v.view.modelIds.length === 1 ? "" : "s"} ·{" "}
                            {v.view.measurements.length} measurements
                          </span>
                        </button>
                        {(w.canUpload || v.authorId === w.userId) && (
                          <button
                            className="text-muted-foreground mt-1 min-h-8 text-xs underline"
                            disabled={removeView.isPending}
                            onClick={() =>
                              removeView.mutate({ jobId: w.job.id, id: v.id })
                            }
                          >
                            Remove saved view
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!w.views.length && (
                    <p className="text-muted-foreground text-sm">
                      Save camera angles, section cuts, filters and measurements
                      so the team can return to the same detail.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!ready}
                    onClick={() => {
                      const url = scene?.screenshot();
                      if (url) {
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "model-view.png";
                        a.click();
                      }
                    }}
                  >
                    <Camera className="mr-2 size-4" />
                    Download snapshot
                  </Button>
                </>
              )}
              {panel === "issues" && (
                <>
                  <Button
                    className="w-full"
                    disabled={!ready}
                    onClick={() => {
                      setTool("pin");
                      setPanel(null);
                    }}
                  >
                    <MapPin className="mr-2 size-4" />
                    Place issue on model
                  </Button>
                  <input
                    className={inputClass}
                    placeholder="Search issues…"
                    aria-label="Search issues"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="divide-y">
                    {w.issues
                      .filter((i) =>
                        `${i.title} ${i.status} ${i.kind}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((i, index) => (
                        <div key={i.id} className="space-y-2 py-3">
                          <button
                            className="flex w-full items-start gap-2 text-left"
                            onClick={() => openIssue(i.id)}
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white",
                                ["closed", "resolved"].includes(i.status)
                                  ? "bg-emerald-600"
                                  : "bg-orange-600",
                              )}
                            >
                              {index + 1}
                            </span>
                            <div>
                              <span className="block text-sm font-medium">
                                {i.title}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {i.kind.toUpperCase()} ·{" "}
                                {i.status.replaceAll("_", " ")} · {i.priority}
                              </span>
                              {i.dueDate && (
                                <span className="text-muted-foreground block text-xs">
                                  Due {i.dueDate}
                                </span>
                              )}
                            </div>
                          </button>
                          <button
                            className="min-h-9 text-xs font-medium text-blue-600"
                            onClick={() => restoreView(i.view)}
                          >
                            Go to saved location
                          </button>
                        </div>
                      ))}
                  </div>
                  {!w.issues.length && (
                    <p className="text-muted-foreground text-sm">
                      Pin coordination questions, RFIs, punch items and safety
                      observations to their exact model location.
                    </p>
                  )}
                  {w.issues.length > 0 && (
                    <div className="flex flex-wrap gap-3 border-t pt-3">
                      <button
                        className="min-h-9 text-xs underline"
                        onClick={() =>
                          downloadBlob(
                            new Blob([issueCsv(w.issues, w.members)], {
                              type: "text/csv;charset=utf-8",
                            }),
                            "model-issues.csv",
                          )
                        }
                      >
                        Export CSV
                      </button>
                      <button
                        className="min-h-9 text-xs underline"
                        onClick={() =>
                          downloadBlob(
                            new Blob(
                              [
                                issueBcf(
                                  w.issues,
                                  w.models,
                                ) as Uint8Array<ArrayBuffer>,
                              ],
                              { type: "application/zip" },
                            ),
                            "model-issues.bcfzip",
                          )
                        }
                      >
                        Export BCF viewpoints
                      </button>
                    </div>
                  )}
                </>
              )}
              {panel === "section" && (
                <>
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-blue-600"
                      checked={!!section}
                      onChange={(e) => {
                        const s = e.target.checked
                          ? {
                              axis: "y" as const,
                              value: (min + max) / 2,
                              flipped: false,
                            }
                          : null;
                        setSection(s);
                        scene?.setSection(s);
                      }}
                    />
                    Cut through the model
                  </label>
                  {section && (
                    <>
                      <label className="block space-y-1 text-xs">
                        Direction
                        <select
                          className={inputClass}
                          value={axis}
                          onChange={(e) => {
                            const a = e.target.value as "x" | "y" | "z",
                              index = a === "x" ? 0 : a === "y" ? 1 : 2;
                            const s = {
                              ...section,
                              axis: a,
                              value:
                                bounds && !bounds.isEmpty()
                                  ? (bounds.min.getComponent(index) +
                                      bounds.max.getComponent(index)) /
                                    2
                                  : 0,
                            };
                            setSection(s);
                            scene?.setSection(s);
                          }}
                        >
                          <option value="y">Horizontal / floor</option>
                          <option value="x">Vertical / X</option>
                          <option value="z">Vertical / Y</option>
                        </select>
                      </label>
                      <label className="block space-y-3 text-sm">
                        Cut position
                        <input
                          aria-label="Cut position"
                          className="w-full accent-blue-600"
                          type="range"
                          min={min}
                          max={max}
                          step={Math.max(0.001, (max - min) / 500)}
                          value={section.value}
                          onChange={(e) => {
                            const s = {
                              ...section,
                              value: Number(e.target.value),
                            };
                            setSection(s);
                            scene?.setSection(s);
                          }}
                        />
                      </label>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          const s = { ...section, flipped: !section.flipped };
                          setSection(s);
                          scene?.setSection(s);
                        }}
                      >
                        Flip cut direction
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setSection(null);
                      scene?.setSection(null);
                    }}
                  >
                    Clear all section cuts
                  </Button>
                  <hr />
                  <label className="block space-y-1 text-xs">
                    Measurement units
                    <select
                      className={inputClass}
                      value={units}
                      onChange={(e) =>
                        setUnits(e.target.value as "metric" | "imperial")
                      }
                    >
                      <option value="metric">Metres / millimetres</option>
                      <option value="imperial">Feet / inches</option>
                    </select>
                  </label>
                  <p className="text-muted-foreground text-xs">
                    Measurements follow the model geometry and its exported
                    units. Verify the model’s scale and current construction
                    revision before layout.
                  </p>
                  {measures.map((m, i) => (
                    <p key={m.id} className="text-sm">
                      {i + 1}. {m.type === "area" ? "Area" : "Distance"} ·{" "}
                      {formatModelMeasure(
                        m.type === "area"
                          ? measureArea(m.points)
                          : measureDistance(m.points),
                        units,
                        m.type === "area",
                      )}
                    </p>
                  ))}
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!measures.length}
                    onClick={() => scene?.clearMeasurements()}
                  >
                    Clear measurements
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      scene?.showAll();
                      setCategory("");
                      setLevel("");
                    }}
                  >
                    Show all hidden elements
                  </Button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      <footer className="bg-background text-muted-foreground z-10 flex min-h-8 shrink-0 items-center justify-between gap-3 border-t px-3 text-[10px]">
        <span className="truncate">
          {ids.length
            ? `${ids.length} model${ids.length === 1 ? "" : "s"} · ${elements.length.toLocaleString()} elements · ${units}`
            : "Revit + IFC · Construction coordination"}
          {ids.some((id) => {
            const m = w.models.find((m) => m.id === id);
            return (
              m &&
              (m.publication !== "construction" ||
                latest.get(m.seriesId)?.id !== id)
            );
          }) && " · Check revision status"}
        </span>
        <button
          aria-label="Viewer help"
          className="grid size-8 shrink-0 place-items-center"
          onClick={() => setHelp(true)}
        >
          <Info className="size-4" />
        </button>
      </footer>
      {upload && (
        <UploadModelDialog
          workspace={w}
          revision={upload.revision}
          onClose={() => setUpload(null)}
          onUploaded={(m) => {
            refresh();
            if (m.status === "ready") {
              setRestore(null);
              setIds((old) => [
                ...old.filter(
                  (id) =>
                    w.models.find((row) => row.id === id)?.seriesId !==
                    m.seriesId,
                ),
                m.id,
              ]);
              closeMobilePanel();
            }
          }}
        />
      )}
      {autodesk && (
        <AutodeskDialog
          workspace={w}
          onClose={() => setAutodesk(false)}
          onConnected={refresh}
        />
      )}
      {issueOpen && (
        <IssueDialog
          key={issueOpen.id ?? "new"}
          workspace={w}
          issue={w.issues.find((i) => i.id === issueOpen.id) ?? null}
          draft={issueOpen.draft}
          onClose={() => setIssueOpen(null)}
          onSaved={refresh}
        />
      )}
      <Dialog open={saveView} onOpenChange={setSaveView}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Includes loaded revisions, camera, visibility, cuts and
              measurements.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const view = capture();
              if (view) save.mutate({ jobId: w.job.id, name: viewName, view });
            }}
          >
            <input
              autoFocus
              aria-label="View name"
              className={inputClass}
              value={viewName}
              maxLength={200}
              required
              placeholder="Level 2 · mechanical clearance"
              onChange={(e) => setViewName(e.target.value)}
            />
            {save.error && (
              <p role="alert" className="text-destructive text-sm">
                {save.error.message}
              </p>
            )}
            <Button className="w-full" disabled={save.isPending || !ready}>
              Save view
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Working with the model</DialogTitle>
            <DialogDescription>
              Explore, measure and coordinate on site.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-semibold">Navigation</dt>
              <dd className="text-muted-foreground mt-1">
                Drag to orbit. Pinch or scroll to zoom. Use two fingers or the
                right mouse button to pan. Fit returns the whole model to view.
                Walk uses arrows or W A S D; it is free movement without
                collision detection.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Revit and IFC</dt>
              <dd className="text-muted-foreground mt-1">
                Revit files are converted by Autodesk after your company
                connects APS. IFC opens directly. This viewer displays exported
                geometry and properties. Revit editing, sheets and embedded
                links are not included. Load separate trade models with matching
                shared coordinates.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Performance</dt>
              <dd className="text-muted-foreground mt-1">
                Up to 250 MB per file and 6 million vertices per model. Open
                only the trades you need on a phone. Opening files, saving and
                collaboration require a connection.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Coordination</dt>
              <dd className="text-muted-foreground mt-1">
                Saved views and issue locations retain their exact model
                revisions. BCF export includes issue text, selected element and
                camera viewpoints. Use model properties and element CSV for
                inspection; automatic clash detection and cost takeoff are not
                included.
              </dd>
            </div>
          </dl>
        </DialogContent>
      </Dialog>
    </section>
  );
}
