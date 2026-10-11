"use client";
import { usePageViewState } from "~/hooks/use-page-view-state";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
  UploadIcon,
  StarIcon,
  DownloadIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  MaximizeIcon,
  MinimizeIcon,
} from "lucide-react";

import { api } from "~/trpc/react";
import type { DrawingWorkspace as WorkspaceSnapshot } from "~/lib/drawing-workspace";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ViewToggle } from "~/components/ui/view-toggle";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { tileBase } from "~/lib/drawing-tiles";
import { warmDrawingPdfRuntime } from "~/lib/drawing-pdf-offline-runtime";
import { collectDrawingOfflineUrls } from "~/lib/drawing-offline";
import { uploadDrawings } from "~/lib/upload-drawings";
import {
  DrawingsAccessGate,
  useDrawingCapabilities,
} from "~/components/permissions/DrawingsAccess";
import type { DrawingViewport } from "./DrawingSheetViewer";
import { DrawingWorkspace } from "./DrawingWorkspace";
import { DrawingSheetRegister } from "./DrawingSheetRegister";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { currentSnapshotState } from "~/lib/snapshot-source";
import { useDrawingSnapshot } from "./useDrawingSnapshot";
import { useDrawingFullscreen } from "./useDrawingFullscreen";

const nonempty = (value: string | undefined, fallback: string) =>
  value?.trim() ? value : fallback;

type NameDialog =
  | { kind: "new-set" }
  | { kind: "rename-set"; id: string; name: string }
  | { kind: "rename-sheet"; id: string; name: string };

const BAR_BUTTON =
  "h-9 min-h-9 w-full rounded-lg px-1.5 py-1 text-xs leading-tight whitespace-normal";
const BOTTOM_BAR =
  "bg-background fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden";

/**
 * Drawings for a job: folders of drawing sheets. Uploading a PDF into a folder
 * splits it into one sheet per page. Sheets are only viewed (no room detection).
 */
export function JobDrawingsView({ jobId }: { jobId: string }) {
  return (
    <DrawingsAccessGate>
      <JobDrawingsContent jobId={jobId} />
    </DrawingsAccessGate>
  );
}

