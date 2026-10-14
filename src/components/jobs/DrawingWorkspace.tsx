"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "~/components/chat/SnapshotProvider";
import { useDrawingDestination } from "./DrawingDestinationProvider";
import { readSnapshotState } from "~/lib/snapshot-source";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { currentSnapshotState } from "~/lib/snapshot-source";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "~/components/ui/dialog";
import { drawingMarkupLinks, drawingLinkHref } from "~/lib/drawing-links";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  MoreHorizontalIcon,
  PenLineIcon,
  RulerIcon,
  WrenchIcon,
} from "lucide-react";
import { notify } from "~/components/ui/app-dialogs";
import {
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
  findDrawingText,
  readDrawingText,
  suggestSheetMetadata,
  type DrawingPdfLink,
  type DrawingTextIndex,
  type DrawingText,
} from "~/lib/drawing-text";
import { DrawingSheetViewer, type DrawingViewport } from "./DrawingSheetViewer";
import {
  DrawingEntityForm,
  DrawingField,
  drawingFieldClass,
} from "./DrawingEntityForm";
import { DrawingAppearanceDialog } from "./DrawingAppearanceDialog";
import { useDrawingAppearance } from "./useDrawingAppearance";
import { DrawingOverlayPicker } from "./DrawingOverlayPicker";
import { DrawingCompare } from "./DrawingCompare";
import { DrawingDocumentActions } from "./DrawingDocumentActions";
import { DrawingReferenceLinks } from "./DrawingReferenceLinks";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { useDrawingQueuedEdits } from "./useDrawingQueuedEdits";

/** Tools menu: everything that is not a markup type. */
const OTHER_TOOLS = new Set<DrawingTool>([
  "pan",
  "select",
  "link",
  "issue",
  "rfi",
]);
const BAR_BUTTON =
  "h-10 w-full flex-row gap-1.5 rounded-lg px-1 text-xs font-medium whitespace-normal [&_svg]:size-4";
export const tools: Array<[DrawingTool, string]> = [
  ["select", "Select"],
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
  | "issues"
  | "search"
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
  ["markups", "Markups / layers"],
  ["issues", "Issues / RFIs"],
  ["search", "Find text / PDF links"],
  ["views", "Saved views"],
  ["details", "Sheet details"],
  ["history", "Versions / compare"],
  ["reviews", "Reviews"],
  ["packages", "Transmittals"],
  ["files", "Download / offline"],
  ["activity", "Activity"],
];
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

