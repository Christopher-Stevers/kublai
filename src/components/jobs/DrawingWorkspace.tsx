"use client";
import { mergeDrawingWorkspaceSnapshot } from "~/lib/drawing-workspace-payload";
import { DEFAULT_HYPERLINK_COLOR, DEFAULT_HYPERLINK_OPACITY } from "~/lib/drawing-hyperlink-style";
import { useDrawingLayerVisibility, type DrawingLayers } from "./useDrawingLayerVisibility";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { useSystemsAccess } from "~/components/permissions/SystemsAccess";
import { SuperEquipmentDialog } from "./SuperEquipmentDialog";
import { SuperSpecMaterialDialog } from "./SuperSpecMaterialDialog";

import { LegendItemsDialog } from "./LegendItemsDialog";
import { equipmentDrawingDestination, legacyEquipmentDocumentLink } from "~/lib/equipment-tags";
import { measurementLayerNames } from "~/lib/measurement-layers";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { rememberHyperlinkSource } from "~/hooks/use-hyperlink-back";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { useDrawingPageMode } from "./DrawingPageMode";
import { DrawingArcMenu, DrawingArcRegistration, type DrawingArcItem } from "./DrawingArcMenu";
import { drawingArcStyleItems } from "./drawing-arc-style";
import { MARKUP_SHAKE_MS } from "./useDrawingEditor";

import { useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AutoHyperlinkDialog } from "./AutoHyperlinkDialog";
import { EquipmentTagLinks } from "./EquipmentTagLinks";
import { EquipmentTagDestinations } from "./EquipmentTagDestinations";
import { MAX_DRAWING_LINKS, drawingMarkupLinks as equipmentExistingLinks } from "~/lib/drawing-links";
import { useDrawingDestination } from "./DrawingDestinationProvider";
import { DRAWING_DESTINATION_EVENT, type SnapshotState, readSnapshotState } from "~/lib/snapshot-source";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { currentSnapshotState } from "~/lib/snapshot-source";
import { api } from "~/trpc/react";
import { useDrawingWorkspaceQuery } from "~/hooks/use-drawing-workspace-query";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SwitchTrack } from "~/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "~/components/ui/dialog";
import { drawingDestinationLinks, drawingLinkHref } from "~/lib/drawing-links";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ActivityIcon,
  BellIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  TextSearchIcon,
  HandIcon,
  HistoryIcon,
  InfoIcon,
  LayersIcon,
  SlidersHorizontalIcon,
  Link2Icon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  ListChecksIcon,
  MessageSquareMoreIcon,
  MaximizeIcon,
  MinimizeIcon,
  MoveIcon,
  BookOpenIcon,
  MoreHorizontalIcon,
  MousePointer2Icon,
  PaletteIcon,
  PenLineIcon,
  RulerIcon,
  ScanIcon,
  SparklesIcon,
  SendIcon,
  SplineIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
  ArrowUpRightIcon,
  CircleIcon,
  CloudIcon,
  CloudyIcon,
  HashIcon,
  HighlighterIcon,
  MessageSquareTextIcon,
  MoveHorizontalIcon,
  PaintBucketIcon,
  PencilIcon,
  ScalingIcon,
  SlashIcon,
  SquareDashedIcon,
  SquareIcon,
  Trash2Icon,
  TriangleRightIcon,
  TypeIcon,
  WaypointsIcon,
  XIcon,
  EyeIcon,
  EyeOffIcon,
  type LucideIcon,
} from "lucide-react";
import { MEASURE_TILE } from "./SheetMeasureBar";
import { StyleStrip } from "./StyleStrip";
import { notify } from "~/components/ui/app-dialogs";
import {
  drawingPdfLinkPage,
  drawingPdfLinkTarget,
  drawingPdfLinkUrl,
} from "~/lib/drawing-pdf-links";
import { sourcePdfPage } from "~/lib/pdf-client";
import { tileBase } from "~/lib/drawing-tiles";
import {
  drawingSaveSchema,
  isQueuedDrawingEdit,
  drawingMetadataSchema,
  type DrawingEntity,
  type DrawingJobSheet,
  type DrawingMarkup,
  type DrawingMarkupLink,
  type DrawingMetadata,
  type DrawingSave,
  type DrawingStyle,
  type DrawingTool,
  type DrawingWorkspace as Workspace,
} from "~/lib/drawing-workspace";
import {
  readDrawingText,
  type DrawingPdfLink,
  type DrawingTextIndex,
  type DrawingText,
} from "~/lib/drawing-text";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import type { ScrollStack } from "./drawing-scroll-pages";
import {
  DrawingEntityForm,
  DrawingField,
  drawingFieldClass,
} from "./DrawingEntityForm";
import { SuperLabelDialog } from "./SuperLabelDialog";
import { SuperScaleDialog } from "./SuperScaleDialog";
import { DrawingAppearanceDialog } from "./DrawingAppearanceDialog";
import { useDrawingAppearance } from "./useDrawingAppearance";
import { useDrawingMarkupVisibility } from "./useDrawingMarkupVisibility";
import { DrawingOverlayPicker } from "./DrawingOverlayPicker";
import { FileComparison } from "./FileComparison";
import { DrawingCompare } from "./DrawingCompare";
import { DrawingDocumentActions } from "./DrawingDocumentActions";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { useDrawingQueuedEdits } from "./useDrawingQueuedEdits";
import { drawingThumbnailUrl } from "./drawing-scroll-pages";

/** Tools menu: everything that is not a markup type. */
const OTHER_TOOLS = new Set<DrawingTool>([
  "pan",
  "viewing",
  "select",
  "link",
  "issue",
  "rfi",
]);
const BAR_BUTTON =
  "drawing-state-control h-11 w-full gap-1.5 rounded-md px-2 text-sm font-medium whitespace-normal";
export const tools: Array<[DrawingTool, string]> = [
  ["pan", "Viewing"],
  ["select", "Edit Mode"],
  ["freehand", "Pen"],
  ["highlight", "Highlighter"],
  ["text", "Text"],
  ["callout", "Callout"],
  ["cloud", "Revision cloud"],
  ["polycloud", "Polygon cloud"],
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["polyline", "Polyline"],
  ["line", "Line"],
  ["arrow", "Arrow"],
  ["dimension", "Dimension"],
  ["area", "Area"],
  ["angle", "Angle"],
  ["count", "Count"],
  ["link", "Hyperlink"],
  ["issue", "Issue pin"],
  ["rfi", "RFI pin"],
];
type Panel =
  | ""
  | "markups"
  | "impacts"
  | "issues"
  | "views"
  | "details"
  | "history"
  | "reviews"
  | "packages"
  | "files"
  | "activity"
  | "selected"
  | "notifications";
export const panels: Array<[Panel, string]> = [
  ["notifications", "Drawing notifications"],
  ["impacts", "Needs review · revision impacts"],
  ["markups", "Layers"],
  ["issues", "Issues / RFIs"],
  ["views", "Saved views"],
  ["details", "Sheet details"],
  ["history", "Versions / compare"],
  ["reviews", "Reviews"],
  ["packages", "Transmittals"],
  ["files", "Download / offline"],
  ["activity", "Activity"],
];
const PANEL_ICONS: Partial<Record<Panel, LucideIcon>> = {
  notifications: BellIcon,
  impacts: CircleAlertIcon,
  markups: LayersIcon,
  issues: CircleAlertIcon,
  views: BookmarkIcon,
  details: FileTextIcon,
  history: HistoryIcon,
  reviews: ListChecksIcon,
  packages: SendIcon,
  files: DownloadIcon,
  activity: ActivityIcon,
};
const TOOL_ICONS: Partial<Record<DrawingTool, LucideIcon>> = {
  pan: HandIcon,
  viewing: HandIcon,
  select: MousePointer2Icon,
  link: Link2Icon,
  issue: CircleAlertIcon,
  rfi: MessageSquareMoreIcon,
};
const MARKUP_ICONS: Partial<Record<DrawingTool, LucideIcon>> = {
  freehand: PencilIcon,
  highlight: HighlighterIcon,
  text: TypeIcon,
  callout: MessageSquareTextIcon,
  cloud: CloudIcon,
  polycloud: CloudyIcon,
  rect: SquareIcon,
  ellipse: CircleIcon,
  polyline: WaypointsIcon,
  line: SlashIcon,
  arrow: ArrowUpRightIcon,
  dimension: MoveHorizontalIcon,
  area: SquareDashedIcon,
  angle: TriangleRightIcon,
  count: HashIcon,
};
/** Colour, line width and fill: the same style controls a markup is drawn with. */
function MarkupStyleRow({
  data,
  disabled,
  onChange,
  customColorLabel,
}: {
  data: DrawingMarkup;
  disabled?: boolean;
  onChange: (patch: Partial<DrawingMarkup>) => void;
  customColorLabel?: string;
}) {
  const filled = Boolean(data.fill && data.fill !== "none");
  return (
    <div role="group" aria-label="Markup style">
      <StyleStrip
        color={data.stroke}
        colorLabel="Markup colour"
        customColorLabel={customColorLabel}
        onColor={(stroke) =>
          onChange({
            stroke,
            ...(filled ? { fill: `${stroke.slice(0, 7)}33` } : {}),
          })
        }
        width={data.width}
        onWidth={(width) => onChange({ width })}
        disabled={disabled}
        end={
          <button
            type="button"
            aria-pressed={filled}
            aria-label="Fill"
            title="Fill"
            disabled={disabled}
            className={`drawing-state-control grid size-8 shrink-0 place-items-center rounded-full ${filled ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            onClick={() =>
              onChange({ fill: filled ? "none" : `${data.stroke.slice(0, 7)}33` })
            }
          >
            <PaintBucketIcon className="size-4" />
          </button>
        }
      />
    </div>
  );
}
const SELECTED_BUTTON = "drawing-state-control h-8 shrink-0 rounded-full px-3 text-xs";
const SELECTED_ICON = "drawing-state-control h-8 w-10 shrink-0 rounded-full";
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
const MEASUREMENT_TYPES: DrawingTool[] = [
  "dimension",
];
const MARKUP_TYPES: DrawingTool[] = [
  "freehand",
  "highlight",
  "text",
  "callout",
  "cloud",
  "polycloud",
  "rect",
  "ellipse",
  "polyline",
  "line",
  "arrow",
  "area",
  "angle",
  "count",
];
const PIN_TYPES: DrawingTool[] = ["link", "issue", "rfi"];
const layerLabel = (type: DrawingTool) =>
  tools.find(([tool]) => tool === type)?.[1] ?? capitalize(type);
/** One row in the Layers list: tap anywhere to show or hide it. */
function LayerRow({
  icon: Icon,
  label,
  count,
  on,
  muted,
  child,
  onToggle,
}: {
  icon?: LucideIcon;
  label: string;
  count?: number;
  on: boolean;
  muted?: boolean;
  child?: boolean;
  onToggle: () => void;
}) {
  const Eye = on ? EyeIcon : EyeOffIcon;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} layer`}
      data-layer-row
      onClick={onToggle}
      className={`hover:bg-muted/70 flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm transition-colors ${child ? "pl-5.5" : "font-medium"} ${on && !muted ? "" : "text-muted-foreground"}`}
    >
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-lg ${child ? "size-7" : "size-8"} ${on && !muted ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
      >
        {Icon && <Icon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      )}
      <Eye
        aria-hidden
        className={`size-4 shrink-0 ${on ? "text-foreground/70" : "text-muted-foreground/70"}`}
      />
    </button>
  );
}
/** Rows without an arrow keep its space, so every eye and arrow lines up in one column. */
function ArrowColumn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {children}
      <span aria-hidden className="size-11 shrink-0" />
    </div>
  );
}
/** Each person who has drawn on this sheet, so their work can be switched off. */
function PeopleLayers({
  entities,
  sourceId,
  actorId,
  layers,
  setLayers,
}: {
  entities: DrawingEntity[];
  sourceId: string;
  actorId: string;
  layers: DrawingLayers;
  setLayers: (next: (old: DrawingLayers) => DrawingLayers) => void;
}) {
  const people = new Map<string, { name: string; count: number }>();
  for (const entity of entities)
    if (
      (entity.kind === "markup" || entity.kind === "issue") &&
      entity.visibility !== "archived" &&
      sourceOf(entity) === sourceId
    ) {
      const person = people.get(entity.authorId);
      if (person) person.count++;
      else
        people.set(entity.authorId, {
          name: entity.authorName.trim() || "Unknown",
          count: 1,
        });
    }
  if (people.size === 0) return null;
  const hidden = layers.hiddenPeople ?? [];
  const toggle = (id: string) =>
    setLayers((old) => ({
      ...old,
      hiddenPeople: old.hiddenPeople?.includes(id)
        ? old.hiddenPeople.filter((item) => item !== id)
        : [...(old.hiddenPeople ?? []), id],
    }));
  const rows = [...people].sort(([a, x], [b, y]) =>
    a === actorId ? -1 : b === actorId ? 1 : x.name.localeCompare(y.name),
  );
  return (
    <details className="group/layers">
      <summary
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg pl-2 text-sm font-medium hover:bg-muted/70"
        aria-label="Expand People Layers"
      >
        <span aria-hidden className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
          <UsersIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">People</span>
        {layers.onlyMine ? (
          <span className="text-muted-foreground text-xs">Only mine</span>
        ) : hidden.some((id) => people.has(id)) && (
          <span className="text-muted-foreground text-xs">{hidden.filter((id) => people.has(id)).length} off</span>
        )}
        <span className="grid size-11 shrink-0 place-items-center">
          <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open/layers:rotate-90" />
        </span>
      </summary>
      <ArrowColumn>
      <button
        type="button"
        role="switch"
        aria-checked={!!layers.onlyMine}
        onClick={() => setLayers((old) => ({ ...old, onlyMine: !old.onlyMine }))}
        className="hover:bg-muted/70 flex min-h-11 w-full items-center gap-3 rounded-lg pr-2 pl-5.5 text-left text-sm transition-colors"
      >
        <span className="min-w-0 flex-1 truncate">Show only mine</span>
        <SwitchTrack checked={!!layers.onlyMine} />
      </button>
      </ArrowColumn>
      {rows.map(([id, person]) => (
        <ArrowColumn key={id}>
          <LayerRow child icon={UserIcon}
            label={id === actorId ? `${person.name} (you)` : person.name}
            count={person.count} on={!hidden.includes(id)}
            muted={!!layers.onlyMine && id !== actorId} onToggle={() => toggle(id)} />
        </ArrowColumn>
      ))}
    </details>
  );
}
const nameOf = (entity: DrawingEntity) =>
  entity.kind === "issue"
    ? entity.data.title
    : entity.kind === "markup"
      ? (entity.data.text ?? entity.data.type)
      : entity.kind === "view"
        ? entity.data.name
        : entity.kind === "version"
          ? entity.data.label
          : entity.kind === "review"
            ? entity.data.status.replaceAll("_", " ")
            : entity.data.title;
const sourceOf = (entity: DrawingEntity) =>
  entity.kind === "transmittal" ? null : entity.data.sourceSheetId;

/** Keep viewer controls outside the page scroller when the host provides a dock. */
function DrawingToolbarDock({ target, children }: { target?: HTMLElement | null; children: ReactNode }) {
  // React can retain a hidden page (Activity/Suspense) without unmounting it.
  // Portal children escape that page's hidden DOM, so tie their attachment to
  // layout effects, which React disconnects while the owning page is hidden.
  const host = useMemo(() => {
    if (!target) return null;
    const element = target.ownerDocument.createElement("div");
    element.style.display = "contents";
    return element;
  }, [target]);
  useLayoutEffect(() => {
    if (!target || !host) return;
    target.appendChild(host);
    return () => { host.remove(); };
  }, [target, host]);
  return host ? createPortal(children, host) : children;
}