function JobDrawingsContent({ jobId }: { jobId: string }) {
  const permissions = useDrawingCapabilities();
  const sandbox = useTutorialSandbox();
  const utils = api.useUtils();
  const [setId, setSetId] = usePageViewState<string | null>(
    `drawings:${jobId}:setId`,
    null,
  );
  const [sheetId, setSheetId] = usePageViewState<string | null>(
    `drawings:${jobId}:sheetId`,
    null,
  );
  const full = useDrawingFullscreen(sheetId !== null);
  const lastViewport = useRef<DrawingViewport | null>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const [entryViewport, setEntryViewport] = useState<DrawingViewport | null>(
    null,
  );
  const openSheet = (id: string | null, preserveViewport = false) => {
    setEntryViewport(preserveViewport ? lastViewport.current : null);
    if (!preserveViewport) lastViewport.current = null;
    setSheetId(id);
  };
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const account = useDrawingAccount();
  const [query, setQuery] = usePageViewState(`drawings:${jobId}:query`, "");
  const [discipline, setDiscipline] = usePageViewState(
    `drawings:${jobId}:discipline`,
    "",
  );
  const [status, setStatus] = usePageViewState(`drawings:${jobId}:status`, "");
  const [favoritesOnly, setFavoritesOnly] = usePageViewState(
    `drawings:${jobId}:favoritesOnly`,
    false,
  );
  const [listView, setListView] = usePageViewState(
    `drawings:${jobId}:listView`,
    false,
  );
  const [registerOpen, setRegisterOpen] = usePageViewState(
    `drawings:${jobId}:registerOpen`,
    false,
  );
  const [download, setDownload] = useState<string | null>(null);
  const downloader = useRef<AbortController | null>(null);
  const summaries = api.drawingsWorkspace.list.useQuery(
    { jobId },
    { enabled: !sandbox, staleTime: 30_000 },
  );
  const summarySnapshot = useDrawingSnapshot(
    `drawing-index:${jobId}`,
    summaries.data,
  );
  const bySheet = useMemo(
    () =>
      new Map((summarySnapshot.data ?? []).map((row) => [row.sheetId, row])),
    [summarySnapshot.data],
  );
  const favorite = api.drawingsWorkspace.favorite.useMutation({
    onSuccess: () => utils.drawingsWorkspace.list.invalidate({ jobId }),
    onError: (error) => notify(error.message, "error"),
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("drawingSheet"),
      folder = url.searchParams.get("drawingSet");
    if (
      id &&
      folder &&
      /^[0-9a-f-]{36}$/i.test(id) &&
      /^[0-9a-f-]{36}$/i.test(folder)
    ) {
      setSetId(folder);
      setSheetId(id);
      const saved = currentSnapshotState()?.drawing;
      if (
        saved?.jobId === jobId &&
        saved.sheetId === id &&
        saved.setId === folder
      ) {
        setEntryViewport(saved.viewport);
        lastViewport.current = saved.viewport;
      }
    }
    return () => downloader.current?.abort();
  }, [jobId]);

  const sets = api.drawings.listSets.useQuery({ jobId }, { enabled: !sandbox });
  const set = api.drawings.getSet.useQuery(
    { setId: setId ?? "" },
    { enabled: !sandbox && Boolean(setId) },
  );
  const setSnapshot = useDrawingSnapshot(`drawing-set:${setId}`, set.data);
  const setsSnapshot = useDrawingSnapshot(`drawing-sets:${jobId}`, sets.data);
  const setData = setSnapshot.data;
  const setsData = setsSnapshot.data;
  const refresh = async () => {
    await utils.drawings.listSets.invalidate({ jobId });
    await utils.drawingsWorkspace.list.invalidate({ jobId });
    if (setId) await utils.drawings.getSet.invalidate({ setId });
  };
  const onError = (error: { message: string }) =>
    notify(error.message, "error");
  const createSet = api.drawings.createSet.useMutation({
    onSuccess: async (result) => {
      await refresh();
      setSetId(result.id);
    },
    onError,
  });
  const renameSet = api.drawings.renameSet.useMutation({
    onSuccess: refresh,
    onError,
  });
  const deleteSet = api.drawings.deleteSet.useMutation({
    onSuccess: async () => {
      setSetId(null);
      await refresh();
    },
    onError,
  });
  const renameSheet = api.drawings.renameSheet.useMutation({
    onSuccess: async () => {
      await refresh();
      await utils.drawingsWorkspace.get.invalidate();
    },
    onError,
  });
  const deleteSheet = api.drawings.deleteSheet.useMutation({
    onSuccess: refresh,
    onError,
  });

  const sheets = useMemo(() => setData?.sheets ?? [], [setData?.sheets]);
  const visibleSheets = useMemo(() => sheets
    .filter((item) => {
      const summary = bySheet.get(item.id),
        metadata = summary?.metadata;
      const text = [
        item.name,
        item.sourceFilename,
        metadata?.number,
        metadata?.title,
        metadata?.discipline,
        ...(metadata?.tags ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!query.trim() || text.includes(query.trim().toLocaleLowerCase())) &&
        (!discipline || metadata?.discipline === discipline) &&
        (!status || metadata?.status === status) &&
        (!favoritesOnly || summary?.favorite)
      );
    })
    .sort((a, b) =>
      nonempty(bySheet.get(a.id)?.metadata.number, a.name).localeCompare(
        nonempty(bySheet.get(b.id)?.metadata.number, b.name),
        undefined,
        { numeric: true, sensitivity: "base" },
      ),
    ), [sheets, bySheet, query, discipline, status, favoritesOnly]);
  const downloadFolder = async () => {
    if (!account?.store || downloader.current || !setData) return;
    const controller = new AbortController();
    downloader.current = controller;
    setDownload("Preparing folder…");
    try {
      await warmDrawingPdfRuntime({ signal: controller.signal });
      const workspaces: WorkspaceSnapshot[] = [];
      const images = new Set(sheets.map((item) => item.imageUrl));
      for (const item of sheets) {
        controller.signal.throwIfAborted();
        setDownload(
          `Preparing drawing ${workspaces.length + 1} of ${sheets.length}…`,
        );
        const workspace = await utils.drawingsWorkspace.get.fetch({
          sheetId: item.id,
        });
        workspaces.push(workspace);
        const current = workspace.jobSheets.find(
          (source) => source.id === workspace.metadata.currentSourceSheetId,
        );
        if (current) images.add(current.imageUrl);
      }
      const urls = await collectDrawingOfflineUrls([...images], {
        includeTiles: false,
        signal: controller.signal,
      });
      await account.store.saveAssets(urls, {
        signal: controller.signal,
        onProgress: (p) =>
          setDownload(
            `${p.completed}/${p.total} files · ${(p.bytes / 1048576).toFixed(1)} MB`,
          ),
      });
      await account.store.saveSnapshot(`drawing-set:${setId}`, setData);
      if (setsData)
        await account.store.saveSnapshot(`drawing-sets:${jobId}`, setsData);
      if (summarySnapshot.data)
        await account.store.saveSnapshot(
          `drawing-index:${jobId}`,
          summarySnapshot.data,
        );
      for (const workspace of workspaces) {
        controller.signal.throwIfAborted();
        await account.store.saveSnapshot(
          `workspace:${workspace.sheetId}`,
          workspace,
        );
      }
      notify("Folder saved on this device for offline viewing.", "success");
    } catch (error) {
      if (!controller.signal.aborted)
        notify(
          error instanceof Error ? error.message : "Download failed",
          "error",
        );
    } finally {
      downloader.current = null;
      setDownload(null);
    }
  };
  const sheetIndex = sheets.findIndex((sheet) => sheet.id === sheetId);
  const sheet = sheetIndex >= 0 ? sheets[sheetIndex] : null;
  const flags = setId ? setData : setsData;
  const canUpload =
    !sandbox &&
    setSnapshot.online &&
    Boolean(permissions.canUpload ?? flags?.canUpload ?? flags?.canManage);
  const canDelete =
    !sandbox &&
    setSnapshot.online &&
    Boolean(permissions.canDelete ?? flags?.canDelete ?? flags?.canManage);

  // Paging should feel instant: warm the neighbouring sheets in the background.
  const neighbours = sheet
    ? [sheets[sheetIndex - 1], sheets[sheetIndex + 1]]
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => item.imageUrl)
        .join("|")
    : "";
  useEffect(() => {
    if (!neighbours) return;
    for (const url of neighbours.split("|")) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      const tiles = tileBase(url);
      if (tiles)
        void fetch(`${tiles}/manifest.json`, {
          credentials: "same-origin",
        }).catch(() => undefined);
    }
  }, [neighbours]);

  const neighbourIds = sheet ? [sheets[sheetIndex + 1]?.id, sheets[sheetIndex - 1]?.id].filter(Boolean).join("|") : "";
  useEffect(() => {
    if (!neighbourIds || sandbox || !setSnapshot.online) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const id of neighbourIds.split("|")) {
          if (cancelled) return;
          // Cache is account scoped by the drawing provider. Normal mount still
          // revalidates permissions; prefetch only removes the empty wait.
          await utils.drawingsWorkspace.get.prefetch({ sheetId: id }, { staleTime: 15_000 });
        }
      })().catch(() => undefined);
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [neighbourIds, sandbox, setSnapshot.online, utils]);

  // The app bar back arrow steps out of a sheet, then out of a folder.
  useHeaderBackOverride(
    full.fullscreen
      ? full.exit
      : sheetId
        ? () => openSheet(null)
        : setId
          ? () => setSetId(null)
          : null,
  );

  const openNameDialog = (dialog: NameDialog) => {
    setNameDialog(dialog);
    setNameDraft(dialog.kind === "new-set" ? "" : dialog.name);
  };
  const saveName = () => {
    const name = nameDraft.trim();
    if (!nameDialog || !name) return;
    if (nameDialog.kind === "new-set") createSet.mutate({ jobId, name });
    else if (nameDialog.kind === "rename-set")
      renameSet.mutate({ setId: nameDialog.id, name });
    else renameSheet.mutate({ sheetId: nameDialog.id, name });
    setNameDialog(null);
  };
  const upload = async (file: File) => {
    if (!setId) return;
    setUploading(file.name);
    try {
      await uploadDrawings(jobId, file, { drawingSetId: setId });
      await refresh();
      notify(`${file.name} was added to this folder.`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed", "error");
    } finally {
      setUploading(null);
    }
  };

  const nameDialogView = (
    <Dialog
      open={nameDialog !== null}
      onOpenChange={(open) => !open && setNameDialog(null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {nameDialog?.kind === "new-set"
              ? "New drawing folder"
              : nameDialog?.kind === "rename-set"
                ? "Rename folder"
                : "Rename drawing"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveName();
          }}
        >
          <Input
            autoFocus
            aria-label="Name"
            maxLength={255}
            value={nameDraft}
            placeholder={
              nameDialog?.kind === "new-set" ? "e.g. Mechanical" : undefined
            }
            onChange={(event) => setNameDraft(event.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNameDialog(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!nameDraft.trim()}>
              {nameDialog?.kind === "new-set" ? "Create folder" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  // Sheet viewer: full screen under the app bar.
  if (sheet) {
    return (
      <div
        ref={full.surface}
        data-drawing-fullscreen={full.fullscreen}
        className={`bg-background fixed flex flex-col ${full.fullscreen ? "inset-0 z-[60] [&_[data-drawing-chrome]]:hidden" : "inset-x-0 top-14 bottom-0 z-30 sm:top-16"}`}
      >
        {full.fullscreen && (
          <Button
            ref={full.exitButton}
            type="button"
            variant="outline"
            aria-label="Exit full screen"
            title="Exit full screen (Esc)"
            className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-[calc(0.75rem+env(safe-area-inset-right))] z-50 size-11 rounded-xl shadow-md"
            onClick={full.exit}
          >
            <MinimizeIcon className="size-5" aria-hidden="true" />
          </Button>
        )}
        <div className="relative min-h-0 flex-1">
          <DrawingWorkspace
            key={sheet.id}
            jobId={jobId}
            sheet={sheet}
            initialViewport={entryViewport}
            onViewportChange={(value) => {
              lastViewport.current = value;
              const text = `${Math.round(value.zoom * 100)}%`;
              if (zoomLabel.current && zoomLabel.current.textContent !== text)
                zoomLabel.current.textContent = text;
            }}
            onOpenSheet={(target) => {
              setSetId(target.setId);
              openSheet(target.id);
            }}
          />
        </div>
        {/* Second row of the drawing's bottom bar (the workspace draws the
            first: More, Tools, Markup, Measure). */}
        <div
          data-drawing-chrome
          className="bg-card shrink-0 px-4 pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-2">
            <Button
              variant="outline"
              className="h-11 min-w-0 rounded-xl px-2 text-sm"
              disabled={sheetIndex <= 0}
              onClick={() => openSheet(sheets[sheetIndex - 1]!.id, true)}
            >
              <ChevronLeftIcon className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <div className="flex min-w-0 flex-col items-center">
              <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
                {canUpload ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 min-w-0 shrink gap-1 px-1 text-sm"
                    aria-label={`Rename drawing ${sheet.name}`}
                    title={sheet.name}
                    disabled={renameSheet.isPending}
                    onClick={() =>
                      openNameDialog({
                        kind: "rename-sheet",
                        id: sheet.id,
                        name: sheet.name,
                      })
                    }
                  >
                    <span className="truncate">{sheet.name}</span>
                    <PencilIcon
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  </Button>
                ) : (
                  <span
                    className="min-w-0 truncate py-1 text-center text-sm"
                    title={sheet.name}
                  >
                    {sheet.name}
                  </span>
                )}
                <span
                  ref={zoomLabel}
                  aria-label="Drawing zoom"
                  title="Zoom (100% = fit to screen)"
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                >
                  {Math.round((entryViewport?.zoom ?? 1) * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-muted-foreground text-xs tabular-nums">
                  {sheetIndex + 1} of {sheets.length}
                </span>
                <Button
                  ref={full.enterButton}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Full screen"
                  title="Full screen"
                  onClick={full.enter}
                >
                  <MaximizeIcon className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-11 min-w-0 rounded-xl px-2 text-sm"
              disabled={sheetIndex >= sheets.length - 1}
              onClick={() => openSheet(sheets[sheetIndex + 1]!.id, true)}
            >
              Next
              <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
        {nameDialogView}
      </div>
    );
  }

  // Inside a folder: its sheets.
  if (setId) {
    const disciplines = [
      ...new Set(
        sheets
          .map((s) => bySheet.get(s.id)?.metadata.discipline)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const activeFilters =
      (discipline ? 1 : 0) + (status ? 1 : 0) + (favoritesOnly ? 1 : 0);
    const uploadButton = (className: string, size: "default" | "lg" = "lg") => (
      <Button
        size={size}
        className={className}
        disabled={!canUpload || uploading !== null}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? (
          <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <UploadIcon className="mr-2 h-5 w-5" />
        )}
        {uploading ? "Splitting PDF into drawings…" : "Upload drawings"}
      </Button>
    );
    return (
      <div className="pb-24">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-foreground min-w-0 truncate text-xl font-semibold">
            {setData?.set.name ?? "Drawings"}
          </h2>
          {/* Same grid/list switch, in the same place, as material lists. */}
          <ViewToggle
            view={listView ? "table" : "grid"}
            onViewChange={(view) => setListView(view === "table")}
            showOnMobile
          />
        </div>
        {!setSnapshot.online && (
          <p role="status" className="mb-3 text-sm">
            Offline · Saved drawings are available to view. Reconnect to make
            changes.
          </p>
        )}
        {download && (
          <p role="status" className="mb-3 text-sm">
            {download}{" "}
            <button
              className="underline"
              onClick={() => downloader.current?.abort()}
            >
              Cancel download
            </button>
          </p>
        )}
        {set.error && setSnapshot.online && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {set.error.message}
          </p>
        )}
        {uploading && (
          <p role="status" className="text-muted-foreground mb-4 text-sm">
            Uploading {uploading}. Each page becomes its own drawing; large sets
            can take a few minutes.
          </p>
        )}
        {set.isLoading && !setData ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading drawings…
          </p>
        ) : sheets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileTextIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
              <h3 className="mb-2 text-lg font-semibold">No drawings yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Upload a PDF. Each page becomes its own drawing in this folder.
              </p>
              {canUpload && uploadButton("", "default")}
            </CardContent>
          </Card>
        ) : (
          <div
            className={
              listView
                ? "overflow-hidden rounded border"
                : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            }
          >
            {visibleSheets.length === 0 && (
              <p className="p-4 text-sm">No drawings match these filters.</p>
            )}
            {visibleSheets.map((item) => (
              <Card
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${item.name}`}
                className={
                  listView
                    ? "flex cursor-pointer flex-row gap-0 rounded-none border-0 border-b py-0 shadow-none"
                    : "cursor-pointer gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md"
                }
                onPointerEnter={() => {
                  if (!sandbox && setSnapshot.online) void utils.drawingsWorkspace.get.prefetch({ sheetId: item.id }, { staleTime: 15_000 });
                }}
                onFocus={() => {
                  if (!sandbox && setSnapshot.online) void utils.drawingsWorkspace.get.prefetch({ sheetId: item.id }, { staleTime: 15_000 });
                }}
                onClick={() => openSheet(item.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSheet(item.id);
                  }
                }}
              >
                <DrawingThumbnail
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className={
                    listView
                      ? "bg-muted h-16 w-20 shrink-0 border-r object-contain"
                      : "bg-muted aspect-[4/3] w-full border-b object-contain"
                  }
                />
                <div className="flex min-w-0 flex-1 items-center gap-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {nonempty(
                        bySheet.get(item.id)?.metadata.number,
                        item.name,
                      )}
                    </span>
                    <span className="text-muted-foreground block min-h-4 truncate text-xs">
                      {bySheet.get(item.id)?.metadata.title?.trim()}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!setSnapshot.online || favorite.isPending}
                    aria-label={`${bySheet.get(item.id)?.favorite ? "Unfavorite" : "Favorite"} ${item.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      favorite.mutate({
                        sheetId: item.id,
                        favorite: !bySheet.get(item.id)?.favorite,
                      });
                    }}
                  >
                    <StarIcon
                      className={`h-4 w-4 ${bySheet.get(item.id)?.favorite ? "fill-amber-400 text-amber-600" : ""}`}
                    />
                  </Button>
                  {(canUpload || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground -mr-2 h-8 w-8 shrink-0"
                          aria-label={`More actions for ${item.name}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreVerticalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {canUpload && (
                          <DropdownMenuItem
                            onSelect={() =>
                              openNameDialog({
                                kind: "rename-sheet",
                                id: item.id,
                                name: item.name,
                              })
                            }
                          >
                            <PencilIcon className="h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={async () => {
                              if (
                                await confirmAction({
                                  title: `Delete ${item.name}?`,
                                  description:
                                    "This drawing will be removed from the folder.",
                                  confirmLabel: "Delete",
                                  destructive: true,
                                })
                              )
                                deleteSheet.mutate({ sheetId: item.id });
                            }}
                          >
                            <TrashIcon className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        {/* Bottom bar like Add Parts: filters menu, search, add drawings. */}
        <div className="bg-card fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-2">
          <div className="mx-auto grid max-w-6xl grid-cols-3 gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={activeFilters > 0 ? "default" : "outline"}
                  className={BAR_BUTTON}
                >
                  <SlidersHorizontalIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                  Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="max-h-[70dvh] min-w-56 overflow-y-auto"
              >
                <DropdownMenuLabel>Discipline</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={discipline}
                  onValueChange={setDiscipline}
                >
                  <DropdownMenuRadioItem value="">
                    All disciplines
                  </DropdownMenuRadioItem>
                  {disciplines.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {value}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={status}
                  onValueChange={setStatus}
                >
                  <DropdownMenuRadioItem value="">
                    All statuses
                  </DropdownMenuRadioItem>
                  {["draft", "for_review", "approved", "superseded"].map(
                    (value) => (
                      <DropdownMenuRadioItem
                        key={value}
                        value={value}
                        className="capitalize"
                      >
                        {value.replaceAll("_", " ")}
                      </DropdownMenuRadioItem>
                    ),
                  )}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={favoritesOnly}
                  onCheckedChange={(checked) =>
                    setFavoritesOnly(checked === true)
                  }
                >
                  <StarIcon className="h-4 w-4" />
                  Starred only
                </DropdownMenuCheckboxItem>
                {((canUpload && sheets.length > 0) || account?.store) && (
                  <DropdownMenuSeparator />
                )}
                {canUpload && sheets.length > 0 && (
                  <DropdownMenuItem onSelect={() => setRegisterOpen(true)}>
                    <FileTextIcon className="h-4 w-4" />
                    Read title blocks
                  </DropdownMenuItem>
                )}
                {account?.store && (
                  <DropdownMenuItem
                    disabled={
                      !setSnapshot.online || !sheets.length || Boolean(download)
                    }
                    onSelect={() => void downloadFolder()}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    Save folder offline
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative min-w-0">
              <SearchIcon className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Search drawings"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-9 w-full rounded-lg pl-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>
            <Button
              className={BAR_BUTTON}
              disabled={!canUpload || uploading !== null}
              title={
                canUpload
                  ? "Upload a PDF; each page becomes a drawing"
                  : "You can't add drawings"
              }
              onClick={() => fileInput.current?.click()}
            >
              {uploading && (
                <Loader2Icon className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />
              )}
              {uploading ? "Adding…" : "Add Drawings"}
            </Button>
          </div>
        </div>
        {canUpload && sheets.length > 0 && (
          <DrawingSheetRegister
            jobId={jobId}
            sheets={sheets}
            summaries={summarySnapshot.data ?? []}
            open={registerOpen}
            onOpenChange={setRegisterOpen}
          />
        )}
        {nameDialogView}
      </div>
    );
  }

  // Folders.
  const folders = setsData?.sets ?? [];
  const newFolderButton = (
    className: string,
    size: "default" | "lg" = "lg",
  ) => (
    <Button
      size={size}
      className={className}
      disabled={!canUpload}
      onClick={() => openNameDialog({ kind: "new-set" })}
    >
      <FolderPlusIcon className="mr-2 h-5 w-5" />
      New folder
    </Button>
  );
  return (
    <div className="pb-24">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-foreground text-xl font-semibold">Drawings</h2>
        {canUpload &&
          folders.length > 0 &&
          newFolderButton("hidden h-11 sm:inline-flex")}
      </div>
      {sandbox ? (
        <p className="text-muted-foreground text-sm">
          Drawings aren&apos;t part of the practice job.
        </p>
      ) : sets.isLoading && !setsData ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading drawings…
        </p>
      ) : folders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-semibold">
              No drawing folders yet
            </h3>
            <p className="text-muted-foreground mb-4 text-center">
              Create a folder for each drawing set, like Mechanical or
              Electrical.
            </p>
            {canUpload && newFolderButton("", "default")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <Card
              key={folder.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${folder.name}`}
              className="cursor-pointer gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md"
              onClick={() => setSetId(folder.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSetId(folder.id);
                }
              }}
            >
              {folder.coverImageUrl ? (
                <DrawingThumbnail
                  src={folder.coverImageUrl}
                  alt=""
                  loading="lazy"
                  className="bg-muted aspect-[16/9] w-full border-b object-contain"
                />
              ) : (
                <div className="bg-muted text-muted-foreground/60 flex aspect-[16/9] w-full items-center justify-center border-b">
                  <FolderIcon className="h-12 w-12" />
                </div>
              )}
              <CardHeader className="flex flex-row items-start justify-between gap-2 px-4 pt-3 pb-0">
                <CardTitle className="min-w-0 leading-tight break-words">
                  {folder.name}
                </CardTitle>
                {(canUpload || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground -mt-1 -mr-2 h-9 w-9 shrink-0"
                        aria-label={`More actions for ${folder.name}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreVerticalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {canUpload && (
                        <DropdownMenuItem
                          onSelect={() =>
                            openNameDialog({
                              kind: "rename-set",
                              id: folder.id,
                              name: folder.name,
                            })
                          }
                        >
                          <PencilIcon className="h-4 w-4" />
                          Rename folder
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={async () => {
                            if (
                              await confirmAction({
                                title: `Delete ${folder.name}?`,
                                description: `This deletes the folder and its ${folder.sheetCount} ${folder.sheetCount === 1 ? "drawing" : "drawings"}.`,
                                confirmLabel: "Delete folder",
                                destructive: true,
                              })
                            )
                              deleteSet.mutate({ setId: folder.id });
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                          Delete folder
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardHeader>
              <CardContent className="text-muted-foreground px-4 pt-1 pb-4 text-sm">
                {folder.sheetCount}{" "}
                {folder.sheetCount === 1 ? "drawing" : "drawings"}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canUpload && (
        <div className={BOTTOM_BAR}>{newFolderButton("h-12 w-full")}</div>
      )}
      {nameDialogView}
    </div>
  );
}

function DrawingThumbnail(
  props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string },
) {
  const account = useDrawingAccount();
  const [resolved, setResolved] = useState<{
    src: string;
    url: string;
    account: string;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (account?.store)
      void account.store
        .resolveAssetUrl(props.src)
        .then((url) => {
          if (!stopped)
            setResolved({ src: props.src, url, account: account.accountKey });
        })
        .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [account, props.src]);
  const src =
    resolved?.src === props.src && resolved.account === account?.accountKey
      ? resolved.url
      : props.src;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={src} alt={props.alt ?? ""} />;
}