export function DrawingWorkspace({
  jobId,
  sheet,
  onOpenSheet,
  initialViewport,
  onViewportChange,
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
  onViewportChange?: (viewport: DrawingViewport) => void;
}) {
  const snapshotTool = useSnapshot();
  const destinationPicker = useDrawingDestination();
  const [entrySnapshot] = useState(currentSnapshotState);
  const entryDrawing =
    entrySnapshot?.drawing?.jobId === jobId &&
    entrySnapshot.drawing.sheetId === sheet.id
      ? entrySnapshot.drawing
      : null;
  const account = useDrawingAccount();
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
  const query = api.drawingsWorkspace.get.useQuery(
    { sheetId: sheet.id },
    { refetchInterval: online ? 15_000 : false, retry: 1 },
  );
  // Cache keys also include the simulation session; identity comes from the
  // server-validated account, never from parsing a storage namespace.
  const boundUser = account?.userId;
  const serverData =
    query.data && (!boundUser || query.data.actor.id === boundUser)
      ? query.data
      : null;
  const data =
    serverData ??
    (!online &&
    snapshot?.sheetId === sheet.id &&
    (!boundUser || snapshot.actor.id === boundUser)
      ? snapshot
      : null);
  const [panel, setPanel] = useState<Panel>(entryDrawing?.panel ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState<DrawingTool>("pan");
  // Bottom bar: the Markup panel, and Measure / Pipe system in the viewer.
  const [markupOpen, setMarkupOpen] = useState(
    entryDrawing?.markupOpen ?? false,
  );
  const [modeRequest, setModeRequest] = useState<{
    id: number;
    mode: "idle" | "measure" | "pipe";
  }>({ id: 0, mode: "idle" });
  const requestMode = useCallback((mode: "idle" | "measure" | "pipe") => {
    setModeRequest((current) => ({ id: current.id + 1, mode }));
  }, []);
  const selectTool = useCallback(
    (next: DrawingTool) => {
      requestMode("idle");
      setTool(next);
      setMarkupOpen(false);
    },
    [requestMode],
  );
  const finishTool = () => {
    selectTool("pan");
    setSelectedId(null);
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
  const [layers, setLayers] = useState(
    entryDrawing?.layers ?? {
      markups: true,
      issues: true,
      private: true,
      published: true,
    },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [navigate, setNavigate] = useState<{
    center: { x: number; y: number };
    zoom: number;
    requestId: string;
  } | null>(null);
  const viewport = useRef<DrawingViewport>(
    initialViewport ?? { center: { x: 0.5, y: 0.5 }, zoom: 1 },
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
  const [search, setSearch] = useState(entryDrawing?.search ?? "");
  const [textBusy, setTextBusy] = useState(false);
  const textRequest = useRef(0);
  const ocrRequest = useRef<AbortController | null>(null);
  const [highlight, setHighlight] = useState<DrawingText | null>(null);
  const sourceId =
    sourceOverride ?? data?.metadata.currentSourceSheetId ?? sheet.id;
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
          search,
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
      account?.store ? account.store.resolveAssetUrl(url) : url,
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
    setPanel(entryDrawing?.panel ?? "");
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
      void account.store
        .saveSnapshot(`workspace:${sheet.id}`, serverData)
        .catch(() => undefined);
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
    textRequest.current++;
    ocrRequest.current?.abort();
    setTextBusy(false);
    setWords({ words: [], links: [] });
    setHighlight(null);
    selectTool("pan");
    const generation = textRequest;
    const abort = ocrRequest;
    return () => {
      cancelled = true;
      generation.current++;
      abort.current?.abort();
    };
  }, [source.id, source.imageUrl, resolveAssetUrl, selectTool]);

  const saveMutation = api.drawingsWorkspace.save.useMutation();
  const archiveMutation = api.drawingsWorkspace.archive.useMutation();
  const commentMutation = api.drawingsWorkspace.comment.useMutation();
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
    utils.drawingsWorkspace.get.setData({ sheetId: entity.sheetId }, (old) =>
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
  const writable = current && Boolean(data) && (online || queued.ready);
  const entities = useMemo(() => {
    const queuedIds = new Set(queued.records.map(record => record.preview.id));
    const local = [
      ...optimistic.filter(entity => !queuedIds.has(entity.id)),
      ...queued.records.map((record) => record.preview),
    ];
    const localIds = new Set(local.map(entity => entity.id));
    return [
      ...(data?.entities ?? []).filter(entity => !localIds.has(entity.id)),
      ...local,
    ];
  }, [data?.entities, optimistic, queued.records]);
  const entitiesById = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities]);
  const blockedEdits = useMemo(() => new Set(queued.records.filter(record => record.state !== "pending").map(record => record.input.id)), [queued.records]);
  const selected = entitiesById.get(selectedId ?? "");
  const editable = useCallback((entity: DrawingEntity) =>
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
        (entity.kind === "issue" && entity.data.assigneeId === data.actor.id)),
    ), [writable, blockedEdits, online, data]);
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
  const selectAnnotation = useCallback((id: string | null) => {
    if (id === "search-highlight") return;
    setSelectedId(id);
    setForm(null);
    const entity = entities.find((item) => item.id === id);
    if (entity?.kind === "markup") {
      selectTool("select");
      if (id !== selectedId) setSelectionMode("resize");
      setPanel("");
    } else if (id) setPanel("selected");
    else setPanel(current => current === "selected" ? "" : current);
  }, [entities, selectTool, selectedId]);
  const base = (kind: DrawingSave["kind"] = "markup") => ({
    sheetId: sheet.id,
    id: crypto.randomUUID(),
    expectedRevision: 0,
    visibility:
      kind === "markup" ? ("published" as const) : ("private" as const),
  });
  const save = async (value: DrawingSave) => {
    if (!data) return;
    const queueable =
      isQueuedDrawingEdit(value) &&
      !data.entities.some(
        (entity) => entity.id === value.id && entity.authorId !== data.actor.id,
      );
    if (!online && (!queueable || !queued.ready)) {
      setError("Reconnect to publish or change shared drawing records.");
      return;
    }
    const parsed = drawingSaveSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the drawing fields.");
      setForm(value);
      setPanel("selected");
      return;
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
        setSelectedId(value.id);
        setFailedDrafts((items) =>
          items.filter((item) => item.id !== value.id),
        );
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
      return;
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
      setSelectedId(entity.id);
      setFailedDrafts((items) => items.filter((item) => item.id !== value.id));
      if (value.kind === "version") setSourceOverride(null);
      await refresh();
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
              stroke: "#facc15",
              fill: "#facc15",
              opacity: 0.35,
              links: [],
            }
          : markup,
    };
    if (["text", "callout", "link"].includes(markup.type)) {
      setForm(value);
      setPanel("selected");
      selectTool("pan");
    } else void save(value);
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
    if (!deletable(entity)) return;
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
    } catch (reason) {
      fail(reason);
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
      utils.drawingsWorkspace.get.setData({ sheetId: sheet.id }, (old) =>
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
  const openDestination = useCallback((link: DrawingMarkupLink) => {
    if (link.targetSheetId) {
      const target = data?.jobSheets.find(
        (item) => item.id === link.targetSheetId,
      );
      if (target) onOpenSheet(target);
      else setError("That linked sheet is no longer available.");
    } else {
      const href = drawingLinkHref(link, jobId, data?.jobSheets ?? []);
      if (href) {
        if (destinationPicker?.active && href.startsWith("/dashboard"))
          window.location.assign(href);
        else
          window.open(
            new URL(href, location.origin).href,
            "_blank",
            "noopener,noreferrer",
          );
      } else setError("That destination is no longer available.");
    }
  }, [data?.jobSheets, onOpenSheet, jobId, destinationPicker?.active]);
  const activate = useCallback((markup: DrawingMarkup) => {
    const links = drawingMarkupLinks(markup);
    if (links.length > 1) setLinkChooser(markup);
    else if (links[0]) openDestination(links[0]);
    else setError("Add a destination to this hyperlink.");
  }, [openDestination]);
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
    setLinkChooser(entity.data);
  }, [data, sheet.id]);
  const activatePdfLink = useCallback((link: DrawingPdfLink) => {
    if (link.url) {
      const url = drawingPdfLinkUrl(link.url);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } else if (pdf) {
      const target = drawingPdfLinkTarget(link, pdf, data?.jobSheets ?? []);
      if (target) onOpenSheet(target);
      else setError("That linked page has not been added to this job.");
    }
  }, [pdf, data?.jobSheets, onOpenSheet]);
  const readText = async (ocr = false) => {
    const request = ++textRequest.current;
    ocrRequest.current?.abort();
    const controller = new AbortController();
    ocrRequest.current = controller;
    setTextBusy(true);
    setError(null);
    try {
      if (ocr) {
        const response = await fetch("/api/drawings/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId: sourceId }),
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          words?: DrawingText[];
          error?: string;
        };
        if (!response.ok || !result.words)
          throw Error(result.error ?? "Text recognition failed.");
        if (request === textRequest.current)
          setWords((previous) => ({ ...previous, words: result.words! }));
      } else if (pdf) {
        const index = await readDrawingText({
          ...pdf,
          url: await resolveAssetUrl(pdf.url),
        });
        if (request === textRequest.current) setWords(index);
      } else
        throw Error("This sheet has no PDF text. Use Recognize scanned text.");
    } catch (reason) {
      if (request === textRequest.current && !controller.signal.aborted)
        fail(reason);
    } finally {
      if (request === textRequest.current) setTextBusy(false);
    }
  };
  const showText = (word: DrawingText) => {
    setHighlight(word);
    setNavigate({
      center: {
        x: (word.left + word.right) / 2,
        y: (word.top + word.bottom) / 2,
      },
      zoom: 8,
      requestId: crypto.randomUUID(),
    });
    setPanel("");
  };
  const [hiddenMeasurementLayers, setHiddenMeasurementLayers] = useState<string[]>([]);
  const measurementLayers = [...new Set(["General", ...entities.flatMap(entity => entity.kind === "markup" && entity.data.type === "dimension" && sourceOf(entity) === sourceId && entity.visibility !== "archived" ? [entity.data.layer ?? "General"] : [])])];
  const visible = useMemo(() => entities.filter(
    (entity) =>
      entity.visibility !== "archived" &&
      sourceOf(entity) === sourceId &&
      !(entity.kind === "markup" && entity.data.type === "dimension" && hiddenMeasurementLayers.includes(entity.data.layer ?? "General")) &&
      (entity.kind === "markup"
        ? layers.markups
        : entity.kind === "issue"
          ? layers.issues
          : false) &&
      (entity.visibility === "private" ? layers.private : layers.published),
  ), [entities, sourceId, hiddenMeasurementLayers, layers.markups, layers.issues, layers.private, layers.published]);
  const highlighted = useMemo<DrawingEntity[]>(() => highlight
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
    : [], [highlight, sheet.id, sourceId]);
  const viewerAnnotations = useMemo(() => highlighted.length ? [...visible, ...highlighted] : visible, [visible, highlighted]);
  const canEditAnnotation = useCallback((id: string) => {
    const entity = entitiesById.get(id);
    return Boolean(entity && editable(entity) && pending === 0 && !form);
  }, [entitiesById, editable, pending, form]);
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
      revision:
        versionLabels.get(item.id) ??
        (item.id === sheet.id && versionLabels.size
          ? "Original drawing"
          : undefined),
    })) ?? [];

  if (query.data && boundUser && query.data.actor.id !== boundUser)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p role="alert">Your drawing account changed. Reload to continue.</p>
        <Button onClick={() => window.location.reload()}>Reload session</Button>
      </div>
    );
  if (!data && !online)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p className="bg-background p-2 text-xs">
          Offline drawing · annotation data was not downloaded.
        </p>
        <div className="min-h-0 flex-1">
          <DrawingSheetViewer
            appearance={appearance}
            src={resolved.src}
            alt={source.name}
            pdf={resolved.pdf}
            tiles={tileBase(source.imageUrl)}
            sheetKey={source.id}
            initialViewport={viewport.current}
            onViewportChange={updateViewport}
            resolveAssetUrl={resolveAssetUrl}
          />
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="grid h-full place-content-center gap-3 p-6 text-center">
        <p>{query.error ? query.error.message : "Loading drawing tools…"}</p>
        {query.error && (
          <Button onClick={() => void query.refetch()}>Try again</Button>
        )}
      </div>
    );
  if (
    sourceOverride &&
    !data.jobSheets.some((item) => item.id === sourceOverride)
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
    compareIds &&
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

  const statusText = pending
    ? "Saving…"
    : form || failedDrafts.length || metadataDirty
      ? "Unsaved changes"
      : queued.records.length
        ? `${queued.records.length} edit(s) saved on device`
        : !online
          ? "Offline · markups saved on device"
          : !current
            ? "Earlier revision · read only"
            : "Saved";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      aria-label="Drawing workspace"
      data-snapshot-source-title={source.name}
    >
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
      {queued.records.length > 0 && (
        <div
          aria-label="Offline drawing edits"
          className="max-h-40 space-y-2 overflow-y-auto border-b bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <div className="flex items-center gap-2">
            <b>{queued.records.length} edit(s) saved on this device</b>
            <Button
              size="sm"
              variant="outline"
              disabled={!online}
              onClick={() => void queued.sync()}
            >
              Sync now
            </Button>
          </div>
          {queued.records.map((record) => (
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
                          data.actor.name,
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
      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {compare && compareFirst ? (
            <DrawingCompare
              initialSnapshot={
                entryDrawing ? entrySnapshot?.overlay : undefined
              }
              appearance={appearance}
              key={compareFirst.id}
              additional={compareAdditional.map((item) => ({
                ...item,
                pdf: sourcePdfPage(item.imageUrl),
                tiles: tileBase(item.imageUrl),
              }))}
              onEditDrawings={() => setOverlayPickerOpen(true)}
              toolControls={{
                measureRequest: 0,
                pipeRequest: 0,
                modeRequest,
                onMode: setBottomMode,
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
              initialViewport={viewport.current}
              onViewportChange={updateViewport}
              onClose={() => setCompareIds(null)}
            />
          ) : (
            <DrawingSheetViewer
              appearance={appearance}
              key={source.id}
              toolControls={{
                measureRequest: 0,
                pipeRequest: 0,
                modeRequest,
                onMode: setBottomMode,
              }}
              initialViewport={viewport.current}
              src={resolved.src}
              alt={source.name}
              pdf={resolved.pdf}
              onPdfLink={activatePdfLink}
              tiles={tileBase(source.imageUrl)}
              sheetKey={source.id}
              sourceSheetId={source.id}
              resolveAssetUrl={resolveAssetUrl}
              annotations={viewerAnnotations}
              measurementLayers={measurementLayers}
              tool={writable ? tool : "pan"}
              style={style}
              selectedId={selectedId}
              selectionMode={selectionMode}
              canEditAnnotation={canEditAnnotation}
              sharedScale={current ? data.metadata.scale : undefined}
              onScaleChange={
                data.canManage && online && writable
                  ? (scale) => {
                      if (metadataDirty) {
                        setError(
                          "Save or reload your sheet details before changing calibration.",
                        );
                        throw new Error(
                          "Save or reload your sheet details before changing calibration.",
                        );
                      }
                      if (pending > 0)
                        throw new Error(
                          "Wait for the current save, then try again.",
                        );
                      return saveMetadata({ ...data.metadata, scale });
                    }
                  : undefined
              }
              onCreate={writable ? createMarkup : undefined}
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
              onUpdate={(id, markup) => {
                const entity = entities.find((item) => item.id === id);
                if (entity && editable(entity))
                  void save({
                    ...toForm(entity),
                    kind: "markup",
                    data: markup,
                  });
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
      {selected?.kind === "markup" &&
        selected.visibility !== "archived" &&
        sourceOf(selected) === sourceId &&
        !form &&
        !compareIds && (
          <div
            role="toolbar"
            aria-label="Selected markup actions"
            data-drawing-chrome
            className="bg-background absolute inset-x-0 bottom-0 z-20 flex max-h-[45dvh] flex-wrap items-center gap-2 overflow-y-auto border-t px-2 py-2"
          >
            <span className="max-w-32 truncate text-sm font-medium">
              {nameOf(selected)}
            </span>
            {editable(selected) ? (
              <>
                <Button
                  size="sm"
                  variant={
                    selectionMode === "move" && tool === "select"
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={selectionMode === "move" && tool === "select"}
                  disabled={pending > 0}
                  onClick={() => {
                    selectTool("select");
                    setSelectionMode("move");
                    setPanel("");
                  }}
                >
                  Move
                </Button>
                <Button
                  size="sm"
                  variant={
                    selectionMode === "resize" && tool === "select"
                      ? "default"
                      : "outline"
                  }
                  aria-pressed={selectionMode === "resize" && tool === "select"}
                  disabled={pending > 0}
                  onClick={() => {
                    selectTool("select");
                    setSelectionMode("resize");
                    setPanel("");
                  }}
                >
                  Resize
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Delete markup"
                  disabled={!deletable(selected)}
                  title={
                    !online ? "Reconnect to delete this markup" : undefined
                  }
                  onClick={() => void archive(selected)}
                >
                  Delete
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground text-xs">Read only</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPanel("selected")}
            >
              Details
            </Button>
            {editable(selected) && tool === "select" && (
              <span className="text-muted-foreground min-h-8 basis-full text-xs sm:min-h-0 sm:basis-auto">
                {selectionMode === "resize"
                  ? "Drag a handle to resize, or drag the markup to move."
                  : "Drag the markup to move it."}
              </span>
            )}
            {editable(selected) && !online && (
              <span className="text-muted-foreground basis-full text-xs">
                Reconnect to delete this markup.
              </span>
            )}
          </div>
        )}

        {panel && (
          <aside
            data-drawing-chrome
            aria-label="Drawing tools panel"
            className="bg-background absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%-1rem))] flex-col border-l shadow-xl lg:w-80"
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
                                  authorName: data.actor.name,
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
                      pending={pending > 0}
                      workspace={data}
                      offline={!online}
                      responseOnly={
                        form.kind === "issue" &&
                        Boolean(
                          selected &&
                          selected.authorId !== data.actor.id &&
                          !data.canManage,
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
                          {data.members.find(
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
                          {drawingMarkupLinks(selected.data).length > 1
                            ? "Choose a link"
                            : "Open link"}
                        </Button>
                      )}
                    {editable(selected) && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => setForm(toForm(selected))}
                        >
                          Edit
                        </Button>
                        {online &&
                          !queued.records.some(
                            (record) => record.input.id === selected.id,
                          ) &&
                          (data.canManage ||
                            selected.authorId === data.actor.id) && (
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
                          (data.canManage || selected.kind === "markup") &&
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
                    <fieldset className="grid grid-cols-2 gap-2 rounded border p-2">
                      <legend className="px-1 text-xs">Visible layers</legend>
                      {measurementLayers.map(name => <label key={`measurement:${name}`} className="flex gap-2 text-sm">
                        <input type="checkbox" checked={!hiddenMeasurementLayers.includes(name)} onChange={event => setHiddenMeasurementLayers(old => event.target.checked ? old.filter(item => item !== name) : [...old, name])} />
                        {name} measurements
                      </label>)}
                      {Object.entries(layers).map(([key, value]) => (
                        <label
                          className="flex gap-2 text-sm capitalize"
                          key={key}
                        >
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) =>
                              setLayers((old) => ({
                                ...old,
                                [key]: e.target.checked,
                              }))
                            }
                          />
                          {key}
                        </label>
                      ))}
                    </fieldset>
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
                  {entities
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
              {panel === "search" && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={textBusy}
                      onClick={() => void readText()}
                    >
                      Read PDF text
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={textBusy || !online}
                      onClick={() => void readText(true)}
                    >
                      {textBusy ? "Reading…" : "Recognize scanned text"}
                    </Button>
                  </div>
                  <Input
                    aria-label="Search drawing text"
                    placeholder="Room, detail, note…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    {words.words.length} text entries. Scanned recognition may
                    need corrections.
                  </p>
                  {findDrawingText(words.words, search).map((word, index) => (
                    <button
                      key={index}
                      className="block w-full rounded border p-2 text-left text-sm"
                      onClick={() => showText(word)}
                    >
                      {word.text}
                    </button>
                  ))}
                  {data.canManage && words.words.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const suggestion = suggestSheetMetadata(words.words);
                        editMetadata(
                          Object.fromEntries(
                            Object.entries(suggestion).filter(
                              ([, value]) => value,
                            ),
                          ),
                        );
                        setPanel("details");
                      }}
                    >
                      Suggest title block fields
                    </Button>
                  )}
                  {words.links.length > 0 && (
                    <h3 className="text-sm font-medium">
                      Links already in this PDF
                    </h3>
                  )}
                  {words.links.map((link, index) => (
                    <button
                      key={index}
                      className="block w-full rounded border p-2 text-left text-sm"
                      onClick={() => activatePdfLink(link)}
                    >
                      {link.url ?? `PDF page ${link.page}`}
                    </button>
                  ))}
                </>
              )}
              {panel === "search" && (
                <DrawingReferenceLinks
                  workspace={data}
                  sourceSheetId={sourceId}
                  words={words.words}
                  online={online}
                />
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
                          favorite: !data.favorite,
                        })
                        .then(() => refresh())
                        .catch(fail)
                    }
                  >
                    {data.favorite
                      ? "★ Favorited · remove"
                      : "☆ Add to favorites"}
                  </Button>
                  {(["number", "title", "discipline"] as const).map((key) => (
                    <DrawingField
                      key={key}
                      label={key[0]!.toUpperCase() + key.slice(1)}
                    >
                      <Input
                        disabled={!data.canManage || pending > 0}
                        value={metadata[key]}
                        onChange={(e) =>
                          editMetadata({ [key]: e.target.value })
                        }
                      />
                    </DrawingField>
                  ))}
                  <DrawingField label="Tags (comma separated)">
                    <Input
                      disabled={!data.canManage || pending > 0}
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
                      disabled={!data.canManage || pending > 0}
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
                  {data.canManage && (
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
                            setMetadata(data.metadata);
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
                        `/dashboard/jobs/${jobId}/drawings`,
                        location.origin,
                      );
                      url.searchParams.set("drawingSheet", sheet.id);
                      const owner = data.jobSheets.find(
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
                  {data.canManage && (
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
                        {version.id === data.metadata.currentSourceSheetId
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
                        {data.canManage &&
                          version.id !== data.metadata.currentSourceSheetId && (
                            <Button
                              size="sm"
                              disabled={!online || pending > 0}
                              onClick={() => {
                                setPending((n) => n + 1);
                                void versionMutation
                                  .mutateAsync({
                                    sheetId: sheet.id,
                                    sourceSheetId: version.id,
                                    expectedRevision: data.metadata.revision,
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
                      {data.jobSheets
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
                  {data.canManage && (
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
                              {data.members.find(
                                (member) =>
                                  member.id === entity.data.reviewerId,
                              )?.name ?? "Drawing manager"}
                            </p>
                            {entity.data.status === "pending" &&
                              entity.data.sourceSheetId ===
                                data.metadata.currentSourceSheetId &&
                              !entities.some(
                                (item) =>
                                  item.kind === "review" &&
                                  item.data.requestId === entity.id,
                              ) &&
                              (data.canManage ||
                                entity.data.reviewerId === data.actor.id) && (
                                <Button
                                  size="sm"
                                  disabled={!online}
                                  onClick={() => {
                                    setForm({
                                      ...base(),
                                      kind: "review",
                                      visibility: "published",
                                      expectedMetadataRevision:
                                        data.metadata.revision,
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
                  {data.canManage && (
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
                              store={account?.store}
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
                  jobId={jobId}
                  sheets={data.jobSheets}
                  entities={visible}
                  scale={current ? data.metadata.scale : null}
                  store={account?.store}
                  resolveAssetUrl={resolveAssetUrl}
                  onOfflineSaved={() =>
                    account?.store?.saveSnapshot(
                      `workspace:${sheet.id}`,
                      data,
                    ) ?? Promise.resolve()
                  }
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
                          watching: !data.watching,
                        })
                        .then(() => refresh())
                        .catch(fail)
                    }
                  >
                    {data.watching
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
                          const target = data.jobSheets.find(
                            (entry) => entry.id === item.sheetId,
                          );
                          if (target) onOpenSheet(target);
                        }
                      }}
                    >
                      <b>
                        {data.jobSheets.find(
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
                data.activity.map((item) => (
                  <div key={item.id} className="border-b pb-2 text-sm">
                    <b>{item.actorName}</b> · {item.action.replaceAll("_", " ")}
                    <span className="text-muted-foreground block text-xs">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
            </div>
          </aside>
        )}
      </div>
      <span role="status" className="sr-only">
        {statusText}
      </span>
      {/* Bottom bar: More, Tools, Markup, Measure (Previous / Next sit
          below it in the Drawings screen). */}
      <div
        data-drawing-chrome
        className="bg-card relative shrink-0 border-t px-3 pt-1 pb-0.5"
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
              className="bg-card absolute right-2 bottom-full left-2 z-50 mb-2 max-h-[60dvh] overflow-y-auto rounded-xl border p-3 shadow-lg"
            >
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {tools
                  .filter(([id]) => !OTHER_TOOLS.has(id))
                  .map(([id, label]) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={tool === id ? "default" : "outline"}
                      className="h-9 rounded-lg px-1 text-xs whitespace-normal"
                      disabled={!writable}
                      aria-pressed={tool === id}
                      onClick={() => {
                        selectTool(id);
                        setPanel("");
                        setHighlight(null);
                        setMarkupOpen(false);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
              </div>
              {writable && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <input
                    aria-label="Markup color"
                    type="color"
                    value={style.stroke.slice(0, 7)}
                    className="h-9 w-10 rounded border"
                    onChange={(e) =>
                      setStyle((old) => ({ ...old, stroke: e.target.value }))
                    }
                  />
                  <select
                    aria-label="Markup width"
                    className="bg-background rounded border p-2 text-sm"
                    value={style.width}
                    onChange={(e) =>
                      setStyle((old) => ({
                        ...old,
                        width: Number(e.target.value),
                      }))
                    }
                  >
                    {[1, 2, 4, 8].map((width) => (
                      <option key={width} value={width}>
                        {width}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={style.fill !== "none"}
                      onChange={(e) =>
                        setStyle((old) => ({
                          ...old,
                          fill: e.target.checked
                            ? `${old.stroke.slice(0, 7)}33`
                            : "none",
                        }))
                      }
                    />
                    Fill
                  </label>
                </div>
              )}
            </div>
          </>
        )}
        <div
          role="toolbar"
          aria-label="Drawing tools"
          className={`relative mx-auto grid max-w-6xl grid-cols-4 gap-2 ${markupOpen ? "z-50" : ""}`}
        >
          {panel && panel !== "selected" ? (
            <Button
              variant="default"
              className={BAR_BUTTON}
              aria-label="Done"
              onClick={() => {
                setPanel("");
                setForm(null);
              }}
            >
              <MoreHorizontalIcon className="h-5 w-5" />
              Done
            </Button>
          ) : (
            <DropdownMenu
              modal={false}
              open={moreOpen}
              onOpenChange={(open) => {
                setMoreOpen(open);
                if (open) finishTool();
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant={moreOpen ? "default" : "outline"}
                  className={BAR_BUTTON}
                  aria-label={moreOpen ? "Done" : "More"}
                >
                  <MoreHorizontalIcon className="h-5 w-5" />
                  {moreOpen ? "Done" : "More"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="max-h-[70dvh] min-w-60 overflow-y-auto"
              >
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  {statusText}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => snapshotTool?.start()}>
                  Snapshot
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setNavigate({
                      center: { x: 0.5, y: 0.5 },
                      zoom: 1,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  Fit to screen
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={overlayChoices.length < 2}
                  onSelect={() => setOverlayPickerOpen(true)}
                >
                  Overlay drawings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAppearanceOpen(true)}>
                  Drawing appearance
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {panels.map(([id, label]) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => {
                      setMoreOpen(false);
                      setPanel(id);
                      setForm(null);
                    }}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {bottomMode.pipe ||
          (!bottomMode.measuring &&
            (tool !== "pan" && OTHER_TOOLS.has(tool))) ? (
            <Button
              variant="default"
              className={BAR_BUTTON}
              aria-label="Done"
              onClick={finishTool}
            >
              <WrenchIcon className="h-5 w-5" />
              Done
            </Button>
          ) : (
            <DropdownMenu
              modal={false}
              open={toolsOpen}
              onOpenChange={(open) => {
                setToolsOpen(open);
                if (open) finishTool();
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant={toolsOpen ? "default" : "outline"}
                  className={BAR_BUTTON}
                  aria-label={toolsOpen ? "Done" : "Tools"}
                >
                  <WrenchIcon className="h-5 w-5" />
                  {toolsOpen ? "Done" : "Tools"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="center"
                className="min-w-52"
              >
                <DropdownMenuRadioGroup
                  value={
                    bottomMode.pipe ||
                    bottomMode.measuring ||
                    tool === "pan"
                      ? ""
                      : writable
                        ? tool
                        : "pan"
                  }
                  onValueChange={(value) => {
                    selectTool(value as DrawingTool);
                    setPanel("");
                    setHighlight(null);
                  }}
                >
                  {tools
                    .filter(([id]) => OTHER_TOOLS.has(id))
                    .map(([id, label]) => (
                      <DropdownMenuRadioItem
                        key={id}
                        value={id}
                        disabled={!writable && id !== "pan"}
                      >
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={bottomMode.pipe}
                  onCheckedChange={() => {
                    setTool("pan");
                    setMarkupOpen(false);
                    requestMode("pipe");
                  }}
                >
                  Pipe system
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant={
              markupOpen || (!OTHER_TOOLS.has(tool) && !bottomMode.measuring)
                ? "default"
                : "outline"
            }
            className={BAR_BUTTON}
            aria-label={
              markupOpen || (!OTHER_TOOLS.has(tool) && !bottomMode.measuring)
                ? "Done"
                : "Markup"
            }
            aria-expanded={markupOpen}
            onClick={() => {
              if (!OTHER_TOOLS.has(tool) && !bottomMode.measuring) finishTool();
              else if (markupOpen) setMarkupOpen(false);
              else {
                finishTool();
                setMarkupOpen(true);
              }
            }}
          >
            <PenLineIcon className="h-5 w-5" />
            <span className="flex items-center gap-0.5">
              {markupOpen || (!OTHER_TOOLS.has(tool) && !bottomMode.measuring)
                ? "Done"
                : "Markup"}
            </span>
          </Button>
          <Button
            variant={bottomMode.measuring ? "default" : "outline"}
            className={BAR_BUTTON}
            aria-label={bottomMode.measuring ? "Done" : "Measure"}
            aria-pressed={bottomMode.measuring}
            onClick={() => {
              setMarkupOpen(false);
              setTool("pan");
              setSelectedId(null);
              requestMode(bottomMode.measuring ? "idle" : "measure");
            }}
          >
            <RulerIcon className="h-5 w-5" />
            {bottomMode.measuring ? "Done" : "Measure"}
          </Button>
        </div>
      </div>
      <Dialog
        open={Boolean(linkChooser)}
        onOpenChange={(open) => {
          if (!open) setLinkChooser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {linkChooser?.text?.trim().length
                ? linkChooser.text.trim()
                : "Choose a link"}
            </DialogTitle>
            <DialogDescription>
              Choose a destination for this hyperlink.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {linkChooser &&
              drawingMarkupLinks(linkChooser).map((link, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="h-auto min-h-12 justify-start text-left whitespace-normal"
                  onClick={() => {
                    setLinkChooser(null);
                    openDestination(link);
                  }}
                >
                  {link.label}
                </Button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