export function DrawingWorkspace({
  jobId,
  sheet,
  onOpenSheet,
  initialViewport,
  initialSnapshot,
  onViewportChange,
  onReady,
  onDocumentDetails,
  pageModeScope,
  scrollPages = false,
  scrollStack,
  toolbarContainer,
  cornerContainer,
  onClose,
  onPrepareOffline,
  onFullscreen,
  fullscreenRef,
  fullscreen = false,
  pageNavigation,
}: {
  jobId: string;
  sheet: {
    id: string;
    name: string;
    imageUrl: string;
    width: number;
    height: number;
    sourceFilename?: string | null;
  };
  onOpenSheet: (sheet: DrawingJobSheet) => void;
  initialViewport?: DrawingViewport | null;
  initialSnapshot?: SnapshotState | null;
  onViewportChange?: (viewport: DrawingViewport) => void;
  onReady?: () => void;
  onDocumentDetails?: () => void;
  pageModeScope?: string;
  scrollPages?: boolean;
  scrollStack?: ScrollStack;
  toolbarContainer?: HTMLElement | null;
  /** Viewer-level layer for the corner buttons, so scrolling pages never carries them off. */
  cornerContainer?: HTMLElement | null;
  onClose?: () => void;
  onPrepareOffline?: () => Promise<void>;
  /** Shows a full screen button in the middle of the toolbar. */
  onFullscreen?: () => void;
  fullscreenRef?: Ref<HTMLButtonElement>;
  fullscreen?: boolean;
  pageNavigation?: { index: number; count: number; onPrevious: () => void; onNext: () => void };
}) {
  const quickWheel = fullscreen;
  const [toolToolbarOpen, setToolToolbarOpen] = useState(!quickWheel);
  const { scroll, setScroll } = useDrawingPageMode(pageModeScope ?? `drawing-sheet:${jobId}:${sheet.id}`);
  const [wheelStyleOpen, setWheelStyleOpen] = useState(false);
  const router = useRouter();
  const sourceRegistry = useContext(SnapshotSourceContext);
  const [equipmentBusy, setEquipmentBusy] = useState(false);
  const destinationPicker = useDrawingDestination();
  const [entrySnapshot] = useState(() => initialSnapshot === undefined ? currentSnapshotState() : initialSnapshot);
  const entryDrawing =
    entrySnapshot?.drawing?.jobId === jobId &&
    entrySnapshot.drawing.sheetId === sheet.id
      ? entrySnapshot.drawing
      : null;
  const account = useDrawingAccount();
  const [defaultMarkupVisibility, setDefaultMarkupVisibility] =
    useDrawingMarkupVisibility();
  const [defaultAppearance, changeDefaultAppearance] = useDrawingAppearance();
  const [linkedAppearance, setLinkedAppearance] = useState(
    entryDrawing?.appearance ?? null,
  );
  const appearance = linkedAppearance ?? defaultAppearance;
  const changeAppearance = (value: typeof appearance) => {
    setLinkedAppearance(value);
    changeDefaultAppearance(value);
  };
  const [appearanceOpen, setAppearanceOpen] = useState(
    entryDrawing?.appearanceOpen ?? false,
  );
  const utils = api.useUtils();
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [snapshot, setSnapshot] = useState<Workspace | null>(null);
  const [layers, setLayers] = useDrawingLayerVisibility(account?.accountKey, sheet.id, entryDrawing?.layers);
  const hyperlinksVisible = layers.issues && !layers.hidden?.includes("link");
  const query = useDrawingWorkspaceQuery(sheet.id, online, hyperlinksVisible);
  // Cache keys also include the simulation session; identity comes from the
  // server-validated account, never from parsing a storage namespace.
  const boundUser = account?.userId;
  const accessRevoked = ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(
    query.error?.data?.code ?? "",
  );
  const serverData =
    !accessRevoked &&
    query.data &&
    (!boundUser || query.data.actor.id === boundUser)
      ? query.data
      : null;
  const visibleServerData = useMemo(() => serverData && hyperlinksVisible && serverData.omittedHyperlinks
    ? mergeDrawingWorkspaceSnapshot(serverData, snapshot) : serverData, [serverData, snapshot, hyperlinksVisible]);
  const data =
    visibleServerData ??
    (!accessRevoked &&
    snapshot?.sheetId === sheet.id &&
    (!boundUser || snapshot.actor.id === boundUser)
      ? snapshot
      : null);
  // Snapshots saved before Find text was removed may still name it.
  const entryPanel = entryDrawing?.panel === "search" ? "" : (entryDrawing?.panel ?? "");
  const [panel, setPanel] = useState<Panel>(entryPanel);
  useEffect(() => { if (quickWheel) { setMarkupOpen(false); } }, [quickWheel]);
  const canAccessSystems = useSystemsAccess();
  const [superSpecMaterialOpen, setSuperSpecMaterialOpen] = useState(false);
  const [superEquipmentOpen, setSuperEquipmentOpen] = useState(false);
  const [superLabelOpen, setSuperLabelOpen] = useState(false);
  const [superScaleOpen, setSuperScaleOpen] = useState(false);
  const [superScalePrompt, setSuperScalePrompt] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("superScale") === "review") setSuperScaleOpen(true);
  }, [sheet.id]);
  const superScaleCalibration = useRef<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>("pan");
  const toolLabel = tools.find(([id]) => id === tool)?.[1] ?? "Tools";
  const activeTool = useRef(tool);
  activeTool.current = tool;
  const finishInlineText = useRef<(selectAfterSave?: boolean) => void>(() => undefined);
  // Bottom bar: the Markup panel, and Measure / Pipe system in the viewer.
  const [markupOpen, setMarkupOpen] = useState(
    entryDrawing?.markupOpen ?? false,
  );
  const [modeRequest, setModeRequest] = useState<{
    id: number;
    mode: "idle" | "measure" | "pipe" | "calibrate";
  }>({ id: 0, mode: "idle" });
  const requestMode = useCallback((mode: "idle" | "measure" | "pipe" | "calibrate") => {
    setModeRequest((current) => ({ id: current.id + 1, mode }));
  }, []);
  const selectTool = useCallback(
    (next: DrawingTool) => {
      requestMode("idle");
      setTool(next === "viewing" ? "pan" : next);
      setMarkupOpen(false);
      if (next === "viewing") {
        finishInlineText.current(false);
        setSelectedId(null);
        setMarkupMenu(null);
        setPanel("");
      }
    },
    [requestMode],
  );
  const finishTool = () => {
    selectTool("pan");
    setSelectedId(null);
  };
  // Done leaves whatever is in use for Viewing or Select, whichever was last.
  const restTool = useRef<DrawingTool>("pan");
  useEffect(() => {
    if (tool === "viewing" || tool === "select") restTool.current = tool;
  }, [tool]);
  const finishUsing = () => {
    setToolToolbarOpen(!quickWheel);
    finishInlineText.current(false);
    setBottomMode({ measuring: false, pipe: false });
    setSelectedId(null);
    selectTool(restTool.current);
  };
  const [legendOpen, setLegendOpen] = useState(false);
  const [autoHyperlinkOpen, setAutoHyperlinkOpen] = useState(false);
  const openAutoHyperlink = () => {
    selectTool("pan");
    setAutoHyperlinkOpen(true);
    setPanel("");
    setHighlight(null);
    setSelectedId(null);
    setCompareIds(null);
    setFileComparisonOpen(false);
  };
  const [bottomMode, setBottomMode] = useState({
    measuring: false,
    pipe: false,
  });
  const [style, setStyle] = useState<DrawingStyle>({
    stroke: "#ef4444",
    width: 2,
    fill: "none",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editReadyId, setEditReadyId] = useState<string | null>(null);
  // A mouse right-click is deliberate, so its menu doesn't wait for the shake.
  const readyNow = useRef<string | null>(null);
  useEffect(() => {
    const now = readyNow.current === selectedId;
    readyNow.current = null;
    setEditReadyId(now ? selectedId : null);
    if (now) return;
    const timer = setTimeout(() => setEditReadyId(selectedId), MARKUP_SHAKE_MS);
    return () => clearTimeout(timer);
  }, [selectedId]);
  // A text markup being typed in place on the drawing.
  const [inlineText, setInlineText] = useState<{
    id: string | null;
    data: DrawingMarkup;
  } | null>(null);
  const [measurementEdit, setMeasurementEdit] = useState<{id:number;entityId:string}|null>(null);
  const editMeasurement = (entityId:string) => {setTool("pan");setPanel("");setMeasurementEdit({id:Date.now(),entityId});};
  /** The right-click menu for a selected markup, at the cursor. */
  const [markupMenu, setMarkupMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState<"move" | "resize">(
    "resize",
  );
  const [form, setForm] = useState<DrawingSave | null>(null);
  const [linkChooser, setLinkChooser] = useState<DrawingMarkup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedDrafts, setFailedDrafts] = useState<DrawingSave[]>([]);
  const [pending, setPending] = useState(0);
  const [optimistic, setOptimistic] = useState<DrawingEntity[]>([]);
  const [sourceOverride, setSourceOverride] = useState<string | null>(
    entryDrawing?.sourceSheetId ?? null,
  );
  const [compareIds, setCompareIds] = useState<{
    first: string;
    second: string;
    additional?: string[];
    focus?: DrawingViewport;
  } | null>(
    entryDrawing && entrySnapshot?.overlay
      ? {
          first: entrySnapshot.overlay.ids[0]!,
          second: entrySnapshot.overlay.ids[1]!,
          additional: entrySnapshot.overlay.ids.slice(2),
        }
      : null,
  );
  const [overlayPickerOpen, setOverlayPickerOpen] = useState(false);
  const [fileComparisonOpen, setFileComparisonOpen] = useState(false);
  const [navigate, setNavigate] = useState<{
    center: { x: number; y: number };
    zoom: number;
    requestId: string;
  } | null>(null);
  const viewport = useRef<DrawingViewport>(
    initialViewport ?? entryDrawing?.viewport ?? { center: { x: 0.5, y: 0.5 }, zoom: 1 },
  );
  const updateViewport = (value: DrawingViewport) => {
    viewport.current = value;
    onViewportChange?.(value);
  };
  const [comment, setComment] = useState("");
  const [metadata, setMetadata] = useState<DrawingMetadata | null>(null);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [words, setWords] = useState<DrawingTextIndex>({
    words: [],
    links: [],
  });
  const [highlight, setHighlight] = useState<DrawingText | null>(entryDrawing?.highlight ?? null);
  // The bar's search: the text in this set's PDF pages and the job's PDF
  // documents, then drawings and documents by name.
  const [find, setFind] = useState("");
  const [findRound, setFindRound] = useState(0);
  const [findText, setFindText] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFindText(find.trim()), 300);
    return () => clearTimeout(timer);
  }, [find]);
  const finding = findText.length >= 2;
  // The current result, moved by the bar's arrows.
  const [findAt, setFindAt] = useState(0);
  useEffect(() => setFindAt(0), [findText]);
  const findList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    findList.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [findAt]);
  const textInSheets = api.drawingsWorkspace.textSearch.useQuery(
    { sheetId: sheet.id, kind: "drawing", query: findText },
    { enabled: finding && online, retry: 1, staleTime: 60_000 },
  );
  const textInDocuments = api.drawingsWorkspace.textSearch.useQuery(
    { sheetId: sheet.id, kind: "document", query: findText },
    { enabled: finding && online, retry: 1, staleTime: 60_000 },
  );
  const foundSheets = api.drawingsWorkspace.linkTargets.useQuery(
    { sheetId: sheet.id, kind: "sheet", query: findText },
    { enabled: finding && online, retry: 1 },
  );
  const foundDocuments = api.drawingsWorkspace.linkTargets.useQuery(
    { sheetId: sheet.id, kind: "document", query: findText },
    { enabled: finding && online, retry: 1 },
  );
  const sourceId =
    sourceOverride ?? data?.metadata.currentSourceSheetId ?? sheet.id;
  const scaleMutation = api.drawingsWorkspace.setScale.useMutation();
  const source = data?.jobSheets.find((item) => item.id === sourceId) ?? {
    ...sheet,
    id: sheet.id,
    sheetId: sheet.id,
    setId: "",
    sourceFilename: sheet.sourceFilename ?? null,
  };
  const current =
    sourceId === (data?.metadata.currentSourceSheetId ?? sheet.id);
  useSnapshotSource("drawing", () => {
    const owner = data?.jobSheets.find((item) => item.id === sheet.id);
    return owner
      ? {
          jobId,
          sheetId: sheet.id,
          setId: owner.setId,
          sourceSheetId: sourceId,
          viewport: viewport.current,
          appearance,
          layers,
          selectedId,
          panel,
          ...(highlight ? { highlight: { ...highlight, text: highlight.text.slice(0, 4000) } } : {}),
          markupOpen,
          appearanceOpen,
        }
      : undefined;
  });

  const [assets, setAssets] = useState<{
    key: string;
    src: string;
    pdf: ReturnType<typeof sourcePdfPage>;
  } | null>(null);
  const resolveAssetUrl = useCallback(
    async (url: string) =>
      account?.store
          ? account.store.resolveAssetUrl(url)
          : url,
    [account?.store],
  );
  const pdf = useMemo(() => sourcePdfPage(source.imageUrl), [source.imageUrl]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    setSnapshot(null);
    setSourceOverride(entryDrawing?.sourceSheetId ?? null);
    setSelectedId(entryDrawing?.selectedId ?? null);
    setForm(null);
    setLinkChooser(null);
    setOptimistic([]);
    setFailedDrafts([]);
    setMetadataDirty(false);
    setPanel(entryPanel);
    let cancelled = false;
    void account?.store
      ?.readSnapshot<Workspace>(`workspace:${sheet.id}`)
      .then((saved) => {
        if (!cancelled) setSnapshot(saved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    sheet.id,
    account?.store,
    entryDrawing?.sourceSheetId,
    entryDrawing?.selectedId,
    entryDrawing?.panel,
  ]);
  useEffect(() => {
    if (serverData && account?.store)
      void account.store.readSnapshot<Workspace>(`workspace:${sheet.id}`).then(saved => {
        return account.store!.saveSnapshot(`workspace:${sheet.id}`, mergeDrawingWorkspaceSnapshot(serverData, saved));
      }).catch(() => undefined);
  }, [serverData, account?.store, sheet.id]);
  useEffect(() => {
    if (!metadataDirty) {
      setMetadata(data?.metadata ?? null);
      setTagDraft(data?.metadata.tags.join(", ") ?? "");
    }
  }, [data?.metadata, metadataDirty]);
  const editMetadata = (patch: Partial<DrawingMetadata>) => {
    setMetadataDirty(true);
    setMetadata((old) => (old ? { ...old, ...patch } : old));
  };
  useEffect(() => {
    let cancelled = false;
    const origin = sourcePdfPage(source.imageUrl);
    void Promise.all([
      resolveAssetUrl(source.imageUrl),
      origin ? resolveAssetUrl(origin.url) : Promise.resolve(null),
    ])
      .then(([src, url]) => {
        if (!cancelled)
          setAssets({
            key: source.imageUrl,
            src,
            pdf: url && origin ? { ...origin, url } : null,
          });
      })
      .catch(() => {
        if (!cancelled)
          setAssets({
            key: source.imageUrl,
            src: source.imageUrl,
            pdf: origin,
          });
      });
    setWords({ words: [], links: [] });
    setHighlight(entryDrawing?.sourceSheetId === source.id ? entryDrawing.highlight ?? null : null);
    selectTool("pan");
    return () => {
      cancelled = true;
    };
  }, [source.id, source.imageUrl, resolveAssetUrl, selectTool]);

  const autoHyperlinkSave = api.drawingsWorkspace.autoHyperlinkSave.useMutation();
  const saveMutation = api.drawingsWorkspace.save.useMutation();
  const archiveMutation = api.drawingsWorkspace.archive.useMutation();
  const commentMutation = api.drawingsWorkspace.comment.useMutation();
  const addMeasurementLayer = api.drawingsWorkspace.addMeasurementLayer.useMutation();
  const metadataMutation = api.drawingsWorkspace.metadata.useMutation();
  const versionMutation = api.drawingsWorkspace.setCurrentVersion.useMutation();
  const favoriteMutation = api.drawingsWorkspace.favorite.useMutation();
  const watchMutation = api.drawingsWorkspace.watch.useMutation();
  const notifications = api.drawingsWorkspace.notifications.useQuery(
    { jobId },
    {
      enabled: online && panel === "notifications",
      refetchInterval: online && panel === "notifications" ? 15_000 : false,
    },
  );
  const readNotification = api.drawingsWorkspace.readNotification.useMutation();
  const refresh = () =>
    Promise.all([
      utils.drawingsWorkspace.get.invalidate({ sheetId: sheet.id }),
      utils.drawingsWorkspace.list.invalidate({ jobId }),
    ]);
  const patchEntity = (entity: DrawingEntity) =>
    utils.drawingsWorkspace.get.setData({ sheetId: entity.sheetId, ...(!hyperlinksVisible ? { omitHyperlinks: true } : {}) }, (old) =>
      old
        ? {
            ...old,
            entities: [
              ...old.entities.filter((item) => item.id !== entity.id),
              entity,
            ],
          }
        : old,
    );
  const resolveMarkup = async (markup: DrawingMarkup): Promise<DrawingMarkup> => {
    const ref = markup.deferredLinks;
    if (!ref) return markup;
    // Explicit offline downloads (and previously opened links) keep full records.
    const saved = await account?.store?.readSnapshot<Workspace>(`workspace:${sheet.id}`);
    const cached = saved?.entities.find(entity => entity.id === ref.id && entity.revision === ref.revision);
    if (cached?.kind === "markup" && !cached.data.deferredLinks) return cached.data;
    if (!online) throw new Error("These destinations are not saved offline. Connect once to open this link, or download the drawing for offline use.");
    const entity = await utils.client.drawingsWorkspace.link.query({ sheetId: sheet.id, id: ref.id, revision: ref.revision });
    patchEntity(entity);
    return entity.data;
  };
  const [linkLoadError, setLinkLoadError] = useState<string | null>(null);
  const [linkLoadAttempt, setLinkLoadAttempt] = useState(0);
  useEffect(() => {
    if (!linkChooser?.deferredLinks) return;
    let cancelled = false;
    setLinkLoadError(null);
    void resolveMarkup(linkChooser).then(full => {
      if (!cancelled) setLinkChooser(full);
    }).catch(reason => {
      if (!cancelled) setLinkLoadError(reason instanceof Error ? reason.message : "Could not load destinations.");
    });
    return () => { cancelled = true; };
  }, [linkChooser, linkLoadAttempt, sheet.id, account?.accountKey, online]);
  const fail = (reason: unknown) => {
    const message =
      reason instanceof Error
        ? reason.message
        : "This change could not be saved. Try again.";
    setError(message);
  };
  const queued = useDrawingQueuedEdits({
    accountKey: account?.store ? account.accountKey : null,
    userId: account?.userId ?? null,
    jobId,
    sheetId: sheet.id,
    online,
    save: (input) => saveMutation.mutateAsync(input),
    onSaved: patchEntity,
    onError: fail,
  });
  const failedQueuedEdits = queued.records.filter(record =>
    record.state === "blocked" || record.state === "conflict",
  );
  const writable =
    current &&
    Boolean(data) &&
    data?.canAnnotate !== false &&
    (online || queued.ready);
  const entities = useMemo(() => {
    const queuedIds = new Set(
      queued.records.map((record) => record.preview.id),
    );
    const local = [
      ...optimistic.filter((entity) => !queuedIds.has(entity.id)),
      ...queued.records.map((record) => record.preview),
    ];
    const localIds = new Set(local.map((entity) => entity.id));
    return [
      ...(data?.entities ?? []).filter((entity) => !localIds.has(entity.id)),
      ...local,
    ];
  }, [data?.entities, optimistic, queued.records]);
  const entitiesById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const blockedEdits = useMemo(
    () =>
      new Set(
        queued.records
          .filter((record) => record.state !== "pending")
          .map((record) => record.input.id),
      ),
    [queued.records],
  );
  const selected = entitiesById.get(selectedId ?? "");
  const canEditEntity = useCallback(
    (entity: DrawingEntity) =>
      writable &&
      !blockedEdits.has(entity.id) &&
      (online ||
        (entity.authorId === data?.actor.id &&
          (entity.kind === "markup" ||
            (entity.kind === "issue" && entity.visibility === "private")))) &&
      entity.visibility !== "archived" &&
      ["markup", "issue", "view"].includes(entity.kind) &&
      Boolean(
        data &&
        (data.canManage ||
          (entity.authorId === data.actor.id &&
            (entity.visibility === "private" ||
              entity.kind === "issue" ||
              entity.kind === "markup")) ||
          (entity.kind === "issue" &&
            entity.data.assigneeId === data.actor.id)),
      ),
    [writable, blockedEdits, online, data],
  );
  const editable = useCallback(
    (entity: DrawingEntity) => canEditEntity(entity) && !(entity.kind === "markup" && entity.data.locked),
    [canEditEntity],
  );
  const toForm = (entity: DrawingEntity): DrawingSave =>
    ({
      sheetId: sheet.id,
      id: entity.id,
      expectedRevision: entity.revision,
      visibility: entity.visibility,
      kind: entity.kind,
      data: entity.data,
      ...(["version", "review"].includes(entity.kind)
        ? { expectedMetadataRevision: data?.metadata.revision ?? 0 }
        : {}),
    }) as DrawingSave;
  const resumeDestination = destinationPicker?.resume;
  useEffect(() => {
    if (
      !data ||
      !resumeDestination ||
      resumeDestination.draft.sheetId !== sheet.id
    )
      return;
    const entry = readSnapshotState(
      new URL(resumeDestination.returnTo.href, window.location.origin).hash,
    )?.drawing;
    if (entry) {
      setSourceOverride(entry.sourceSheetId);
      setLinkedAppearance(entry.appearance);
      setLayers(entry.layers);
      setNavigate({ ...entry.viewport, requestId: crypto.randomUUID() });
    }
    setSelectedId(resumeDestination.draft.id);
    setForm(resumeDestination.saved ? null : resumeDestination.draft);
    setPanel("selected");
    selectTool("select");
    destinationPicker?.consumed();
  }, [data, resumeDestination, sheet.id, destinationPicker, selectTool]);
  const deletable = (entity: DrawingEntity) =>
    editable(entity) &&
    online &&
    pending === 0 &&
    !queued.records.some((record) => record.input.id === entity.id) &&
    Boolean(data && (data.canManage || entity.authorId === data.actor.id));
  const openMarkupMenu = (id: string | null, point: { x: number; y: number }, showMenu = true) => {
    const entity = entitiesById.get(id ?? "");
    if (
      entity?.kind !== "markup" ||
      entity.visibility === "archived" ||
      sourceOf(entity) !== sourceId ||
      compareIds
    ) {
      setMarkupMenu(null);
      return;
    }
    // Select it as a click would, but keep text notes closed so the menu can offer Edit text.
    if (entity.id !== selectedId) {
      setSelectionMode("resize");
      readyNow.current = entity.id;
    }
    setSelectedId(entity.id);
    setForm(null);
    setPanel("");
    selectTool("select");
    setMarkupMenu(showMenu ? { id: entity.id, ...point } : null);
  };
  const selectAnnotation = useCallback(
    (id: string | null) => {
      if (id === "search-highlight") return;
      const entity = entities.find((item) => item.id === id);
      // Regular controls reopen text for typing; the wheel offers Edit text.
      if (
        !quickWheel && entity?.kind === "markup" &&
        entity.data.type === "text" &&
        editable(entity)
      ) {
        setSelectedId(null);
        setForm(null);
        setInlineText({ id: entity.id, data: entity.data });
        selectTool("pan");
        return;
      }
      setSelectedId(id);
      setForm(null);
      if (entity?.kind === "markup") {
        selectTool("select");
        if (id !== selectedId) setSelectionMode("resize");
        setPanel("");
      } else if (id) setPanel("selected");
      else setPanel((current) => (current === "selected" ? "" : current));
    },
    [entities, selectTool, selectedId, editable, quickWheel],
  );
  const base = (kind: DrawingSave["kind"] = "markup") => ({
    sheetId: sheet.id,
    id: crypto.randomUUID(),
    expectedRevision: 0,
    visibility:
      kind === "markup" ? defaultMarkupVisibility : ("private" as const),
  });
  const save = async (value: DrawingSave, selectAfterSave = true) => {
    if (!data) return false;
    if (value.kind === "markup" && value.data.deferredLinks) {
      try {
        const full = await resolveMarkup(value.data);
        const { deferredLinks: _deferred, ...edited } = value.data;
        value = { ...value, data: { ...edited, links: full.links, href: full.href, targetSheetId: full.targetSheetId } };
      } catch (reason) { fail(reason); return false; }
    }
    const queueable =
      isQueuedDrawingEdit(value) &&
      !data.entities.some(
        (entity) => entity.id === value.id && entity.authorId !== data.actor.id,
      );
    if (!online && (!queueable || !queued.ready)) {
      setError("Reconnect to publish or change shared drawing records.");
      return false;
    }
    const parsed = drawingSaveSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the drawing fields.");
      setForm(value);
      setPanel("selected");
      return false;
    }
    setPending((n) => n + 1);
    setError(null);
    if (queueable && queued.ready) {
      try {
        await queued.enqueue(
          parsed.data,
          data.entities.find((entity) => entity.id === value.id),
          data.actor.name,
        );
        setForm((current) => (current?.id === value.id ? null : current));
        if (selectAfterSave && activeTool.current !== "viewing") setSelectedId(value.id);
        setFailedDrafts((items) =>
          items.filter((item) => item.id !== value.id),
        );
        return true;
      } catch (reason) {
        fail(reason);
        setFailedDrafts((items) => [
          ...items.filter((item) => item.id !== value.id),
          value,
        ]);
        setForm((current) => current ?? value);
        setPanel("selected");
      } finally {
        setPending((n) => n - 1);
      }
      return false;
    }
    if (value.kind === "markup") {
      const previous = entities.find((entity) => entity.id === value.id);
      const entity: DrawingEntity = {
        id: value.id,
        sheetId: sheet.id,
        kind: "markup",
        data: value.data,
        revision: value.expectedRevision,
        visibility: value.visibility,
        authorId: previous?.authorId ?? data.actor.id,
        authorName: previous?.authorName ?? data.actor.name,
        comments: previous?.comments ?? [],
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setOptimistic((items) => [
        ...items.filter((item) => item.id !== entity.id),
        entity,
      ]);
    }
    try {
      const entity = await saveMutation.mutateAsync({
        ...parsed.data,
        expectedUserId: data.actor.id,
      });
      patchEntity(entity);
      setForm((current) => (current?.id === value.id ? null : current));
      if (selectAfterSave && activeTool.current !== "viewing") setSelectedId(entity.id);
      setFailedDrafts((items) => items.filter((item) => item.id !== value.id));
      if (value.kind === "version") setSourceOverride(null);
      await refresh();
      return true;
    } catch (reason) {
      fail(reason);
      setFailedDrafts((items) => [
        ...items.filter((item) => item.id !== value.id),
        value,
      ]);
      setForm((current) => current ?? value);
      setPanel("selected");
      return false;
    } finally {
      setPending((n) => n - 1);
      setOptimistic((items) => items.filter((item) => item.id !== value.id));
    }
  };
  const createMarkup = (markup: DrawingMarkup) => {
    const value: DrawingSave = {
      ...base(),
      kind: "markup",
      data:
        markup.type === "link"
          ? {
              ...markup,
              linkAppearance: "highlight",
              stroke: DEFAULT_HYPERLINK_COLOR,
              fill: DEFAULT_HYPERLINK_COLOR,
              opacity: DEFAULT_HYPERLINK_OPACITY,
              links: [],
            }
          : markup,
    };
    if (markup.type === "text") {
      // Type straight onto the drawing; it is saved when you are done.
      setInlineText({ id: null, data: { ...markup, text: "" } });
      setSelectedId(null);
      selectTool("pan");
      return;
    }
    if (["callout", "link"].includes(markup.type)) {
      setForm(value);
      setPanel("selected");
      selectTool("pan");
    } else void save(value);
  };
  finishInlineText.current = (selectAfterSave = true) => {
    const current = inlineText;
    if (!current) return;
    setInlineText(null);
    if (!current.data.text?.trim()) return;
    if (current.id) {
      const entity = entities.find((item) => item.id === current.id);
      if (entity && editable(entity))
        void save({ ...toForm(entity), kind: "markup", data: current.data }, selectAfterSave);
    } else
      void save({ ...base(), kind: "markup", data: current.data }, selectAfterSave);
  };
  const newRecord = (kind: "view" | "version" | "review" | "transmittal") => {
    if (!data || !online) return;
    const common = base(kind);
    const value: DrawingSave =
      kind === "view"
        ? {
            ...common,
            kind,
            data: {
              sourceSheetId: sourceId,
              name: "",
              ...viewport.current,
              center: {
                x: Math.min(1, Math.max(0, viewport.current.center.x)),
                y: Math.min(1, Math.max(0, viewport.current.center.y)),
              },
            },
          }
        : kind === "version"
          ? {
              ...common,
              visibility: "published",
              kind,
              expectedMetadataRevision: data.metadata.revision,
              data: { sourceSheetId: "", label: "", description: "" },
            }
          : kind === "review"
            ? {
                ...common,
                visibility: "published",
                kind,
                expectedMetadataRevision: data.metadata.revision,
                data: {
                  sourceSheetId: sourceId,
                  reviewerId: null,
                  status: "pending",
                  body: "",
                },
              }
            : {
                ...common,
                visibility: "published",
                kind,
                data: {
                  title: "",
                  recipient: "",
                  body: "",
                  sourceSheetIds: [sourceId],
                },
              };
    setForm(value);
    setPanel("selected");
  };
  const archive = async (entity: DrawingEntity) => {
    if (!deletable(entity)) return false;
    setPending((n) => n + 1);
    setError(null);
    try {
      patchEntity(
        await archiveMutation.mutateAsync({
          sheetId: sheet.id,
          id: entity.id,
          expectedRevision: entity.revision,
        }),
      );
      setSelectedId(null);
      setPanel("");
      await refresh();
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  };
  const saveMetadata = async (value: DrawingMetadata) => {
    if (!data?.canManage || !online) return false;
    setPending((n) => n + 1);
    setError(null);
    try {
      const next = await metadataMutation.mutateAsync({
        sheetId: sheet.id,
        expectedRevision: value.revision,
        data: drawingMetadataSchema.parse(value),
      });
      await utils.drawingsWorkspace.get.cancel({ sheetId: sheet.id });
      utils.drawingsWorkspace.get.setData({ sheetId: sheet.id, ...(!hyperlinksVisible ? { omitHyperlinks: true } : {}) }, (old) =>
        old ? { ...old, metadata: next } : old,
      );
      setMetadata(next);
      setMetadataDirty(false);
      await refresh().catch(fail);
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  };
  /** The sheet's scale is shared: setting it changes it for everyone on the job. */
  const saveScale = async (scale: DrawingMetadata["scale"]) => {
    if (!online) return false;
    setPending((n) => n + 1);
    setError(null);
    try {
      const next = await scaleMutation.mutateAsync({ sheetId: sheet.id, scale });
      await utils.drawingsWorkspace.get.cancel({ sheetId: sheet.id });
      utils.drawingsWorkspace.get.setData({ sheetId: sheet.id, ...(!hyperlinksVisible ? { omitHyperlinks: true } : {}) }, (old) =>
        old ? { ...old, metadata: next } : old,
      );
      // Unsaved sheet details are kept and now save against the new revision.
      setMetadata((old) =>
        old && metadataDirty ? { ...old, scale: next.scale, revision: next.revision } : next,
      );
      await refresh().catch(fail);
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    } finally {
      setPending((n) => n - 1);
    }
  };
  const openLinkUrl = useCallback((href: string) => {
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin &&
        (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/"))) {
      rememberHyperlinkSource(sourceRegistry?.captureSource().href ?? window.location.href, url.href);
      window.dispatchEvent(new CustomEvent(DRAWING_DESTINATION_EVENT, {detail:url.href}));
      router.push(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    } else {
      window.open(url.href, "_blank", "noopener,noreferrer");
    }
  }, [router, sourceRegistry]);
  const equipmentLinkUtils = useRef(utils);
  useEffect(() => { equipmentLinkUtils.current = utils; }, [utils]);
  const openDestination = useCallback(
    async (link: DrawingMarkupLink) => {
      let href = drawingLinkHref(link, jobId, data?.jobSheets ?? []);
      const legacy = legacyEquipmentDocumentLink(link, jobId);
      if (href && legacy && navigator.onLine) {
        try {
          const matches = await equipmentLinkUtils.current.drawingsWorkspace.equipmentMatches.fetch({
            sheetId: sheet.id, tag: legacy.tag,
            source: { kind: "document", id: legacy.documentId, name: link.label ?? "Document" },
          });
          href = matches.links[0]?.url ?? href;
        } catch { /* The original document remains available if location lookup fails. */ }
      }
      if (href) openLinkUrl(href);
      else setError("That destination is no longer available.");
    },
    [data?.jobSheets, jobId, openLinkUrl, sheet.id],
  );
  const linkChoiceArmed = useRef(false);
  const activate = useCallback(
    (markup: DrawingMarkup) => {
      const links = drawingDestinationLinks(markup, sheet.id);
      // An equipment tag always offers every place it appears in the job.
      if (markup.deferredLinks || markup.equipmentTag || links.length > 1) { linkChoiceArmed.current = false; setLinkChooser(markup); }
      else if (links[0]) void openDestination(links[0]);
      else setError("Add a destination to this hyperlink.");
    },
    [openDestination, sheet.id],
  );
  const renderLinkChoice = (link: DrawingMarkupLink, content: ReactNode, key: string, className?: string) => (
    <Button
      key={key}
      variant="outline"
      className={className}
      onPointerDown={() => { linkChoiceArmed.current = true; }}
      onClick={(event) => {
        // The opening touch's synthetic click must not pick a destination.
        // Keyboard/assistive activation has detail 0 and remains supported.
        if (event.detail > 0 && !linkChoiceArmed.current) {
          event.preventDefault();
          return;
        }
        linkChoiceArmed.current = false;
        setLinkChooser(null);
        void openDestination(link);
      }}
    >
      {content}
    </Button>
  );
  const requestedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const id = new URLSearchParams(window.location.search).get("drawingLink");
    const request = `${sheet.id}:${id ?? ""}`;
    if (!id || requestedLink.current === request) return;
    const entity = data.entities.find(
      (item) =>
        item.id === id &&
        item.kind === "markup" &&
        item.data.type === "link" &&
        item.visibility !== "archived",
    );
    if (!entity || entity.kind !== "markup") return;
    requestedLink.current = request;
    setSourceOverride(entity.data.sourceSheetId);
    // A PDF or shared address must never launch another window without a tap.
    linkChoiceArmed.current = false;
    setLinkChooser(entity.data);
  }, [data, sheet.id]);
  const activatePdfLink = useCallback(
    (link: DrawingPdfLink) => {
      if (link.url) {
        const url = drawingPdfLinkUrl(link.url);
        if (url) openLinkUrl(url);
      } else if (pdf) {
        void drawingPdfLinkPage(link).then((page) => {
          const target = page
            ? drawingPdfLinkTarget({ ...link, page }, pdf, data?.jobSheets ?? [])
            : undefined;
          if (target) {
            const href = drawingLinkHref({label:target.name,targetSheetId:target.id},jobId,data?.jobSheets??[]);
            if(href) openLinkUrl(href);
          }
          else setError("That linked page has not been added to this job.");
        });
      }
    },
    [pdf, data?.jobSheets, jobId, openLinkUrl],
  );
  const measurementLayers = [
    ...new Set([
      "General",
      ...(data?.metadata.measurementLayers ?? []),
      ...entities.flatMap((entity) =>
        entity.kind === "markup" &&
        entity.data.type === "dimension" &&
        sourceOf(entity) === sourceId &&
        entity.visibility !== "archived"
          ? measurementLayerNames(entity.data)
          : [],
      ),
    ]),
  ];
  const visible = useMemo(
    () =>
      entities.filter(
        (entity) =>
          entity.visibility !== "archived" &&
          sourceOf(entity) === sourceId &&
          (entity.kind === "markup"
            ? MEASUREMENT_TYPES.includes(entity.data.type)
              ? layers.measurements !== false
              : entity.data.type === "link" ? layers.issues : layers.markups
            : entity.kind === "issue"
              ? layers.issues
              : false) &&
          !(
            (entity.kind === "markup" || entity.kind === "issue") &&
            layers.hidden?.includes(entity.data.type)
          ) &&
          !layers.hiddenPeople?.includes(entity.authorId) &&
          (!layers.onlyMine || entity.authorId === data?.actor.id) &&
          (entity.visibility === "private" ? layers.private : layers.published),
      ),
    [
      entities,
      sourceId,
      layers.markups,
      layers.measurements,
      layers.hidden,
      layers.hiddenPeople,
      layers.onlyMine,
      data?.actor.id,
      layers.issues,
      layers.private,
      layers.published,
    ],
  );
  const highlighted = useMemo<DrawingEntity[]>(
    () =>
      highlight
        ? [
            {
              id: "search-highlight",
              sheetId: sheet.id,
              kind: "markup",
              revision: 0,
              visibility: "private",
              authorId: "",
              authorName: "",
              createdAt: "",
              updatedAt: "",
              comments: [],
              data: {
                sourceSheetId: sourceId,
                type: "rect",
                points: [
                  { x: highlight.left, y: highlight.top },
                  { x: highlight.right, y: highlight.bottom },
                ],
                stroke: "#eab308",
                fill: "#facc1544",
                width: 2,
              },
            },
          ]
        : [],
    [highlight, sheet.id, sourceId],
  );
  const viewerAnnotations = useMemo(
    () => (highlighted.length ? [...visible, ...highlighted] : visible),
    [visible, highlighted],
  );
  const canEditAnnotation = useCallback(
    (id: string) => {
      const entity = entitiesById.get(id);
      // Keep the pickup gesture guarded without delaying the menu or calling it read-only.
      const ready = entity?.kind !== "markup" || id !== selectedId || editReadyId === id;
      return Boolean(entity && editable(entity) && ready && pending === 0 && !form);
    },
    [entitiesById, editable, pending, form, selectedId, editReadyId],
  );
  const assetsReady = !account?.store || assets?.key === source.imageUrl;
  const resolved =
    assets?.key === source.imageUrl ? assets : { src: source.imageUrl, pdf };
  const comparisonSheets = new Map(
    data?.jobSheets.map((item) => [item.id, item]),
  );
  const compareFirst = comparisonSheets.get(compareIds?.first ?? "");
  const compare = comparisonSheets.get(compareIds?.second ?? "");
  const compareAdditional = (compareIds?.additional ?? []).flatMap((id) => {
    const item = comparisonSheets.get(id);
    return item ? [item] : [];
  });
  const versionLabels = new Map(
    entities.flatMap((entity) =>
      entity.kind === "version" && entity.visibility !== "archived"
        ? [[entity.data.sourceSheetId, entity.data.label] as const]
        : [],
    ),
  );
  const overlayChoices =
    data?.jobSheets.map((item) => ({
      id: item.id,
      name: item.name,
      setId: item.setId,
      setName: item.setName,
      revision:
        versionLabels.get(item.id) ??
        (item.id === sheet.id && versionLabels.size
          ? "Original drawing"
          : undefined),
    })) ?? [];

  const toolInUse = bottomMode.measuring || bottomMode.pipe ||
    modeRequest.mode !== "idle" || Boolean(inlineText) ||
    (tool !== "pan" && tool !== "viewing" && tool !== "select");

  const showSelectedMarkupActions = tool !== "pan" && tool !== "viewing" && (!quickWheel || fullscreen) && selected?.kind === "markup" &&
    selected.visibility !== "archived" && sourceOf(selected) === sourceId &&
    !form && !compareIds;

  const showMarkupControls = toolToolbarOpen && !showSelectedMarkupActions &&
    !bottomMode.measuring && !bottomMode.pipe && modeRequest.mode === "idle" &&
    Boolean(inlineText || !OTHER_TOOLS.has(tool));
  const selectedToolbarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = selectedToolbarRef.current;
    const area = bar?.closest<HTMLElement>("[data-drawing-tool-area]");
    if (!bar || !area) return;
    const update = () => {
      const clearance = Math.max(0, area.getBoundingClientRect().bottom - bar.getBoundingClientRect().top);
      area.style.setProperty("--drawing-selection-clearance", `${clearance}px`);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(bar);
    observer?.observe(area);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      area.style.removeProperty("--drawing-selection-clearance");
    };
  }, [showSelectedMarkupActions, showMarkupControls, fullscreen]);

  useEffect(() => { setToolToolbarOpen(!quickWheel); }, [toolInUse, quickWheel]);

  // Consume back at the nearest open drawing state before the host leaves a sheet.
  const dismissDrawingState =
    linkChooser ? () => setLinkChooser(null) :
    wheelStyleOpen ? () => setWheelStyleOpen(false) :
    superScalePrompt ? () => setSuperScalePrompt(false) :
    superScaleOpen ? () => setSuperScaleOpen(false) :
    superSpecMaterialOpen ? () => setSuperSpecMaterialOpen(false) :
    superEquipmentOpen ? () => setSuperEquipmentOpen(false) :
    superLabelOpen ? () => setSuperLabelOpen(false) :
    legendOpen ? () => setLegendOpen(false) :
    autoHyperlinkOpen ? () => setAutoHyperlinkOpen(false) :
    appearanceOpen ? () => setAppearanceOpen(false) :
    overlayPickerOpen ? () => setOverlayPickerOpen(false) :
    markupMenu ? () => setMarkupMenu(null) :
    form ? () => setForm(null) :
    panel ? () => setPanel("") :
    markupOpen ? () => setMarkupOpen(false) :
    inlineText ? () => finishInlineText.current(false) :
    bottomMode.measuring || bottomMode.pipe || modeRequest.mode !== "idle" ||
      (tool !== "pan" && tool !== "viewing" && tool !== "select")
      ? finishUsing :
    selectedId ? () => { setSelectedId(null); setEditReadyId(null); } :
    compareIds ? () => setCompareIds(null) :
    fileComparisonOpen ? () => setFileComparisonOpen(false) :
    null;
  useHeaderBackOverride(dismissDrawingState ? () => {
    const menu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"][data-state="open"], [role="listbox"][data-state="open"]')).at(-1);
    if (menu) {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return;
    }
    dismissDrawingState();
  } : null, { priority: 100, scope: sheet.id });

  if (query.data && boundUser && query.data.actor.id !== boundUser)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert">Your drawing account changed. Reload to continue.</p>
        <Button onClick={() => window.location.reload()}>Reload session</Button>
      </div>
    );
  // One workspace/viewer stays mounted while server tools arrive. Only real
  // server or account-scoped cached data authorizes writes and enters caches.
  const loadingTools = !data && online && !query.error;
  if (!data && (accessRevoked || (online && query.error)))
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert">{query.error?.message ?? "Could not load the drawing."}</p>
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </div>
    );
  const viewData: Workspace = data ?? {
    sheetId: sheet.id, jobId, canAnnotate: false, canUseSheetTools: false,
    canManage: false, actor: { id: boundUser ?? "", name: "" },
    members: [], jobSheets: [source], entities: [], activity: [],
    favorite: false, watching: false,
    metadata: { revision: 0, currentSourceSheetId: source.id, number: "", title: "", discipline: "", tags: [], status: "draft", scale: null },
  };
  if (
    data && sourceOverride &&
    !viewData.jobSheets.some((item) => item.id === sourceOverride)
  )
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert">
          The drawing revision used for this snapshot is unavailable.
        </p>
        <Button onClick={() => setSourceOverride(null)}>
          Open the current drawing
        </Button>
      </div>
    );
  if (
    data && compareIds &&
    [
      compareIds.first,
      compareIds.second,
      ...(compareIds.additional ?? []),
    ].some((id) => !comparisonSheets.has(id))
  )
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert">A drawing in this snapshot overlay is unavailable.</p>
        <Button onClick={() => setCompareIds(null)}>
          Open the source drawing
        </Button>
      </div>
    );

  const statusText = !data
    ? loadingTools ? "Loading drawing tools…" : "Offline drawing · annotation data was not downloaded."
    : form || failedDrafts.length || metadataDirty
      ? "Unsaved changes"
      : !current
        ? "Earlier revision · read only"
        : "";

  /** What can be done to a selected markup, shared by its bar and right-click menu. */
  const markupActions = (entity: DrawingEntity) => {
    if (entity.kind !== "markup") return [];
    const can = canEditEntity(entity);
    const locked = Boolean(entity.data.locked);
    const mode = (next: "move" | "resize") => ({
      active: selectionMode === next && tool === "select",
      run: () => {
        selectTool("select");
        setSelectionMode(next);
        setPanel("");
      },
    });
    return [
      ...(can ? [{
        key: "lock", label: locked ? "Unlock" : "Lock",
        ariaLabel: locked ? "Unlock markup" : "Lock markup",
        title: locked ? "Unlock markup" : "Lock markup",
        icon: locked ? LockKeyholeIcon : LockKeyholeOpenIcon,
        iconOnly: true, active: locked, disabled: pending > 0,
        run: () => void save({ ...toForm(entity), kind: "markup", data: { ...entity.data, locked: !locked } }),
      }] : []),
      ...(can
        ? [
            { key: "move", label: "Move", icon: MoveIcon, iconOnly: true, disabled: pending > 0 || locked, ...mode("move") },
            { key: "resize", label: "Resize", icon: ScalingIcon, iconOnly: true, disabled: pending > 0 || locked, ...mode("resize") },
            ...(entity.data.type === "dimension" && entity.data.parents
              ? [{ key: "edit", label: "Edit", icon: PencilIcon, disabled: pending > 0 || locked, run: () => editMeasurement(entity.id) }]
              : []),
            ...(entity.data.type === "text"
              ? [{
                  key: "edit-text",
                  label: "Edit text",
                  icon: TypeIcon,
                  disabled: pending > 0 || locked,
                  run: () => {
                    setInlineText({ id: entity.id, data: entity.data });
                    setSelectedId(null);
                  },
                }]
              : []),
          ]
        : []),
      { key: "details", label: "Details", icon: InfoIcon, iconOnly: true, run: () => setPanel("selected") },
      ...(can
        ? [{
            key: "delete",
            label: "Delete",
            ariaLabel: "Delete markup",
            icon: Trash2Icon,
            iconOnly: true,
            destructive: true,
            disabled: !deletable(entity),
            title: online ? "Delete" : "Reconnect to delete this markup",
            run: () => void archive(entity),
          }]
        : []),
    ] as {
      key: string;
      label: string;
      ariaLabel?: string;
      icon: LucideIcon;
      iconOnly?: boolean;
      destructive?: boolean;
      active?: boolean;
      disabled?: boolean;
      title?: string;
      run: () => void;
    }[];
  };

  // One command definition per action; each surface keeps its existing layout
  // and its existing hide-versus-disable presentation for unavailable actions.
  const sheetTools = !viewData.documentSource && viewData.canUseSheetTools;
  const sheetCommand = (label: string, Icon: LucideIcon, run: () => void, allowed = true) => ({
    label, Icon, run, disabled: !viewData.canUseSheetTools || !allowed || !online,
    barVisible: sheetTools && allowed, wheelVisible: !viewData.documentSource, wheelIcon: false,
  });
  const commands = {
    fit: { label: "Fit to screen", Icon: ScanIcon, run: () => setNavigate({ center: { x: 0.5, y: 0.5 }, zoom: 1, requestId: crypto.randomUUID() }) },
    overlay: { label: "Overlay drawings", Icon: LayersIcon, run: () => setOverlayPickerOpen(true) },
    appearance: { label: "Drawing appearance", Icon: PaletteIcon, run: () => setAppearanceOpen(true) },
    "auto-hyperlink": { label: "Auto Hyperlink", Icon: Link2Icon, run: openAutoHyperlink, disabled: !viewData.canUseSheetTools || !writable || !online, barVisible: viewData.canUseSheetTools && viewData.canAnnotate !== false },
    "legend-items": sheetCommand("Legend Items", BookOpenIcon, () => setLegendOpen(true)),
    "super-equipment": sheetCommand("Super Equipment", FileTextIcon, () => setSuperEquipmentOpen(true)),
    "super-spec-material": sheetCommand("Super Spec Material", FileTextIcon, () => setSuperSpecMaterialOpen(true), canAccessSystems),
    "super-label": sheetCommand("Super Label", FileTextIcon, () => setSuperLabelOpen(true), Boolean(viewData.canManage)),
    "super-scale": sheetCommand("Super scale", RulerIcon, () => setSuperScaleOpen(true), Boolean(viewData.canManage)),
    "document-details": { label: "Document details", Icon: FileTextIcon, run: onDocumentDetails ?? (() => undefined), barVisible: Boolean(onDocumentDetails), wheelVisible: Boolean(onDocumentDetails), wheelIcon: false },
    "close-document": { label: "Close document", Icon: XIcon, run: onClose ?? (() => undefined), barVisible: Boolean(onClose), wheelVisible: Boolean(onClose), wheelIcon: false },
  };
  type CommandId = keyof typeof commands;
  const aiCommands: CommandId[] = ["auto-hyperlink", "legend-items", "super-equipment", "super-spec-material", "super-label", "super-scale"];
  type Command = { label: string; Icon: LucideIcon; run: () => void; disabled?: boolean; barVisible?: boolean; wheelVisible?: boolean; wheelIcon?: boolean };
  const wheelCommands = (...ids: CommandId[]): DrawingArcItem[] => ids.flatMap(id => {
    const command: Command = commands[id];
    return command.wheelVisible === false ? [] : [{ id, label: command.label, icon: command.wheelIcon === false ? undefined : <command.Icon />, disabled: command.disabled, run: command.run }];
  });
  const chooseDrawingTool = (id: DrawingTool) => {
    if (id === "pan" || id === "viewing") restTool.current = "pan";
    selectTool(id === "pan" ? "viewing" : id);
    setPanel("");
    setHighlight(null);
    if (quickWheel && !OTHER_TOOLS.has(id)) setSelectedId(null);
  };
  const measureCommand = () => {
    setTool("pan");
    setSelectedId(null);
    if (quickWheel) setPanel("");
    else setMarkupOpen(false);
    requestMode(!quickWheel && bottomMode.measuring ? "idle" : "measure");
  };
  const pipeCommand = () => {
    setTool("pan");
    if (quickWheel) setSelectedId(null);
    else setMarkupOpen(false);
    requestMode("pipe");
  };
  const changeMarkupColor = (stroke: string) => setStyle(old => ({ ...old, stroke, fill: old.fill === "none" ? "none" : `${quickWheel ? stroke : stroke.slice(0, 7)}33` }));
  const changeMarkupWidth = (width: number) => setStyle(old => ({ ...old, width }));
  const toggleMarkupFill = () => setStyle(old => ({ ...old, fill: old.fill === "none" ? `${old.stroke.slice(0, 7)}33` : "none" }));
  const wheelStyle = drawingArcStyleItems({
    color: style.stroke, width: style.width,
    onColor: changeMarkupColor,
    onWidth: changeMarkupWidth,
    onCustom: () => setWheelStyleOpen(true),
  });
  const wheelItems: DrawingArcItem[] = [
    { id: "measure", label: "Measure", icon: <RulerIcon />, run: measureCommand },
    { id: "markup", label: "Markup", icon: <PenLineIcon />, disabled: !writable, children: [
      ...tools.filter(([id]) => !OTHER_TOOLS.has(id)).map(([id, label]) => {
        const Icon = MARKUP_ICONS[id] ?? PenLineIcon;
        return { id, label, icon: <Icon />, selected: tool === id, run: () => chooseDrawingTool(id) };
      }),
      { id: "style", label: "Markup style", icon: <PaletteIcon />, children: [
        ...wheelStyle,
        { id: "fill", label: "Fill", selected: style.fill !== "none", run: toggleMarkupFill },
      ] },
    ] },
    { id: "tools", label: "Tools", icon: <WrenchIcon />, children: [
      ...tools.filter(([id]) => OTHER_TOOLS.has(id)).map(([id, label]) => {
        const Icon = TOOL_ICONS[id] ?? WrenchIcon;
        return { id, label, icon: <Icon />, selected: tool === id, disabled: !writable && id !== "pan" && id !== "viewing", run: () => chooseDrawingTool(id) };
      }),
      { id: "pipe", label: "Pipe system", icon: <SplineIcon />, run: pipeCommand },
    ] },
    // Page controls sit on the main menu, one turn away.
    ...(pageNavigation ? [
      { id: "previous", label: "Previous page", icon: <ChevronLeftIcon />, disabled: pageNavigation.index <= 0, run: pageNavigation.onPrevious },
      { id: "next", label: "Next page", icon: <ChevronRightIcon />, disabled: pageNavigation.index >= pageNavigation.count - 1, run: pageNavigation.onNext },
    ] : []),
    ...wheelCommands("fit"),
    ...(onFullscreen ? [{ id: "full", label: fullscreen ? "Exit full screen" : "Full screen", icon: fullscreen ? <MinimizeIcon /> : <MaximizeIcon />, run: onFullscreen }] : []),
    ...(compareIds ? [{ id: "close-overlay", label: "Close overlay", icon: <XIcon />, run: () => setCompareIds(null) }] : []),
    ...(fileComparisonOpen ? [{ id: "close-files", label: "Close comparison", icon: <XIcon />, run: () => setFileComparisonOpen(false) }] : []),
    { id: "more", label: "More", icon: <MoreHorizontalIcon />, children: [
      { id: "ai-tools", label: "AI Tools", icon: <SparklesIcon />, children: wheelCommands(...aiCommands) },
      { id: "layers", label: "Layers", icon: <LayersIcon />, run: () => { setPanel("markups"); setForm(null); } },
      ...wheelCommands("overlay", "appearance"),
      ...panels.filter(([id]) => id !== "files" && id !== "markups" && (!viewData.documentSource || id !== "notifications")).map(([id, label]) => {
        const Icon = PANEL_ICONS[id] ?? MoreHorizontalIcon;
        return { id, label, icon: <Icon />, disabled: !data, run: () => { setPanel(id); setForm(null); } };
      }),
      { id: "visibility", label: "Default visibility", children: [
        { id: "public", label: "Public · job team", selected: defaultMarkupVisibility === "published", run: () => setDefaultMarkupVisibility("published") },
        { id: "private", label: "Private · only me", selected: defaultMarkupVisibility === "private", run: () => setDefaultMarkupVisibility("private") },
      ] },
      { id: "scroll", label: "Scroll between pages", selected: scroll, run: () => setScroll(!scroll) },
      ...wheelCommands("document-details", "close-document"),
    ] },
  ];

  const found = [
    ...(foundSheets.data?.targets ?? []).map((target) => ({ target, kind: "Drawing" })),
    ...(foundDocuments.data?.targets ?? []).map((target) => ({ target, kind: "Document" })),
  ];
  const closeFind = () => {
    setFind("");
    setFindText("");
    // A new bar closes its search field.
    setFindRound((n) => n + 1);
  };
  const openFound = (target: DrawingMarkupLink) => {
    closeFind();
    void openDestination(target);
  };
  const textHits = [...(textInSheets.data?.hits ?? []), ...(textInDocuments.data?.hits ?? [])];
  type TextHit = (typeof textHits)[number];
  const onThisPage = (hit: TextHit) =>
    hit.kind === "drawing" && !!hit.box && hit.id === sheet.id && hit.sourceSheetId === sourceId;
  const showTextHit = (hit: TextHit) => {
    const box = hit.box!;
    setHighlight({ ...box, text: hit.text });
    setNavigate({
      center: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      zoom: Math.min(10, Math.max(2, 0.35 / Math.max(box.right - box.left, box.bottom - box.top))),
      requestId: crypto.randomUUID(),
    });
  };
  const openTextHit = (hit: TextHit) => {
    closeFind();
    // Already on this page: go to the text without leaving the sheet.
    if (onThisPage(hit)) showTextHit(hit);
    else openLinkUrl(hit.url);
  };
  const findCount = textHits.length + found.length;
  const findCurrent = findCount ? Math.min(findAt, findCount - 1) : -1;
  // Text on the open page is shown as the arrows reach it; others open on tap.
  const stepFind = (delta: number) => {
    if (!findCount) return;
    const next = (findCurrent + delta + findCount) % findCount;
    setFindAt(next);
    const hit = textHits[next];
    if (hit && onThisPage(hit)) showTextHit(hit);
  };
  const findRow = (index: number) =>
    `${index === findCurrent ? "bg-accent ring-primary/40 ring-1 " : ""}hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm outline-none`;
  const textUnread =
    (textInSheets.data?.pending ?? 0) + (textInDocuments.data?.pending ?? 0);
  const barAction = (label: string, Icon: LucideIcon, run: () => void, disabled = false, pressed?: boolean, group?: string) => (
    <Button key={label} variant={pressed ? "default" : "outline"} className={BAR_BUTTON}
      disabled={disabled} aria-pressed={pressed} data-action-group={group} onClick={() => { finishTool(); run(); }}>
      <Icon aria-hidden="true" />{label}
    </Button>
  );

  const commandButtons = (...ids: CommandId[]) => ids.map(id => {
    const command: Command = commands[id];
    return command.barVisible === false ? null : barAction(command.label, command.Icon, command.run, command.disabled, undefined, aiCommands.includes(id) ? "AI Tools" : undefined);
  });

  return (
    <DrawingArcMenu enabled={quickWheel && !toolInUse} resetKey={fullscreen}
      group={{ id: "drawing", title: source.name, items: wheelItems }}>
    <DrawingArcRegistration group={selected?.kind === "markup" && !form && !compareIds ? {
      id: "selected", title: capitalize(nameOf(selected)), priority: 50,
      items: [
        ...markupActions(selected).map(action => ({ id: action.key, label: action.label, icon: <action.icon />, disabled: action.disabled, run: action.run })),
        ...(editable(selected) ? [{ id: "style", label: "Style", icon: <PaletteIcon />, run: () => setWheelStyleOpen(true) }] : []),
        { id: "deselect", label: "Deselect", icon: <XIcon />, run: () => { setSelectedId(null); finishTool(); } },
      ],
    } : null} />
    <div
      className="relative flex h-full min-h-0 flex-col"
      aria-label="Drawing workspace"
      data-snapshot-source-title={source.name}
    >
      {viewData.canUseSheetTools && legendOpen && <LegendItemsDialog sheetId={sheet.id} sourceId={sourceId} onClose={()=>setLegendOpen(false)}
        onSource={(id,box)=>{
          const target=viewData.jobSheets.find(s=>s.id===id);
          if(id===sourceId) setNavigate({center:{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2},zoom:Math.min(50,0.8/Math.max(box.right-box.left,box.bottom-box.top)),requestId:crypto.randomUUID()});
          else if(target) openLinkUrl(equipmentDrawingDestination({jobId,setId:target.setId,sheetId:id,sourceSheetId:id,name:target.name,tag:"Legend",box:{...box,text:"Legend"}}).href);
        }}/>}
      {viewData.canUseSheetTools && autoHyperlinkOpen && <AutoHyperlinkDialog key={sourceId} sheetId={sheet.id} sourceId={sourceId} jobId={jobId} setId={source.setId} name={source.name} visibility={defaultMarkupVisibility} entities={entities}
        readWords={async () => {
          if (words.words.length) return words.words;
          if (!pdf) return [];
          const index = await readDrawingText({ ...pdf, url: await resolveAssetUrl(pdf.url) });
          setWords(index);
          return index.words;
        }}
        save={async value => {
          const entity = await autoHyperlinkSave.mutateAsync({ ...value, expectedUserId: viewData.actor.id });
          patchEntity(entity);
          return entity;
        }}
        onSaved={() => { void refresh(); }} onClose={() => setAutoHyperlinkOpen(false)} />}
      <Dialog open={wheelStyleOpen} onOpenChange={setWheelStyleOpen}>
        <DialogContent layerClassName="z-[110]">
          <DialogHeader><DialogTitle>Markup style</DialogTitle><DialogDescription>Choose a colour, line width, and fill.</DialogDescription></DialogHeader>
          <MarkupStyleRow customColorLabel="Custom markup colour" data={selected?.kind === "markup" ? selected.data : { sourceSheetId: sourceId, type: "line", points: [], ...style }} disabled={pending > 0}
            onChange={patch => {
              if (selected?.kind === "markup") void save({ ...toForm(selected), kind: "markup", data: { ...selected.data, ...patch } });
              else setStyle(old => ({ ...old, ...patch }));
            }} />
        </DialogContent>
      </Dialog>
      <Dialog open={superScalePrompt} onOpenChange={setSuperScalePrompt}>
        <DialogContent layerClassName="z-[90]">
          <DialogHeader>
            <DialogTitle>Super scale — set scale first</DialogTitle>
            <DialogDescription>
              Mark two points on known grid lines and enter their real distance.
              This sets the shared reference scale for everyone. Super scale will then continue to grid matching.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSuperScalePrompt(false)}>Cancel</Button>
            <Button onClick={() => {
              setSuperScalePrompt(false);
              setCompareIds(null);
              setFileComparisonOpen(false);
              setTool("pan");
              setMarkupOpen(false);
              setSelectedId(null);
              superScaleCalibration.current = source.id;
              requestMode("calibrate");
            }}>Set scale</Button>
          </div>
        </DialogContent>
      </Dialog>
      {viewData.canUseSheetTools && superEquipmentOpen && <SuperEquipmentDialog sheetId={sheet.id} jobId={jobId} onClose={()=>setSuperEquipmentOpen(false)}/>}
      {viewData.canUseSheetTools && canAccessSystems && superSpecMaterialOpen && <SuperSpecMaterialDialog jobId={jobId} onClose={()=>setSuperSpecMaterialOpen(false)}/>}
      {viewData.canUseSheetTools && superLabelOpen && <SuperLabelDialog key={source.id} source={source} onClose={()=>setSuperLabelOpen(false)} onSaved={async()=>{await Promise.all([refresh(), utils.drawings.getSet.invalidate({setId:source.setId}), utils.drawings.listSets.invalidate({jobId})]);}}/>}
      {viewData.canUseSheetTools && superScaleOpen && (
        <SuperScaleDialog key={source.id} jobId={jobId} source={source} ownerId={sheet.id} metadata={viewData.metadata} sheets={viewData.jobSheets} onCalibrate={writable && current && !metadataDirty && pending === 0 ? () => { setSuperScaleOpen(false); setCompareIds(null); setFileComparisonOpen(false); setSuperScalePrompt(true); } : undefined} onClose={() => setSuperScaleOpen(false)} onSaved={() => { void refresh(); }} />
      )}
      {appearanceOpen && (
        <DrawingAppearanceDialog
          appearance={appearance}
          comparing={Boolean(compareIds)}
          onChange={changeAppearance}
          onClose={() => setAppearanceOpen(false)}
        />
      )}
      {overlayPickerOpen && (
        <DrawingOverlayPicker
          drawings={overlayChoices}
          initialFirstId={compareIds?.first ?? sourceId}
          initialSecondId={compareIds?.second}
          initialAdditionalIds={compareIds?.additional}
          onClose={() => setOverlayPickerOpen(false)}
          onCompare={(first, second, additional) => {
            setCompareIds({ first, second, additional });
            setFileComparisonOpen(false);
            setOverlayPickerOpen(false);
            setPanel("");
          }}
          onCompareFiles={() => {
            setCompareIds(null);
            setFileComparisonOpen(true);
            setOverlayPickerOpen(false);
            setPanel("");
          }}
        />
      )}
      <div className="absolute inset-x-0 top-0 z-30 max-h-[45dvh] overflow-y-auto">
        {error && (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive flex items-center gap-2 px-3 py-2 text-sm"
          >
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {failedDrafts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span>
              {failedDrafts.length} unsaved item(s) kept on this screen.
            </span>
            {failedDrafts.map((item) => (
              <button
                key={item.id}
                className="underline"
                onClick={() => {
                  setForm(item);
                  setPanel("selected");
                }}
              >
                Review {item.kind}
              </button>
            ))}
          </div>
        )}
        {failedQueuedEdits.length > 0 && (
          <div
            aria-label="Drawing sync errors"
            className="max-h-40 space-y-2 overflow-y-auto border-b bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            <div className="flex items-center gap-2">
              <b>Drawing edits need attention</b>
              <Button
                size="sm"
                variant="outline"
                disabled={!online}
                onClick={() => void queued.sync()}
              >
                Sync now
              </Button>
            </div>
            {failedQueuedEdits.map((record) => (
              <div
                key={record.operationId}
                className="flex flex-wrap items-center gap-2"
              >
                <span>
                  {nameOf(record.preview)} · {record.state}
                  {record.error ? ` · ${record.error}` : ""}
                </span>
                <button
                  className="underline"
                  onClick={() => {
                    setSelectedId(record.input.id);
                    setPanel("selected");
                  }}
                >
                  View draft
                </button>
                {record.state !== "syncing" && (
                  <button
                    className="underline"
                    onClick={() =>
                      void queued.discard(record.operationId).catch(fail)
                    }
                  >
                    Discard local edit
                  </button>
                )}
                {record.state === "blocked" && (
                  <button
                    className="underline"
                    disabled={!online}
                    onClick={() =>
                      void queued.retry(record.operationId).catch(fail)
                    }
                  >
                    Retry sync
                  </button>
                )}
                {record.state === "conflict" && (
                  <>
                    <button
                      className="underline"
                      disabled={!online}
                      onClick={() => void refresh().catch(fail)}
                    >
                      Refresh server version
                    </button>
                    <button
                      className="underline"
                      onClick={() =>
                        void queued
                          .enqueue(
                            {
                              ...record.input,
                              id: crypto.randomUUID(),
                              expectedRevision: 0,
                            },
                            undefined,
                            viewData.actor.name,
                          )
                          .then(() => queued.discard(record.operationId))
                          .catch(fail)
                      }
                    >
                      Keep as new private copy
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div data-drawing-tool-area className="relative flex min-h-0 flex-1">
        {toolInUse && <Button
          type="button" variant="outline" aria-label="Tool Controls" title="Tool Controls"
          aria-expanded={toolToolbarOpen}
          style={{ bottom: "calc(max(var(--drawing-toolbar-clearance, 0px), var(--drawing-selection-clearance, 0px)) + 1rem)" }}
          className="drawing-state-control drawing-corner-control absolute right-3 z-30 bg-background/60 border-border/60 hover:bg-background/80 size-10 rounded-full p-0 shadow-md backdrop-blur-sm [&_svg]:size-5"
          onClick={() => setToolToolbarOpen(open => !open)}
        ><SlidersHorizontalIcon aria-hidden="true" /></Button>}
        {toolInUse && (
          <Button
            type="button"
            variant="outline"
            aria-label="Done"
            title="Done"
            data-drawing-tool-done
            style={{ bottom: "calc(max(var(--drawing-toolbar-clearance, 0px), var(--drawing-selection-clearance, 0px)) + 1rem)" }}
            className="drawing-corner-control absolute left-3 z-30 bg-background/60 border-border/60 hover:bg-background/80 size-10 rounded-full p-0 shadow-md backdrop-blur-sm [&_svg]:size-5"
            onClick={finishUsing}
          >
            <CheckIcon aria-hidden="true" />
          </Button>
        )}
        <DrawingToolbarDock target={scrollPages ? cornerContainer : null}>
        <div className="pointer-events-none absolute top-3 left-3 z-20 flex gap-2 [&>*]:pointer-events-auto">
          {/* In full screen the viewer's own exit button takes this spot. */}
          {onFullscreen && (
            <Button
              ref={fullscreenRef}
              type="button"
              variant="outline"
              className="drawing-corner-control bg-background/60 border-border/60 hover:bg-background/80 size-10 rounded-full p-0 shadow-md backdrop-blur-sm in-data-[drawing-fullscreen=true]:invisible [&_svg]:size-5"
              aria-label="Full screen"
              title="Full screen"
              onClick={onFullscreen}
            >
              <MaximizeIcon aria-hidden="true" />
            </Button>
          )}

        </div>
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2 [&>*]:pointer-events-auto">
        {!quickWheel && entities.some(
          (e) =>
            e.kind === "issue" &&
            e.visibility !== "archived" &&
            e.data.revisionImpact &&
            e.data.status !== "closed",
        ) && (
          <Button
            className="shadow-md"
            size="sm"
            onClick={() => setPanel("impacts")}
          >
            <CircleAlertIcon className="size-4" />
            Needs review (
            {
              entities.filter(
                (e) =>
                  e.kind === "issue" &&
                  e.visibility !== "archived" &&
                  e.data.revisionImpact &&
                  e.data.status !== "closed",
              ).length
            }
            )
          </Button>
        )}
          <Button
            type="button"
            variant="outline"
            className="drawing-corner-control bg-background/60 border-border/60 hover:bg-background/80 size-10 rounded-full p-0 shadow-md backdrop-blur-sm [&_svg]:size-5"
            aria-label="Layers"
            title="Layers"
            aria-expanded={panel === "markups"}
            onClick={() => { setPanel(panel === "markups" ? "" : "markups"); setForm(null); }}
          >
            <LayersIcon aria-hidden="true" />
          </Button>
        </div>
        </DrawingToolbarDock>

        <div className="min-h-0 min-w-0 flex-1">
          {compare && compareFirst ? (
            <DrawingCompare
              initialSnapshot={
                entryDrawing ? entrySnapshot?.overlay : undefined
              }
              appearance={appearance}
              key={`${compareFirst.id}:${compareIds?.focus ? JSON.stringify(compareIds.focus) : ""}`}
              additional={compareAdditional.map((item) => ({
                ...item,
                pdf: sourcePdfPage(item.imageUrl),
                tiles: tileBase(item.imageUrl),
              }))}
              onEditDrawings={() => setOverlayPickerOpen(true)}
              toolControls={{
                toolbarHidden: !toolToolbarOpen,
                measureRequest: 0,
                pipeRequest: 0,
                modeRequest,
                onMode: setBottomMode,
                onDone: finishTool,
              }}
              resolveAssetUrl={resolveAssetUrl}
              first={{
                ...compareFirst,
                pdf: sourcePdfPage(compareFirst.imageUrl),
                tiles: tileBase(compareFirst.imageUrl),
              }}
              second={{
                ...compare,
                pdf: sourcePdfPage(compare.imageUrl),
                tiles: tileBase(compare.imageUrl),
              }}
              initialViewport={compareIds?.focus ?? viewport.current}
              onViewportChange={updateViewport}
              onClose={() => setCompareIds(null)}
            />
          ) : fileComparisonOpen ? (
            <FileComparison
              inline
              jobId={jobId}
              sheets={viewData.jobSheets}
              initialSheetId={sourceId}
              resolveAssetUrl={resolveAssetUrl}
              onOverlay={() => setOverlayPickerOpen(true)}
              onClose={() => setFileComparisonOpen(false)}
            />
          ) : !assetsReady ? (
            <div role="status" className="grid h-full place-content-center text-sm text-muted-foreground">Opening saved drawing…</div>
          ) : (
            <DrawingSheetViewer
            scrollPages={scrollPages}
            scrollStack={scrollStack}
              appearance={appearance}
              key={source.id}
              toolControls={{
                toolbarHidden: !toolToolbarOpen,
                measureRequest: 0,
                pipeRequest: 0,
                modeRequest,
                onMode: setBottomMode,
                onDone: finishTool,
                onCalibrationEnd: (saved) => {
                  const expected = superScaleCalibration.current;
                  superScaleCalibration.current = null;
                  if (saved && expected === source.id) setSuperScaleOpen(true);
                },
              }}
              initialViewport={viewport.current}
              src={resolved.src}
              placeholderSrc={online && !resolved.src.startsWith("blob:") && !resolved.pdf?.url.startsWith("blob:") ? drawingThumbnailUrl(source.imageUrl) : null}
              sourceSize={{ width: source.width, height: source.height }}
              alt={source.name}
              onPdfReady={onReady}
              pdf={resolved.pdf}
              onPdfLink={hyperlinksVisible ? activatePdfLink : undefined}
              tiles={resolved.pdf?.url.startsWith("blob:") ? null : tileBase(source.imageUrl)}
              sheetKey={source.id}
              sourceSheetId={source.id}
              resolveAssetUrl={resolveAssetUrl}
              annotations={viewerAnnotations}
              loadPipeLegendReferences={!viewData.documentSource ? () => utils.drawingsWorkspace.pipeLegendReferences.fetch({sheetId:sourceId}) : undefined}
              pipeMaterialList={{ jobId, sheetName: source.name }}
              pipeReviewAnnotations={entities.filter(entity => entity.visibility !== "archived" && !optimistic.some(draft => draft.id === entity.id))}
              measurementLayers={measurementLayers}
              onAddMeasurementLayer={async (name) => {
                if (!online || !writable) throw new Error("Connect to save a new layer.");
                await addMeasurementLayer.mutateAsync({sheetId: sheet.id, name});
                await refresh();
              }}
              editMeasurementRequest={measurementEdit}
              tool={writable || tool === "viewing" ? tool : "pan"}
              style={style}
              selectedId={selectedId}
              selectionMode={selectionMode}
              canEditAnnotation={canEditAnnotation}
              sharedScale={current ? viewData.metadata.scale : null}
              onScaleChange={
                online && writable
                  ? async (scale) => {
                      if (superScaleCalibration.current === source.id) {
                        if (!viewData.canManage || metadataDirty || pending > 0)
                          throw new Error("Finish saving sheet details before Super scale.");
                        return saveMetadata({ ...viewData.metadata, scale });
                      }
                      return saveScale(scale);
                    }
                  : undefined
              }
              onCreate={writable ? createMarkup : undefined}
              onSavePipeComponent={writable ? async (markup) => Boolean(await save({ ...base(), kind: "markup", data: markup }, false)) : undefined}
              onMeasurementComplete={(markup, existingId) => {
                setSelectedId(null);
                setPanel(current => current === "selected" ? "" : current);
                if (existingId) {
                  const entity = entities.find(item => item.id === existingId);
                  if (entity && editable(entity)) void save({ ...toForm(entity), kind: "markup", data: markup }, false);
                } else if (writable) {
                  void save({ ...base(), kind: "markup", data: markup }, false);
                }
              }}
              textEditing={
                inlineText && {
                  id: inlineText.id,
                  data: inlineText.data,
                  onChange: (next) =>
                    setInlineText((current) =>
                      current ? { ...current, data: next } : current,
                    ),
                  onCancel: () => setInlineText(null),
                  onDone: () => finishInlineText.current(),
                  onDelete: inlineText.id
                    ? () => {
                        const entity = entities.find(
                          (item) => item.id === inlineText.id,
                        );
                        setInlineText(null);
                        if (entity && deletable(entity)) void archive(entity);
                      }
                    : undefined,
                }
              }
              onPoint={
                writable
                  ? (type, point) => {
                      setForm({
                        ...base("issue"),
                        kind: "issue",
                        visibility: online ? "published" : "private",
                        data: {
                          sourceSheetId: sourceId,
                          type,
                          point,
                          title: "",
                          body: "",
                          status: "open",
                          assigneeId: null,
                          dueDate: null,
                          links: [],
                        },
                      });
                      setPanel("selected");
                      selectTool("pan");
                    }
                  : undefined
              }
              onSelect={selectAnnotation}
              onLongPressSelect={id => openMarkupMenu(id, { x: 0, y: 0 }, false)}
              onContextMenu={openMarkupMenu}
              onQuickWheelSelect={id => openMarkupMenu(id, { x: 0, y: 0 }, false)}
              onUpdate={(id, markup) => {
                const entity = entities.find((item) => item.id === id);
                if (entity && editable(entity))
                  void save({
                    ...toForm(entity),
                    kind: "markup",
                    data: markup,
                  });
              }}
              onRemoveMeasurement={async (id) => {
                const entity = entities.find((item) => item.id === id);
                return entity ? archive(entity) : false;
              }}
              canDeleteAnnotation={(id) => {
                const entity = entitiesById.get(id);
                return Boolean(entity && deletable(entity));
              }}
              onDelete={(id) => {
                const entity = entities.find((item) => item.id === id);
                if (entity && deletable(entity)) void archive(entity);
              }}
              onActivate={activate}
              navigateTo={navigate}
              onViewportChange={updateViewport}
            />
          )}
        </div>
        {showSelectedMarkupActions && (
            <div
              role="toolbar"
              aria-label="Selected markup actions"
              ref={selectedToolbarRef}
              data-drawing-chrome
              className={`absolute z-20 flex max-h-[45dvh] flex-col gap-2 overflow-y-auto px-3 py-2 ${fullscreen
                ? "bg-background/60 border-border/60 inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-w-2xl rounded-2xl border shadow-md backdrop-blur-sm"
                : "bg-card/95 inset-x-0 bottom-0 rounded-t-2xl border-t shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur"}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {capitalize(nameOf(selected))}
                </span>
                {!canEditEntity(selected) && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    Read only
                  </span>
                )}
                {markupActions(selected).map((action) =>
                  action.iconOnly ? (
                    <Button
                      key={action.key}
                      size="icon"
                      variant={action.active ? "default" : "outline"}
                      aria-pressed={action.active}
                      className={`${SELECTED_ICON} ${action.destructive ? "text-destructive hover:text-destructive" : ""}`}
                      aria-label={action.ariaLabel ?? action.label}
                      title={action.title ?? action.label}
                      disabled={action.disabled}
                      onClick={action.run}
                    >
                      <action.icon className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      key={action.key}
                      size="sm"
                      className={SELECTED_BUTTON}
                      variant={action.active ? "default" : "outline"}
                      aria-pressed={action.active}
                      disabled={action.disabled}
                      onClick={action.run}
                    >
                      {action.label}
                    </Button>
                  ),
                )}
              </div>
              {canEditEntity(selected) &&
                selected.data.type !== "text" &&
                selected.data.type !== "link" && (
                  <MarkupStyleRow
                    data={selected.data}
                    disabled={pending > 0 || Boolean(selected.data.locked)}
                    onChange={(patch) =>
                      void save({
                        ...toForm(selected),
                        kind: "markup",
                        data: { ...selected.data, ...patch },
                      })
                    }
                  />
                )}
            </div>
          )}

        {showMarkupControls && (
          <div ref={selectedToolbarRef} data-drawing-chrome role="toolbar" aria-label="Markup controls"
            className="bg-card/95 absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur">
            <MarkupStyleRow
              data={inlineText?.data ?? { sourceSheetId: sourceId, type: "line", points: [], ...style }}
              disabled={!writable}
              onChange={patch => {
                setStyle(old => ({ ...old, ...patch }));
                setInlineText(current => current ? { ...current, data: { ...current.data, ...patch } } : null);
              }}
            />
          </div>
        )}

        {markupMenu && selected?.id === markupMenu.id && !form && !compareIds && (
          <DropdownMenu
            open
            onOpenChange={(open) => {
              if (!open) setMarkupMenu(null);
            }}
          >
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden="true"
                className="pointer-events-none fixed size-0"
                style={{ left: markupMenu.x, top: markupMenu.y }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={2}
              className="w-44 rounded-xl p-1.5 shadow-xl"
              data-drawing-chrome
            >
              {markupActions(selected).map((action) => (
                <DropdownMenuItem
                  key={action.key}
                  className={`min-h-9 gap-2.5 rounded-lg ${action.destructive ? "text-destructive focus:text-destructive" : ""}`}
                  disabled={action.disabled}
                  onSelect={action.run}
                >
                  <action.icon aria-hidden="true" className="size-4" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {panel && (data || panel === "markups") && (
          <DrawingToolbarDock target={scrollPages ? cornerContainer : null}>
          <aside
            data-drawing-chrome={panel === "markups" ? undefined : true}
            aria-label="Drawing tools panel"
            className={panel === "markups"
              ? "bg-background/60 border-border/60 pointer-events-auto absolute top-16 right-3 bottom-3 z-30 flex w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border shadow-xl backdrop-blur-sm lg:w-80"
              : "bg-background pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%-1rem))] flex-col border-l shadow-xl lg:w-80"}
          >
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="font-semibold">
                {panel === "selected"
                  ? form
                    ? "Edit drawing item"
                    : "Drawing item"
                  : panels.find(([id]) => id === panel)?.[1]}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPanel("");
                  setForm(null);
                }}
              >
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              {panel === "selected" &&
                (form ? (
                  <>
                    {form.kind === "markup" && form.data.type === "link" && <EquipmentTagLinks
                      key={form.id} id={form.id} sheetId={sheet.id} points={form.data.points} savedTag={form.data.equipmentTag}
                      offline={!online} onBusy={setEquipmentBusy}
                      readWords={async () => {
                        if (words.words.length) return words.words;
                        if (!pdf) return [];
                        const index = await readDrawingText({ ...pdf, url: await resolveAssetUrl(pdf.url) });
                        setWords(index); return index.words;
                      }}
                      onAdd={(found, tag) => {
                        const existing = form.kind === "markup" ? equipmentExistingLinks(form.data) : [];
                        const known = new Set(existing.map(link => link.url ?? link.targetSheetId));
                        const additions = found.filter(link => { const key = link.url ?? link.targetSheetId; if (known.has(key)) return false; known.add(key); return true; }).slice(0, MAX_DRAWING_LINKS - existing.length);
                        setForm(current => current?.id === form.id && current.kind === "markup" ? { ...current, data: { ...current.data, equipmentTag: tag, links: [...equipmentExistingLinks(current.data), ...additions].slice(0, MAX_DRAWING_LINKS), href: undefined, targetSheetId: undefined } } : current);
                        return additions.length;
                      }}
                    />}
                    <DrawingEntityForm
                      key={form.id}
                      value={form}
                      onChange={setForm}
                      onSubmit={() => void save(form)}
                      onNavigate={
                        destinationPicker && form.kind === "markup"
                          ? () => {
                              if (
                                destinationPicker.start({
                                  jobId,
                                  draft: form,
                                  baseEntity: entities.find(
                                    (entity) => entity.id === form.id,
                                  ),
                                  authorName: viewData.actor.name,
                                })
                              ) {
                                setPanel("");
                                setForm(null);
                                setSelectedId(null);
                                selectTool("pan");
                              }
                            }
                          : undefined
                      }
                      pending={pending > 0 || equipmentBusy}
                      workspace={viewData}
                      offline={!online}
                      responseOnly={
                        form.kind === "issue" &&
                        Boolean(
                          selected &&
                          selected.authorId !== viewData.actor.id &&
                          !viewData.canManage,
                        )
                      }
                    />
                    {error &&
                      form.expectedRevision > 0 &&
                      ["markup", "issue", "view"].includes(form.kind) && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setForm({
                              ...form,
                              id: crypto.randomUUID(),
                              expectedRevision: 0,
                              visibility: "private",
                            });
                            setError(null);
                          }}
                        >
                          Save as new private copy
                        </Button>
                      )}
                  </>
                ) : selected ? (
                  <>
                    <h3 className="font-medium">{nameOf(selected)}</h3>
                    <p className="text-muted-foreground text-xs">
                      {selected.authorName} · {selected.visibility} · revision{" "}
                      {selected.revision}
                    </p>
                    {selected.kind === "issue" && (
                      <>
                        <p className="text-sm whitespace-pre-wrap">
                          {selected.data.body}
                        </p>
                        <p className="text-sm">
                          {selected.data.status.replaceAll("_", " ")} ·{" "}
                          {viewData.members.find(
                            (member) => member.id === selected.data.assigneeId,
                          )?.name ?? "Unassigned"}
                          {selected.data.dueDate
                            ? ` · Due ${selected.data.dueDate}`
                            : ""}
                        </p>
                        {selected.data.links.map((link, index) => (
                          <a
                            className="block text-sm underline"
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.label}
                          </a>
                        ))}
                      </>
                    )}
                    {selected.kind === "markup" &&
                      selected.data.type === "link" && (
                        <Button
                          variant="outline"
                          onClick={() => activate(selected.data)}
                        >
                          {drawingDestinationLinks(selected.data, sheet.id).length > 1
                            ? "Choose a link"
                            : "Open link"}
                        </Button>
                      )}
                    {editable(selected) && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (selected.kind === "markup" && selected.data.type === "dimension" && selected.data.parents) editMeasurement(selected.id);
                            else if (selected.kind === "markup" && selected.data.deferredLinks) {
                              void resolveMarkup(selected.data).then(full => setForm({ ...toForm(selected), kind: "markup", data: full })).catch(fail);
                            } else setForm(toForm(selected));
                          }}
                        >
                          Edit
                        </Button>
                        {online &&
                          !queued.records.some(
                            (record) => record.input.id === selected.id,
                          ) &&
                          (viewData.canManage ||
                            selected.authorId === viewData.actor.id) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void archive(selected)}
                            >
                              Delete
                            </Button>
                          )}
                        {online &&
                          !queued.records.some(
                            (record) => record.input.id === selected.id,
                          ) &&
                          (viewData.canManage || selected.kind === "markup") &&
                          selected.visibility === "private" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void save({
                                  ...toForm(selected),
                                  visibility: "published",
                                })
                              }
                            >
                              Publish to job
                            </Button>
                          )}
                      </div>
                    )}
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Comments</h4>
                      {selected.comments.map((item) => (
                        <div
                          key={item.id}
                          className="rounded border p-2 text-sm"
                        >
                          <b>{item.authorName}</b>
                          <p className="whitespace-pre-wrap">{item.body}</p>
                        </div>
                      ))}
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (
                            !online ||
                            !comment.trim() ||
                            queued.records.some(
                              (record) => record.input.id === selected.id,
                            )
                          )
                            return;
                          setPending((n) => n + 1);
                          void commentMutation
                            .mutateAsync({
                              sheetId: sheet.id,
                              id: selected.id,
                              expectedRevision: selected.revision,
                              body: comment.trim(),
                            })
                            .then((entity) => {
                              patchEntity(entity);
                              setComment("");
                            })
                            .catch(fail)
                            .finally(() => setPending((n) => n - 1));
                        }}
                      >
                        <textarea
                          aria-label="Comment"
                          className={drawingFieldClass}
                          rows={3}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          maxLength={12000}
                        />
                        <Button
                          size="sm"
                          disabled={
                            !online ||
                            pending > 0 ||
                            !comment.trim() ||
                            queued.records.some(
                              (record) => record.input.id === selected.id,
                            )
                          }
                        >
                          Add comment
                        </Button>
                      </form>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Select a markup or pin on the drawing.
                  </p>
                ))}
              {(panel === "markups" || panel === "issues") && (
                <>
                  {panel === "markups" && (
                      <div data-layers-list className="-mx-1 grid gap-0.5">
                        {(() => {
                          const counts = new Map<string, number>();
                          for (const entity of entities)
                            if (
                              (entity.kind === "markup" ||
                                entity.kind === "issue") &&
                              entity.visibility !== "archived" &&
                              sourceOf(entity) === sourceId
                            )
                              counts.set(
                                entity.data.type,
                                (counts.get(entity.data.type) ?? 0) + 1,
                              );
                          if (viewData.omittedHyperlinks) {
                            counts.set("link", Math.max(counts.get("link") ?? 0, viewData.omittedHyperlinks[sourceId] ?? 0));
                          }
                          const total = (types: DrawingTool[]) =>
                            types.reduce(
                              (sum, type) => sum + (counts.get(type) ?? 0),
                              0,
                            );
                          const hidden = layers.hidden ?? [];
                          const toggleType = (type: string) =>
                            setLayers((old) => ({
                              ...old,
                              hidden: old.hidden?.includes(type)
                                ? old.hidden.filter((item) => item !== type)
                                : [...(old.hidden ?? []), type],
                            }));
                          // Only what is on this sheet: an empty type has nothing to hide.
                          const present = (types: DrawingTool[]) =>
                            types.filter((type) => type === "link" || (counts.get(type) ?? 0) > 0);
                          const group = (
                            key: "markups" | "issues",
                            label: string,
                            icon: LucideIcon,
                            all: DrawingTool[],
                          ) => {
                            const types = present(all);
                            return types.length ? (
                            <details key={key} className="group/layers">
                              <summary
                                className="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg text-sm font-medium hover:bg-muted/70"
                                aria-label={`Expand ${label} Layers`}
                                onClick={event => {
                                  // The parent layer toggles visibility; only the disclosure toggles expansion.
                                  if ((event.target as HTMLElement).closest("[data-layer-row]")) event.preventDefault();
                                }}
                              >
                                <LayerRow label={label} icon={icon} count={total(types)} on={layers[key] !== false}
                                  onToggle={() => setLayers(old => ({ ...old, [key]: old[key] === false }))} />
                                <span className="grid size-11 shrink-0 place-items-center">
                                  <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open/layers:rotate-90" />
                                </span>
                              </summary>
                              {types.map(type => (
                                <ArrowColumn key={type}>
                                  <LayerRow child icon={MARKUP_ICONS[type] ?? TOOL_ICONS[type]}
                                    label={layerLabel(type)} count={counts.get(type)} on={!hidden.includes(type)}
                                    muted={layers[key] === false} onToggle={() => toggleType(type)} />
                                </ArrowColumn>
                              ))}
                            </details>
                            ) : null;
                          };
                          const empty =
                            !total(MEASUREMENT_TYPES) &&
                            !total(MARKUP_TYPES) &&
                            !total(PIN_TYPES);
                          return (
                            <>
                              {empty && (
                                <p className="text-muted-foreground px-2 py-3 text-sm">
                                  Nothing has been added to this sheet yet.
                                </p>
                              )}
                              {total(MEASUREMENT_TYPES) > 0 && (
                              <ArrowColumn>
                                <LayerRow label="Measure" icon={RulerIcon} count={total(MEASUREMENT_TYPES)}
                                  on={layers.measurements !== false}
                                  onToggle={() => setLayers(old => ({ ...old, measurements: old.measurements === false }))} />
                              </ArrowColumn>
                              )}
                              {group("markups", "Markup", PenLineIcon, MARKUP_TYPES)}
                              {group("issues", "Tools", WrenchIcon, PIN_TYPES)}
                              <PeopleLayers entities={entities} sourceId={sourceId}
                                actorId={viewData.actor.id} layers={layers} setLayers={setLayers} />
                            </>
                          );
                        })()}
                      </div>
                  )}
                  {panel === "issues" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!writable}
                        onClick={() => {
                          selectTool("issue");
                          setPanel("");
                        }}
                      >
                        Place issue
                      </Button>
                      <Button
                        size="sm"
                        disabled={!writable}
                        variant="outline"
                        onClick={() => {
                          selectTool("rfi");
                          setPanel("");
                        }}
                      >
                        Place RFI
                      </Button>
                    </div>
                  )}
                  {panel === "issues" && entities
                    .filter(
                      (entity) =>
                        entity.visibility !== "archived" &&
                        sourceOf(entity) === sourceId &&
                        entity.kind ===
                          (panel === "issues" ? "issue" : "markup"),
                    )
                    .map((entity) => (
                      <button
                        className="block w-full rounded border p-3 text-left text-sm"
                        key={entity.id}
                        onClick={() => {
                          selectAnnotation(entity.id);
                          selectTool("select");
                        }}
                      >
                        {nameOf(entity)}
                        <span className="text-muted-foreground block text-xs">
                          {entity.visibility}
                          {entity.kind === "issue"
                            ? ` · ${entity.data.status.replaceAll("_", " ")}`
                            : ""}
                        </span>
                      </button>
                    ))}
                </>
              )}
              {panel === "impacts" && (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-sm">
                    Possible impacts, not confirmed errors. Compare each item
                    before marking reviewed. Quantities and annotations are
                    unchanged.
                  </p>
                  {entities
                    .filter(
                      (entity) =>
                        entity.kind === "issue" &&
                        entity.visibility !== "archived" &&
                        entity.data.revisionImpact,
                    )
                    .map(
                      (entity) =>
                        entity.kind === "issue" && (
                          <div
                            className="space-y-2 rounded-md border p-3"
                            key={entity.id}
                          >
                            <p className="text-sm font-medium">
                              {entity.data.title}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {entity.data.body}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const impact = entity.data.revisionImpact!;
                                  setCompareIds({
                                    first: impact.previousSourceSheetId,
                                    second: entity.data.sourceSheetId,
                                    focus: {
                                      center: entity.data.point,
                                      zoom: 3,
                                    },
                                  });
                                  selectTool("pan");
                                }}
                              >
                                Compare before / after
                              </Button>
                              <Button
                                size="sm"
                                disabled={
                                  !editable(entity) ||
                                  pending > 0 ||
                                  entity.data.status === "closed"
                                }
                                onClick={() =>
                                  void save({
                                    sheetId: sheet.id,
                                    id: entity.id,
                                    kind: "issue",
                                    expectedRevision: entity.revision,
                                    visibility: entity.visibility,
                                    data: { ...entity.data, status: "closed" },
                                  })
                                }
                              >
                                {entity.data.status === "closed"
                                  ? "Reviewed"
                                  : "Mark reviewed"}
                              </Button>
                            </div>
                          </div>
                        ),
                    )}
                  {!entities.some(
                    (e) =>
                      e.kind === "issue" &&
                      e.visibility !== "archived" &&
                      e.data.revisionImpact,
                  ) && (
                    <p className="text-sm">
                      No revision impacts have been flagged.
                    </p>
                  )}
                </div>
              )}
              {panel === "views" && (
                <>
                  <Button
                    size="sm"
                    disabled={!writable || !online}
                    onClick={() => newRecord("view")}
                  >
                    Save current view
                  </Button>
                  {entities
                    .filter(
                      (entity) =>
                        entity.kind === "view" &&
                        entity.visibility !== "archived",
                    )
                    .map(
                      (entity) =>
                        entity.kind === "view" && (
                          <button
                            className="block w-full rounded border p-3 text-left text-sm"
                            key={entity.id}
                            onClick={() => {
                              setSourceOverride(entity.data.sourceSheetId);
                              setNavigate({
                                ...entity.data,
                                requestId: crypto.randomUUID(),
                              });
                              setPanel("");
                            }}
                          >
                            {entity.data.name}
                            <span className="text-muted-foreground block text-xs">
                              {entity.visibility} ·{" "}
                              {entity.data.zoom.toFixed(1)}×
                            </span>
                          </button>
                        ),
                    )}
                </>
              )}
              {panel === "details" && metadata && (
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMetadata(metadata);
                  }}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!online}
                    onClick={() =>
                      void favoriteMutation
                        .mutateAsync({
                          sheetId: sheet.id,
                          favorite: !viewData.favorite,
                        })
                        .then(() => refresh())
                        .catch(fail)
                    }
                  >
                    {viewData.favorite
                      ? "★ Favorited · remove"
                      : "☆ Add to favorites"}
                  </Button>
                  {(["number", "title", "discipline"] as const).map((key) => (
                    <DrawingField
                      key={key}
                      label={key[0]!.toUpperCase() + key.slice(1)}
                    >
                      <Input
                        disabled={!viewData.canManage || pending > 0}
                        value={metadata[key]}
                        onChange={(e) =>
                          editMetadata({ [key]: e.target.value })
                        }
                      />
                    </DrawingField>
                  ))}
                  <DrawingField label="Tags (comma separated)">
                    <Input
                      disabled={!viewData.canManage || pending > 0}
                      value={tagDraft}
                      onChange={(e) => {
                        setTagDraft(e.target.value);
                        editMetadata({
                          tags: e.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        });
                      }}
                    />
                  </DrawingField>
                  <DrawingField label="Status">
                    <select
                      disabled={!viewData.canManage || pending > 0}
                      className={drawingFieldClass}
                      value={metadata.status}
                      onChange={(e) =>
                        editMetadata({
                          status: e.target.value as DrawingMetadata["status"],
                        })
                      }
                    >
                      {["draft", "for_review", "approved", "superseded"].map(
                        (status) => (
                          <option key={status} value={status}>
                            {status.replaceAll("_", " ")}
                          </option>
                        ),
                      )}
                    </select>
                  </DrawingField>
                  {viewData.canManage && (
                    <>
                      <Button disabled={!online || pending > 0}>
                        Save details
                      </Button>
                      {metadataDirty && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setMetadataDirty(false);
                            setMetadata(viewData.metadata);
                          }}
                        >
                          Reload saved details
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const url = new URL(
                        `/jobs/${jobId}/drawings`,
                        location.origin,
                      );
                      url.searchParams.set("drawingSheet", sheet.id);
                      const owner = viewData.jobSheets.find(
                        (item) => item.id === sheet.id,
                      );
                      if (owner)
                        url.searchParams.set("drawingSet", owner.setId);
                      void navigator.clipboard
                        .writeText(url.href)
                        .then(() => notify("Drawing link copied.", "success"))
                        .catch(fail);
                    }}
                  >
                    Copy drawing link
                  </Button>
                </form>
              )}
              {panel === "history" && (
                <>
                  {viewData.canManage && (
                    <Button
                      size="sm"
                      disabled={!online}
                      onClick={() => newRecord("version")}
                    >
                      Attach uploaded revision
                    </Button>
                  )}
                  {[
                    { id: sheet.id, label: "Original drawing" },
                    ...entities.flatMap((entity) =>
                      entity.kind === "version"
                        ? [
                            {
                              id: entity.data.sourceSheetId,
                              label: entity.data.label,
                            },
                          ]
                        : [],
                    ),
                  ].map((version) => (
                    <div
                      className="space-y-2 rounded border p-3"
                      key={version.id}
                    >
                      <p className="text-sm font-medium">
                        {version.label}
                        {version.id === viewData.metadata.currentSourceSheetId
                          ? " · Current"
                          : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSourceOverride(version.id);
                            setPanel("");
                          }}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCompareIds({
                              first: sourceId,
                              second: version.id,
                            });
                            setPanel("");
                          }}
                          disabled={version.id === sourceId}
                        >
                          Compare
                        </Button>
                        {viewData.canManage &&
                          version.id !== viewData.metadata.currentSourceSheetId && (
                            <Button
                              size="sm"
                              disabled={!online || pending > 0}
                              onClick={() => {
                                setPending((n) => n + 1);
                                void versionMutation
                                  .mutateAsync({
                                    sheetId: sheet.id,
                                    sourceSheetId: version.id,
                                    expectedRevision: viewData.metadata.revision,
                                  })
                                  .then(() => {
                                    setSourceOverride(null);
                                    return refresh();
                                  })
                                  .catch(fail)
                                  .finally(() => setPending((n) => n - 1));
                              }}
                            >
                              Make current
                            </Button>
                          )}
                      </div>
                    </div>
                  ))}
                  <DrawingField label="Compare with another uploaded sheet">
                    <select
                      className={drawingFieldClass}
                      value={compareIds?.second ?? ""}
                      onChange={(e) => {
                        setCompareIds(
                          e.target.value
                            ? { first: sourceId, second: e.target.value }
                            : null,
                        );
                        setPanel("");
                      }}
                    >
                      <option value="">Choose a sheet</option>
                      {viewData.jobSheets
                        .filter((item) => item.id !== sourceId)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </DrawingField>
                  <p className="text-muted-foreground text-xs">
                    Earlier revisions retain their own annotations. Making a
                    revision current resets its approval and calibration.
                  </p>
                </>
              )}
              {panel === "reviews" && (
                <>
                  {viewData.canManage && (
                    <Button
                      size="sm"
                      disabled={!writable || !online}
                      onClick={() => newRecord("review")}
                    >
                      Request review
                    </Button>
                  )}
                  {entities
                    .filter((entity) => entity.kind === "review")
                    .map(
                      (entity) =>
                        entity.kind === "review" && (
                          <div
                            key={entity.id}
                            className="space-y-2 rounded border p-3"
                          >
                            <p className="text-sm font-semibold">
                              {entity.data.status.replaceAll("_", " ")}
                            </p>
                            <p className="text-sm whitespace-pre-wrap">
                              {entity.data.body}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {entity.authorName} ·{" "}
                              {viewData.members.find(
                                (member) =>
                                  member.id === entity.data.reviewerId,
                              )?.name ?? "Drawing manager"}
                            </p>
                            {entity.data.status === "pending" &&
                              entity.data.sourceSheetId ===
                                viewData.metadata.currentSourceSheetId &&
                              !entities.some(
                                (item) =>
                                  item.kind === "review" &&
                                  item.data.requestId === entity.id,
                              ) &&
                              (viewData.canManage ||
                                entity.data.reviewerId === viewData.actor.id) && (
                                <Button
                                  size="sm"
                                  disabled={!online}
                                  onClick={() => {
                                    setForm({
                                      ...base(),
                                      kind: "review",
                                      visibility: "published",
                                      expectedMetadataRevision:
                                        viewData.metadata.revision,
                                      data: {
                                        ...entity.data,
                                        requestId: entity.id,
                                        status: "approved",
                                        body: "",
                                      },
                                    });
                                    setPanel("selected");
                                  }}
                                >
                                  Respond to review
                                </Button>
                              )}
                          </div>
                        ),
                    )}
                </>
              )}
              {panel === "packages" && (
                <>
                  {viewData.canManage && (
                    <Button
                      size="sm"
                      disabled={!online}
                      onClick={() => newRecord("transmittal")}
                    >
                      Create transmittal
                    </Button>
                  )}
                  {entities
                    .filter((entity) => entity.kind === "transmittal")
                    .map(
                      (entity) =>
                        entity.kind === "transmittal" && (
                          <div
                            className="space-y-2 rounded border p-3"
                            key={entity.id}
                          >
                            <h3 className="font-medium">{entity.data.title}</h3>
                            <p className="text-sm">{entity.data.recipient}</p>
                            <p className="text-sm whitespace-pre-wrap">
                              {entity.data.body}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {entity.authorName} ·{" "}
                              {entity.createdAt.slice(0, 10)} ·{" "}
                              {entity.snapshots?.length ??
                                entity.data.sourceSheetIds.length}{" "}
                              sheets
                            </p>
                            <DrawingDocumentActions
                              packageMode
                              title={entity.data.title}
                              sheet={
                                entity.snapshots?.[0]
                                  ? {
                                      ...entity.snapshots[0],
                                      id: entity.snapshots[0].sheetId,
                                    }
                                  : source
                              }
                              sheets={(entity.snapshots ?? []).map((item) => ({
                                ...item,
                                id: item.sheetId,
                              }))}
                              entities={[]}
                              store={
                                viewData.documentSource ? null : account?.store
                              }
                              resolveAssetUrl={resolveAssetUrl}
                            />
                          </div>
                        ),
                    )}
                </>
              )}
              {panel === "files" && (
                <DrawingDocumentActions
                  sheet={source}
                  workspaceSheetId={sheet.id}
                  jobId={jobId}
                  sheets={viewData.jobSheets}
                  entities={visible}
                  scale={current ? viewData.metadata.scale : null}
                  store={account?.store}
                  resolveAssetUrl={resolveAssetUrl}
                  onOfflineSaved={async () => {
                    if (data) {
                      const full = online ? await utils.client.drawingsWorkspace.get.query({ sheetId: sheet.id }) : data;
                      await account?.store?.saveSnapshot(`workspace:${sheet.id}`, full);
                    }
                    await onPrepareOffline?.();
                  }}
                />
              )}
              {panel === "notifications" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!online || watchMutation.isPending}
                    onClick={() =>
                      void watchMutation
                        .mutateAsync({
                          sheetId: sheet.id,
                          watching: !viewData.watching,
                        })
                        .then(() => refresh())
                        .catch(fail)
                    }
                  >
                    {viewData.watching
                      ? "Watching this drawing · stop"
                      : "Watch this drawing"}
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    Updates, assignments, and review requests for this job.
                  </p>
                  {notifications.error && (
                    <p role="alert" className="text-destructive text-sm">
                      {notifications.error.message}
                    </p>
                  )}
                  {(notifications.data ?? []).map((item) => (
                    <button
                      key={item.id}
                      className={`block w-full rounded border p-3 text-left text-sm ${item.readAt ? "" : "border-primary bg-primary/5"}`}
                      onClick={() => {
                        void readNotification
                          .mutateAsync({ id: item.id })
                          .then(() =>
                            utils.drawingsWorkspace.notifications.invalidate({
                              jobId,
                            }),
                          )
                          .catch(fail);
                        if (item.sheetId === sheet.id) {
                          setSelectedId(item.entityId);
                          setPanel("selected");
                        } else {
                          const target = viewData.jobSheets.find(
                            (entry) => entry.id === item.sheetId,
                          );
                          if (target) onOpenSheet(target);
                        }
                      }}
                    >
                      <b>
                        {viewData.jobSheets.find(
                          (entry) => entry.id === item.sheetId,
                        )?.name ?? "Drawing"}
                      </b>
                      <span className="block">
                        {item.reason === "assignment"
                          ? "You were assigned an issue / RFI"
                          : item.reason === "review"
                            ? "Drawing review update"
                            : "Drawing updated"}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                  {!notifications.isLoading &&
                    notifications.data?.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        No drawing notifications yet.
                      </p>
                    )}
                </>
              )}
              {panel === "activity" &&
                viewData.activity.map((item) => (
                  <div key={item.id} className="border-b pb-2 text-sm">
                    <b>{item.actorName}</b> · {item.action.replaceAll("_", " ")}
                    <span className="text-muted-foreground block text-xs">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
            </div>
          </aside>
          </DrawingToolbarDock>
        )}
      </div>
      <span role="status" className="sr-only">
        {statusText}
      </span>
      {/* Shared priority bar: Measure, Markup and Tools first; all other actions on its shelf. */}
      {!quickWheel && <DrawingToolbarDock target={toolbarContainer}>
      <div
        data-drawing-chrome
        data-bottom-menu
        className="bg-card relative shrink-0 border-t px-3 pt-2 pb-0.5"
      >
        {markupOpen && (
          <>
            <button
              type="button"
              aria-label="Close markup tools"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMarkupOpen(false)}
            />
            <div
              role="dialog"
              aria-label="Markup tools"
              className="spring-up bg-card/95 absolute right-2 bottom-full left-2 z-50 mb-2 max-h-[65dvh] overflow-y-auto rounded-2xl border p-3 shadow-xl backdrop-blur"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-sm font-semibold">Markup</p>
                <button
                  type="button"
                  aria-label="Close markup"
                  className="text-muted-foreground hover:bg-accent grid size-8 place-items-center rounded-full"
                  onClick={() => setMarkupOpen(false)}
                >
                  <XIcon className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {tools
                  .filter(([id]) => !OTHER_TOOLS.has(id))
                  .map(([id, label]) => {
                    const Icon = MARKUP_ICONS[id] ?? PenLineIcon;
                    return (
                      <Button
                        key={id}
                        type="button"
                        variant={tool === id ? "default" : "ghost"}
                        className={`${MEASURE_TILE} h-14 text-center whitespace-normal`}
                        disabled={!writable}
                        aria-pressed={tool === id}
                        onClick={() => chooseDrawingTool(id)}
                      >
                        <Icon aria-hidden="true" />
                        <span className="line-clamp-2">{label}</span>
                      </Button>
                    );
                  })}
              </div>
              {writable && (
                <div className="mt-3 border-t pt-3">
                  <StyleStrip
                    color={style.stroke}
                    colorLabel="Markup colours"
                    customColorLabel="Markup color"
                    onColor={changeMarkupColor}
                    width={style.width}
                    widthLabel="Markup width"
                    onWidth={changeMarkupWidth}
                    end={
                      <button
                        type="button"
                        aria-pressed={style.fill !== "none"}
                        aria-label="Fill"
                        title="Fill"
                        className={`drawing-state-control grid size-8 shrink-0 place-items-center rounded-full transition-colors ${style.fill !== "none" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
                        onClick={toggleMarkupFill}
                      >
                        <PaintBucketIcon className="size-4" />
                      </button>
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
        {finding && (
          <div
            role="region"
            aria-label="Drawings and documents found"
            ref={findList}
            className="spring-up bg-card/95 absolute right-2 bottom-full left-2 z-50 mb-2 max-h-[50dvh] overflow-y-auto rounded-2xl border p-2 shadow-xl backdrop-blur"
          >
            {!online ? (
              <p className="text-muted-foreground p-2 text-sm">Search needs a connection.</p>
            ) : textHits.length || found.length ? (
              <ul>
                {textHits.map((hit, index) => (
                  <li key={`text:${index}`}>
                    <button
                      type="button"
                      aria-current={index === findCurrent || undefined}
                      className={findRow(index)}
                      onClick={() => openTextHit(hit)}
                    >
                      <TextSearchIcon className="size-4 shrink-0" />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">{hit.text}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {hit.name}{hit.kind === "document" ? ` · page ${hit.page}` : ""}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">{hit.kind === "drawing" ? "Drawing" : "Document"}</span>
                    </button>
                  </li>
                ))}
                {found.map(({ target, kind }, index) => (
                  <li key={`${kind}:${target.key}`}>
                    <button
                      type="button"
                      aria-current={textHits.length + index === findCurrent || undefined}
                      className={findRow(textHits.length + index)}
                      onClick={() => openFound(target)}
                    >
                      {kind === "Drawing" ? <FileTextIcon className="size-4 shrink-0" /> : <FolderIcon className="size-4 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{target.label}</span>
                      <span className="text-muted-foreground text-xs">{kind}</span>
                    </button>
                  </li>
                ))}
                {(textInSheets.isFetching || textInDocuments.isFetching) && (
                  <li className="text-muted-foreground p-2 text-sm">Searching the PDFs…</li>
                )}
              </ul>
            ) : textInSheets.isFetching || textInDocuments.isFetching || foundSheets.isPending || foundDocuments.isPending ? (
              <p className="text-muted-foreground p-2 text-sm">Searching the PDFs…</p>
            ) : (
              <p className="text-muted-foreground p-2 text-sm">No drawings or documents match.</p>
            )}
            {!!textUnread && !textInSheets.isFetching && !textInDocuments.isFetching && (
              <p className="text-muted-foreground p-2 text-xs">
                Some PDFs are still being read. Search again in a moment to include them.
              </p>
            )}
          </div>
        )}
        <PriorityActionBar
          key={findRound}
          dismissOnBack
          role="toolbar"
          aria-label="Drawing tools"
          search={{
            value: find,
            onChange: setFind,
            label: "Search drawings and documents",
            placeholder: "Search drawings and documents",
            step: { onPrevious: () => stepFind(-1), onNext: () => stepFind(1), disabled: !finding || !findCount },
          }}
          className={`mx-auto max-w-6xl gap-2 ${markupOpen ? "z-50" : ""}`}
        >
          <Button variant={scroll ? "default" : "outline"} className={BAR_BUTTON} role="switch" aria-label="Scroll between pages" aria-checked={scroll} onClick={() => setScroll(!scroll)}>
            <FileTextIcon />Scroll Between Pages
          </Button>
          {commandButtons("fit", "overlay", "appearance", "auto-hyperlink", "legend-items", "super-equipment", "super-spec-material", "super-label", "super-scale", "document-details", "close-document")}
          {panels.filter(([id]) => id !== "files" && (!viewData.documentSource || id !== "notifications")).map(([id, label]) =>
            barAction(label, PANEL_ICONS[id] ?? MoreHorizontalIcon, () => { setPanel(panel === id ? "" : id); setForm(null); }, !data && id !== "markups", panel === id)
          )}
          {tools.filter(([id]) => OTHER_TOOLS.has(id)).map(([id, label]) => {
            const active = !bottomMode.measuring && !bottomMode.pipe && (tool === id || (id === "pan" && tool === "viewing"));
            return barAction(label, TOOL_ICONS[id] ?? WrenchIcon, () => {
              if (!active || id === "pan") chooseDrawingTool(id);
            }, !writable && id !== "pan" && id !== "viewing", active, "Tools");
          })}
          {barAction("Pipe system", SplineIcon, () => {
            if (!bottomMode.pipe) pipeCommand();
          }, !writable, bottomMode.pipe, "Tools")}
          {viewData.canAnnotate !== false && <Button
            disabled={!writable}
            variant={
              markupOpen || (!OTHER_TOOLS.has(tool) && !bottomMode.measuring)
                ? "default"
                : "outline"
            }
            className={BAR_BUTTON}
            aria-label={
              !OTHER_TOOLS.has(tool) && !bottomMode.measuring ? toolLabel : "Markup"
            }
            aria-expanded={markupOpen}
            aria-pressed={!OTHER_TOOLS.has(tool) && !bottomMode.measuring}
            onClick={() => {
              if (!OTHER_TOOLS.has(tool) && !bottomMode.measuring) finishTool();
              else if (markupOpen) setMarkupOpen(false);
              else {
                finishTool();
                setMarkupOpen(true);
              }
            }}
          >
            <PenLineIcon className={!OTHER_TOOLS.has(tool) && !bottomMode.measuring ? "hidden h-5 w-5 sm:block" : "h-5 w-5"} />
            <span className="min-w-0 break-words leading-tight">
              {!OTHER_TOOLS.has(tool) && !bottomMode.measuring ? toolLabel : "Markup"}
            </span>
          </Button>}
          <Button
            variant={bottomMode.measuring ? "default" : "outline"}
            className={BAR_BUTTON}
            aria-label="Measure"
            aria-pressed={bottomMode.measuring}
            onClick={measureCommand}
          >
            <RulerIcon className="h-5 w-5" />
            Measure
          </Button>
        </PriorityActionBar>
      </div>
      </DrawingToolbarDock>}
      <Dialog
        open={Boolean(linkChooser)}
        onOpenChange={(open) => {
          if (!open) setLinkChooser(null);
        }}
      >
        <DialogContent layerClassName="z-[90]">
          <DialogHeader>
            <DialogTitle>
              {linkChooser?.text?.trim().length
                ? linkChooser.text.trim()
                : "Choose a link"}
            </DialogTitle>
            <DialogDescription>
              {linkChooser?.equipmentTag
                ? `Every place ${linkChooser.equipmentTag} appears in this job.`
                : "Choose a destination for this hyperlink."}
            </DialogDescription>
          </DialogHeader>
          {linkChooser?.deferredLinks ? (
            <div className="space-y-3">
              <p role={linkLoadError ? "alert" : "status"}>{linkLoadError ?? "Loading hyperlink destinations…"}</p>
              {linkLoadError && <Button onClick={() => setLinkLoadAttempt(n => n + 1)}>Try Again</Button>}
            </div>
          ) : linkChooser?.equipmentTag ? (
            <EquipmentTagDestinations
              sheetId={sheet.id}
              markup={linkChooser}
              saved={drawingDestinationLinks(linkChooser, sheet.id)}
              online={online}
              renderLink={renderLinkChoice}
            />
          ) : (
            <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
              {linkChooser &&
                drawingDestinationLinks(linkChooser, sheet.id).map((link, index) =>
                  renderLinkChoice(link, link.label, String(index), "h-auto min-h-12 justify-start text-left whitespace-normal"),
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </DrawingArcMenu>
  );
}
