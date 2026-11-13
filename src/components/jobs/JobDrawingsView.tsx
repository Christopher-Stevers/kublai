"use client";
import { useCreateDrawingSet } from "~/hooks/use-create-drawing-set";
import { getQueryKey } from "@trpc/react-query";
import { useTierOneReadOptions } from "~/hooks/use-tier-one-read-options";
import { useInstantDrawingMetadata } from "~/hooks/use-instant-drawing-metadata";
import { verifyDrawingDownload, type DownloadMarker } from "~/lib/drawing-download-check";
import { drawingFolderSummary, drawingFolderDownloadSets } from "~/lib/drawing-folder-summary";
import { drawingMoveTargets } from "~/lib/drawing-folder-move";
import { requestPersistentDeviceStorage } from "~/lib/persistent-device-storage";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { scheduleBackgroundWork, canWarmInBackground } from "~/lib/background-work";
import { drawingDownloadQueue } from "~/lib/drawing-download-queue";
import { useDrawingDownloads } from "~/hooks/use-drawing-downloads";
import { useDrawingPageMode } from "./DrawingPageMode";
import { scrollNeighbors } from "./drawing-scroll-pages";
import { DrawingPageNavigation, DrawingZoomReadout, showZoomReadout } from "./DrawingPageNavigation";
import { usePageViewState } from "~/hooks/use-page-view-state";
import { useRootFlag } from "~/hooks/use-root-flag";

import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  CheckIcon,
  SlidersHorizontalIcon,
  MinimizeIcon,
} from "lucide-react";

import { api } from "~/trpc/react";
import type { DrawingWorkspace as WorkspaceSnapshot } from "~/lib/drawing-workspace";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { PressableCard } from "~/components/ui/pressable-card";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { Input } from "~/components/ui/input";
import { ViewToggle } from "~/components/ui/view-toggle";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { BulkDrawingRevisions } from "./BulkDrawingRevisions";
import { uploadDrawings } from "~/lib/upload-drawings";
import {
  DrawingsAccessGate,
  useDrawingCapabilities,
} from "~/components/permissions/DrawingsAccess";
import type { DrawingViewport } from "./DrawingSheetViewer";
import { SheetOfflineButton } from "./SheetOfflineButton";
import { DrawingThumbnail } from "./DrawingThumbnail";
import {
  recordDrawingFolderOpen,
  recordDrawingSheetOpen,
  useDrawingFolderOrder,
  useDrawingSheetOrder,
} from "./useDrawingFolderOrder";
import { DrawingWorkspace } from "./DrawingWorkspace";
import { DrawingSheetRegister } from "./DrawingSheetRegister";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { DRAWING_DESTINATION_EVENT, readSnapshotState, type SnapshotState } from "~/lib/snapshot-source";
import { useDrawingSnapshot } from "./useDrawingSnapshot";
import { useDrawingFullscreen } from "./useDrawingFullscreen";

const nonempty = (value: string | undefined, fallback: string) =>
  /^sheet\s+\d+$/i.test(value?.trim() ?? "") && fallback.trim()
    ? fallback.trim()
    : value?.trim() ? value : fallback;

type NameDialog =
  | { kind: "new-set" }
  | { kind: "rename-set"; id: string; name: string }
  | { kind: "rename-sheet"; id: string; name: string };

const BAR_BUTTON =
  "h-9 min-h-9 w-full rounded-lg px-1.5 py-1 text-xs leading-tight whitespace-normal";
const BOTTOM_BAR =
  "bg-background fixed inset-x-0 bottom-0 z-40 pin-viewport-bottom border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden";

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
  const workspacePrefetches = useRef(new Set<string>());
  const prefetchWorkspace = async (sheetId: string, signal?: AbortSignal) => {
    if (workspacePrefetches.current.has(sheetId) || utils.drawingsWorkspace.get.getData({ sheetId })) return;
    workspacePrefetches.current.add(sheetId);
    try {
      const workspace = await utils.client.drawingsWorkspace.get.query({ sheetId, deferLinks: true }, { signal });
      if (!signal?.aborted) utils.drawingsWorkspace.get.setData({ sheetId }, workspace);
    } catch { /* Opening the drawing shows any actual load error. */ }
    finally { workspacePrefetches.current.delete(sheetId); }
  };
  const [readySheet, setReadySheet] = useState<string | null>(null);
  const [setId, setSetId] = usePageViewState<string | null>(
    `drawings:${jobId}:setId`,
    null,
  );
  const [sheetId, setSheetId] = usePageViewState<string | null>(
    `drawings:${jobId}:sheetId`,
    null,
  );
  const full = useDrawingFullscreen(sheetId !== null);
  const quickWheel = full.fullscreen;
  const lastViewport = useRef<DrawingViewport | null>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const pageModeScope = `drawing-set:${jobId}:${setId ?? "root"}`;
  const { scroll } = useDrawingPageMode(pageModeScope);
  const [entryViewport, setEntryViewport] = useState<DrawingViewport | null>(
    null,
  );
  const [destination, setDestination] = useState<{request:number;snapshot:SnapshotState|null}>({request:0,snapshot:null});
  const openSheet = (id: string | null, preserveViewport = false) => {
    if (id) performance.mark("foremenhq:sheet-open");
    setReadySheet(null);
    setDestination(previous=>({...previous,snapshot:null}));
    setEntryViewport(preserveViewport ? lastViewport.current : null);
    if (!preserveViewport) lastViewport.current = null;
    setSheetId(id);
  };
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const [cornerContainer, setCornerContainer] = useState<HTMLDivElement | null>(null);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [moving, setMoving] = useState<{ id: string; name: string; parentId: string | null } | null>(null);
  const [moveDestination, setMoveDestination] = useState("");
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameDialogGeneration, setNameDialogGeneration] = useState(0);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const account = useDrawingAccount();
  const folderOrder = useDrawingFolderOrder();
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
  const downloadTasks = useDrawingDownloads();
  const activeDownload = (id: string) => downloadTasks.find(task => drawingFolderDownloadSets(setsData?.sets ?? [], id).some(folder => task.id === `${account?.accountKey}:set:${folder.id}`) && (task.status === "queued" || task.status === "running"));
  const [downloadRevision, setDownloadRevision] = useState(0);
  useEffect(() => {
    const changed = () => setDownloadRevision(value => value + 1);
    window.addEventListener("foremanhq-drawing-downloads-changed", changed);
    return () => window.removeEventListener("foremanhq-drawing-downloads-changed", changed);
  }, []);
  const [checkingDownloads, setCheckingDownloads] = useState(true);
  const [downloadSizes, setDownloadSizes] = useState<Record<string, number>>({});
  const [savedSets, setSavedSets] = useState<Record<string, string>>({});
  const summaries = api.drawingsWorkspace.list.useQuery(
    { jobId },
    { ...useTierOneReadOptions(getQueryKey(api.drawingsWorkspace.list, { jobId }, "query")), staleTime: 30_000 },
  );
  const summarySnapshot = useDrawingSnapshot(
    `drawing-index:${jobId}`,
    summaries.data,
    undefined,
    { localFirst: true, accessRevoked: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(summaries.error?.data?.code ?? "") },
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
    const apply = (href: string) => {
      const url = new URL(href, window.location.origin);
      const snapshot = readSnapshotState(url.hash);
      const saved = snapshot?.drawing;
      if (url.origin !== window.location.origin ||
          (url.pathname !== `/jobs/${jobId}/drawings` && !(url.pathname === "/jobs" && saved?.jobId === jobId))) return;
      const id = url.searchParams.get("drawingSheet"), folder = url.searchParams.get("drawingSet");
      if (!id || !folder || !/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(folder)) return;
      const matches = saved?.jobId === jobId && saved.sheetId === id && saved.setId === folder;
      setSetId(folder);
      performance.mark("foremenhq:sheet-open");
      setSheetId(id);
      setEntryViewport(matches ? saved.viewport : null);
      lastViewport.current = matches ? saved.viewport : null;
      // A new request remounts even the same sheet; its saved viewport/revision must reapply.
      setDestination(previous => ({request:previous.request+1,snapshot:matches ? snapshot : null}));
    };
    const current = () => apply(window.location.href);
    const linked = (event: Event) => {
      const href = (event as CustomEvent<unknown>).detail;
      if (typeof href === "string") apply(href);
    };
    current();
    window.addEventListener(DRAWING_DESTINATION_EVENT, linked);
    window.addEventListener("hashchange", current);
    window.addEventListener("popstate", current);
    return () => {
      window.removeEventListener(DRAWING_DESTINATION_EVENT, linked);
      window.removeEventListener("hashchange", current);
      window.removeEventListener("popstate", current);
    };
  }, [jobId, setSetId, setSheetId]);

  const sets = api.drawings.listSets.useQuery({ jobId }, useTierOneReadOptions(getQueryKey(api.drawings.listSets, { jobId }, "query")));
  const set = api.drawings.getSet.useQuery(
    { setId: setId ?? "" },
    useTierOneReadOptions(getQueryKey(api.drawings.getSet, { setId: setId ?? "" }, "query"), Boolean(setId)),
  );
  const instantMetadata = useInstantDrawingMetadata({
    jobId, setId,
    onMoveStarted: () => setMoving(null),
    onMoveConfirmed: () => notify("Drawing folder moved", "success"),
  });
  const { moveSet, renameSheet, canPersistSet } = instantMetadata;
  const setSnapshot = useDrawingSnapshot(`drawing-set:${setId}`, set.data, undefined, { localFirst: true, accessRevoked: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(set.error?.data?.code ?? ""), canPersist: instantMetadata.canPersistSet });
  const setsSnapshot = useDrawingSnapshot(`drawing-sets:${jobId}`, sets.data, undefined, { localFirst: true, accessRevoked: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(sets.error?.data?.code ?? ""), canPersist: instantMetadata.canPersistSets });
  const setData = setSnapshot.data;
  const setsData = setsSnapshot.data;
  // Completion markers live with the account's assets, so clearing device data
  // also clears the downloaded status.
  const folderVersions = JSON.stringify((setsData?.sets ?? []).map(folder => [folder.id, folder.downloadVersion ?? `${new Date(folder.updatedAt).toISOString()}:${folder.sheetCount}`, folder.sheetCount]));
  useEffect(() => {
    // Folder-wide verification must not compete with the PDF being opened.
    if (sheetId) return;
    let stopped = false;
    setCheckingDownloads(true);
    const store = account?.store;
    if (store) void (async () => {
      const found: Record<string, string> = {};
      const sizes: Record<string, number> = {};
      sets: for (const [id, version] of JSON.parse(folderVersions) as [string, string, number][]) {
        if (stopped) return;
        try {
          let marker = await store.readSnapshot<DownloadMarker>(`drawing-download:${id}`);
          let saved = await store.readSnapshot<{ sheets: { id: string; imageUrl: string }[]; downloadVersion?: string }>(`drawing-set:${id}`);
          // Only repair sets with evidence of a previous download, never download new sets implicitly.
          if (!marker && !saved) continue;
          if (setsSnapshot.online && (!saved || marker?.version !== version)) {
            const fresh = await utils.drawings.getSet.fetch({ setId: id });
            saved = fresh;
            if (stopped) return;
            if (canPersistSet(fresh)) await store.saveSnapshot(`drawing-set:${id}`, fresh);
            marker = null;
          }
          if (!saved) continue;
          if (!marker) {
            if (saved.downloadVersion !== version) continue;
            const urls = await collectDrawingOfflineUrls(saved.sheets.map(s => s.imageUrl), { includeTiles: false });
            marker = { version, urls, sheets: saved.sheets.map(s => s.id) };
          }
          if (marker.version !== version) continue;
          // A viewed set's cached metadata alone is not evidence of saved files.
          // Do not fetch workspaces for it unless the drawing bytes are present.
          let filesChecked = false;
          // Rebuild missing workspace metadata online; keep existing file bytes.
          for (const sheet of marker.sheets) {
            if (stopped) return;
            let workspace = await store.readSnapshot<WorkspaceSnapshot>(`workspace:${sheet}`);
            if (!workspace && setsSnapshot.online) {
              if (!filesChecked) {
                for (const url of marker.urls) {
                  if (stopped) return;
                  if (!(await store.readAsset(url))?.size) continue sets;
                }
                filesChecked = true;
              }
              workspace = await utils.client.drawingsWorkspace.get.query({ sheetId: sheet });
              if (stopped) return;
              await store.saveSnapshot(`workspace:${sheet}`, workspace);
            }
            const source = workspace?.jobSheets?.find(s => s.id === workspace.metadata?.currentSourceSheetId);
            if (source) {
              const urls = await collectDrawingOfflineUrls([source.imageUrl], { includeTiles: false });
              marker.urls = [...new Set([...marker.urls, ...urls])];
            }
          }
          const verified = await verifyDrawingDownload(store, marker);
          if (stopped) return;
          if (verified) {
            found[id] = version;
            sizes[id] = verified.bytes;
            const previous = await store.readSnapshot<DownloadMarker>(`drawing-download:${id}`);
            if (JSON.stringify(previous) !== JSON.stringify(verified)) await store.saveSnapshot(`drawing-download:${id}`, verified);
          }
        } catch {
          // One unavailable set must not hide the verified downloads in other sets.
        }
      }
      if (!stopped) { setSavedSets(found); setDownloadSizes(sizes); setCheckingDownloads(false); }
    })();
    else { setSavedSets({}); setCheckingDownloads(false); }
    return () => { stopped = true; };
  }, [account, folderVersions, downloadRevision, setsSnapshot.online, sheetId, canPersistSet]);
  const refresh = async () => {
    await utils.drawings.listSets.invalidate({ jobId });
    await utils.drawingsWorkspace.list.invalidate({ jobId });
    if (setId) await utils.drawings.getSet.invalidate({ setId });
  };
  const onError = (error: { message: string }) =>
    notify(error.message, "error");
  const renameSet = api.drawings.renameSet.useMutation({
    onSuccess: refresh,
    onError,
  });
  const deleteSet = api.drawings.deleteSet.useMutation({
    onSuccess: async () => {
      await refresh();
    },
    onError,
  });
  const deleteSheet = api.drawings.deleteSheet.useMutation({
    onSuccess: refresh,
    onError,
  });

  const sheets = useMemo(() => setData?.sheets ?? [], [setData?.sheets]);
  const sheetOrder = useDrawingSheetOrder();
  const sortedSheets = useMemo(() => sheets
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
      nonempty(a.name, bySheet.get(a.id)?.metadata.number ?? "").localeCompare(
        nonempty(b.name, bySheet.get(b.id)?.metadata.number ?? ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      ),
    ), [sheets, bySheet, query, discipline, status, favoritesOnly]);
  const visibleSheets = sheetOrder.sortSheets(sortedSheets);
  const openSheetFromList = (id: string) => {
    // The tutorial practises on real screens without touching device data.
    if (!sandbox) recordDrawingSheetOpen(id);
    openSheet(id);
  };
  const downloadSingleSet = async (targetId: string) => {
    if (!account?.store || !targetId) return;
    const currentFolder = setsData?.sets.find(folder => folder.id === targetId);
    if (currentFolder && savedSets[targetId] === (currentFolder.downloadVersion ?? `${new Date(currentFolder.updatedAt).toISOString()}:${currentFolder.sheetCount}`)) return;
    const store = account.store;
    const protection = requestPersistentDeviceStorage();
    drawingDownloadQueue.enqueue({ id: `${account.accountKey}:set:${targetId}`, account: account.accountKey, label: currentFolder?.name ?? "Drawing set" }, async (signal, setDownload) => {
      const target = await utils.drawings.getSet.fetch({ setId: targetId });
      const folder = setsData?.sets.find(item => item.id === targetId);
      const version = target.downloadVersion ?? `${folder ? new Date(folder.updatedAt).toISOString() : "unknown"}:${target.sheets.length}`;
      const sheets = target.sheets;
      // Request protection against automatic browser eviction where supported.
      const storageProtected = await protection;
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const existing = await store.summary();
      const budgetBytes = estimate?.quota
        ? existing.bytes + Math.floor(Math.max(0, estimate.quota - (estimate.usage ?? 0)) * 0.9)
        : 2 * 1024 * 1024 * 1024;
      await warmDrawingPdfRuntime({ signal });
      const workspaces: WorkspaceSnapshot[] = [];
      const images = new Set(sheets.map((item) => item.imageUrl));
      for (const item of sheets) {
        signal.throwIfAborted();
        setDownload(
          `Preparing drawing ${workspaces.length + 1} of ${sheets.length}…`,
        );
        const workspace = await utils.client.drawingsWorkspace.get.query({
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
        signal,
      });
      await store.saveAssets(urls, {
        budgetBytes,
        signal,
        onProgress: (p) =>
          setDownload(
            `${p.completed}/${p.total} files · ${(p.bytes / 1048576).toFixed(1)} MB`,
          ),
      });
      if (instantMetadata.canPersistSet(target)) await store.saveSnapshot(`drawing-set:${targetId}`, target);
      if (setsData && instantMetadata.canPersistSets(setsData))
        await store.saveSnapshot(`drawing-sets:${jobId}`, setsData);
      if (summarySnapshot.data)
        await store.saveSnapshot(
          `drawing-index:${jobId}`,
          summarySnapshot.data,
        );
      for (const workspace of workspaces) {
        signal.throwIfAborted();
        await store.saveSnapshot(
          `workspace:${workspace.sheetId}`,
          workspace,
        );
      }
      signal.throwIfAborted();
      const verified = await verifyDrawingDownload(store, { version, urls, sheets: workspaces.map(workspace => workspace.sheetId) });
      if (!verified) throw new Error("Download verification failed. Retry to finish saving this drawing set.");
      await store.saveSnapshot(`drawing-download:${targetId}`, verified);
      notify(storageProtected ? "Drawing set downloaded on this device for offline viewing." : "Drawing set downloaded. This browser did not grant persistent storage, so the device may clear it when space is needed.", "success");
    });
  };
  const sheetIndex = sheets.findIndex((sheet) => sheet.id === sheetId);
  const sheet = sheetIndex >= 0 ? sheets[sheetIndex] : null;
  useRootFlag("data-drawing-quick-wheel-page", quickWheel && Boolean(sheet));
  const downloadFolder = async (targetId = setId) => {
    if (!targetId) return;
    for (const folder of drawingFolderDownloadSets(setsData?.sets ?? [], targetId)) await downloadSingleSet(folder.id);
  };
  const folderSaved = (id: string) => {
    const targets = drawingFolderDownloadSets(setsData?.sets ?? [], id);
    return targets.length > 0 && targets.every(folder => savedSets[folder.id] === (folder.downloadVersion ?? `${new Date(folder.updatedAt).toISOString()}:${folder.sheetCount}`));
  };
  const folderDownloadBytes = (id: string) => drawingFolderDownloadSets(setsData?.sets ?? [], id).reduce((total, folder) => total + (downloadSizes[folder.id] ?? 0), 0);
  const cancelFolderDownload = (id: string) => {
    for (const folder of drawingFolderDownloadSets(setsData?.sets ?? [], id)) drawingDownloadQueue.cancel(`${account?.accountKey}:set:${folder.id}`);
  };

  const flags = setId ? setData : setsData;
  const canUpload =
    !sandbox &&
    setSnapshot.online &&
    Boolean(permissions.canUpload ?? flags?.canUpload ?? flags?.canManage);
  const canDelete =
    !sandbox &&
    setSnapshot.online &&
    Boolean(permissions.canDelete ?? flags?.canDelete ?? flags?.canManage);

  const createSet = useCreateDrawingSet({
    jobId, parentId: setId, viewId: JSON.stringify([sheetId, nameDialogGeneration]), enabled: canUpload,
    onStart: () => setNameDialog(null),
    onRefused: name => { setNameDraft(name); setNameDialog({ kind: "new-set" }); },
    onCreated: id => setSetId(id),
  });

  // Speculation must never race the selected sheet's PDF and tool workspace.
  const neighbours = sheet
    ? [sheets[sheetIndex + 1], sheets[sheetIndex - 1]]
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map(({ id, imageUrl }) => ({ id, imageUrl }))
    : [];
  const neighbourKey = JSON.stringify(neighbours);
  useEffect(() => {
    if (!sheetId || readySheet !== sheetId || sandbox || !setSnapshot.online) return;
    const controller = new AbortController();
    const cancel = scheduleBackgroundWork(`drawing-neighbours:${jobId}`, async () => {
      const targets = JSON.parse(neighbourKey) as Array<{ id: string; imageUrl: string }>;
      for (const target of targets) {
        if (controller.signal.aborted || !canWarmInBackground()) return;
        await prefetchWorkspace(target.id, controller.signal);
        if (controller.signal.aborted || !canWarmInBackground()) return;
        const response = await fetch(target.imageUrl, { signal: controller.signal, credentials: "same-origin" });
        if (response.ok) await response.blob();
      }
    });
    return () => { cancel(); controller.abort(); };
  }, [sheetId, readySheet, neighbourKey, sandbox, setSnapshot.online, jobId]);

  // The app bar back arrow steps out of a sheet, then out of a folder.
  useHeaderBackOverride(
    full.fullscreen
      ? full.exit
      : sheetId
        ? () => openSheet(null)
        : setId
          ? () => setSetId(setsData?.sets.find(folder => folder.id === setId)?.parentId ?? null)
          : null,
  );

  const openNameDialog = (dialog: NameDialog) => {
    setNameDialogGeneration(value => value + 1);
    setNameDialog(dialog);
    setNameDraft(dialog.kind === "new-set" ? "" : dialog.name);
  };
  const saveName = () => {
    const name = nameDraft.trim();
    if (!nameDialog || !name) return;
    if (nameDialog.kind === "new-set") { createSet.create(name); return; }
    else if (nameDialog.kind === "rename-set")
      renameSet.mutate({ setId: nameDialog.id, name });
    else renameSheet.mutate({ sheetId: nameDialog.id, name }, setData);
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

  const revisionDialog = <BulkDrawingRevisions jobId={jobId} open={revisionsOpen} onOpenChange={setRevisionsOpen} onComplete={async () => { await utils.drawingsWorkspace.get.invalidate(); await refresh(); }} />;
  const moveDialogView = (
    <Dialog open={!!moving} onOpenChange={open => { if (!open && !moveSet.isPending) setMoving(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Move {moving?.name}</DialogTitle><DialogDescription>Move this drawing set or folder, including its drawings and subfolders.</DialogDescription></DialogHeader>
        <label className="space-y-2"><span className="text-sm font-medium">Destination folder</span>
          <select aria-label="Destination folder" className="bg-background w-full rounded-md border p-3" value={moveDestination} onChange={event => setMoveDestination(event.target.value)} disabled={moveSet.isPending}>
            <option value="">Drawings — top level</option>
            {drawingMoveTargets(setsData?.sets ?? [], moving?.id ?? "").map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
          </select>
        </label>
        <DialogFooter><Button variant="outline" disabled={moveSet.isPending} onClick={() => setMoving(null)}>Cancel</Button><Button disabled={!moving || moveSet.isPending || moveDestination === (moving.parentId ?? "")} onClick={() => { if (moving) moveSet.mutate({ setId: moving.id, parentId: moveDestination || null }, setsData); }}>{moveSet.isPending ? "Moving…" : "Move here"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
  const nameDialogView = (
    <>
    {createSet.pendingName && <p role="status" className="my-3 text-sm">Creating folder “{createSet.pendingName}”…</p>}
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
            {nameDialog?.kind === "new-set" && createSet.error && <p role="alert" className="text-destructive text-sm">{createSet.error}</p>}
            <Button type="submit" disabled={!nameDraft.trim() || (nameDialog?.kind === "new-set" && createSet.isPending)}>
              {nameDialog?.kind === "new-set" ? "Create folder" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );

  // Sheet viewer: full screen under the app bar.
  if (sheet) {
    return (
      <div
        ref={full.surface}
        data-drawing-fullscreen={full.fullscreen}
        data-drawing-quick-wheel={quickWheel}
        className={`bg-background fixed flex flex-col ${full.fullscreen ? "inset-0 z-[60]" : "inset-x-0 app-below-header bottom-0 z-30"}`}
      >
        {full.fullscreen && (
          <Button
            ref={full.exitButton}
            type="button"
            variant="outline"
            aria-label="Exit full screen"
            title="Exit full screen (Esc)"
            className="drawing-corner-control bg-background/60 border-border/60 hover:bg-background/80 absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-50 size-10 rounded-full shadow-md backdrop-blur-sm"
            onClick={full.exit}
          >
            <MinimizeIcon className="size-5" aria-hidden="true" />
          </Button>
        )}
        <div data-tutorial="drawing-view" className="relative min-h-0 flex-1">
          <DrawingWorkspace
            pageModeScope={pageModeScope}
            scrollPages={scroll}
            scrollStack={scroll ? { ...scrollNeighbors(sheets, sheetIndex), onPage: (offset, viewport) => {
              lastViewport.current = viewport;
              openSheet(sheets[sheetIndex + offset]!.id, true);
            } } : undefined}
            toolbarContainer={toolbarContainer}
            cornerContainer={cornerContainer}
            pageNavigation={{ index: sheetIndex, count: sheets.length,
              onPrevious: () => { if (sheetIndex > 0) openSheet(sheets[sheetIndex - 1]!.id, true); },
              onNext: () => { if (sheetIndex < sheets.length - 1) openSheet(sheets[sheetIndex + 1]!.id, true); },
            }}
            fullscreenRef={full.enterButton}
            fullscreen={full.fullscreen}
            onFullscreen={full.fullscreen ? full.exit : full.enter}
            key={`${sheet.id}:${destination.request}`}
            onReady={() => setReadySheet(sheet.id)}
            initialSnapshot={destination.snapshot}
            jobId={jobId}
            sheet={sheet}
            initialViewport={entryViewport}
            onViewportChange={(value) => {
              lastViewport.current = value;
              showZoomReadout(zoomLabel.current, `${Math.round(value.zoom * 100)}%`);
            }}
            onOpenSheet={(target) => {
              setSetId(target.setId);
              openSheet(target.id);
            }}
          />
          {/* Corner buttons and the side panel stay put while the pages scroll under them. */}
          <div ref={setCornerContainer} data-drawing-corners className="pointer-events-none absolute inset-0 z-20" />
          {!quickWheel && <DrawingZoomReadout key={sheet.id} zoom={lastViewport.current?.zoom ?? entryViewport?.zoom ?? 1} zoomRef={zoomLabel} />}
        </div>
        <div ref={setToolbarContainer} data-drawing-chrome className="relative z-30 shrink-0" />
        {!quickWheel && <DrawingPageNavigation
          scrollPages={scroll}
          name={sheet.name}
          title={bySheet.get(sheet.id)?.metadata.title?.trim()}
          index={sheetIndex}
          count={sheets.length}
          onPrevious={() => openSheet(sheets[sheetIndex - 1]!.id, true)}
          onNext={() => openSheet(sheets[sheetIndex + 1]!.id, true)}
        />}
        {moveDialogView}
      {nameDialogView}
        {revisionDialog}
      </div>
    );
  }

  // Folders.
  const folders = (setsData?.sets ?? []).filter(folder => (folder.parentId ?? null) === setId);
  const orderedFolders = folderOrder.sortFolders(folders);
  const folderSummaries = new Map(folders.map(folder => [folder.id, drawingFolderSummary(setsData?.sets ?? [], folder.id)]));
  const openFolder = (id: string) => {
    if (!sandbox) recordDrawingFolderOpen(id);
    setSetId(id);
  };
  const newFolderButton = (
    className: string,
    size: "default" | "lg" = "lg",
  ) => (
    <Button
      size={size}
      className={className}
      disabled={!canUpload || createSet.isPending}
      onClick={() => openNameDialog({ kind: "new-set" })}
    >
      <FolderPlusIcon className="mr-2 h-5 w-5" />
      New folder
    </Button>
  );
  const folderGrid = (
    <div className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedFolders.map((folder) => (
            <PressableCard
              key={folder.id}
              data-tutorial="drawing-folder"
              role="button"
              tabIndex={0}
              aria-label={`Open ${folder.name}`}
              className="card-lift cursor-pointer gap-0 overflow-hidden py-0"
              onClick={() => openFolder(folder.id)}
            >
              <div className="relative">
              {folderSummaries.get(folder.id)?.coverImageUrl ? (
                <DrawingThumbnail
                  src={folderSummaries.get(folder.id)!.coverImageUrl!}
                  alt=""
                  loading="lazy"
                  className="bg-muted aspect-[16/9] w-full border-b object-contain"
                />
              ) : (
                <div className="bg-muted text-muted-foreground/60 flex aspect-[16/9] w-full items-center justify-center border-b">
                  <FolderIcon className="h-12 w-12" />
                </div>
              )}
              {folderSummaries.get(folder.id)?.hasSubfolders && <span className="bg-background/90 absolute bottom-3 left-3 rounded-md border p-2 shadow-sm" aria-label="Contains subfolders"><FolderIcon className="h-5 w-5" /></span>}
              </div>
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
                      {canUpload && (
                        <DropdownMenuItem onSelect={() => { setMoving({ id: folder.id, name: folder.name, parentId: folder.parentId ?? null }); setMoveDestination(folder.parentId ?? ""); }}>
                          <FolderIcon className="h-4 w-4" />Move
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
                {folderSummaries.get(folder.id)!.count}{" "}
                {folderSummaries.get(folder.id)!.count === 1 ? "drawing" : "drawings"}
                <div className="mt-3" onClick={event => event.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!account?.store || !setsSnapshot.online || !folderSummaries.get(folder.id)!.count || folderSaved(folder.id)}
                    aria-label={Boolean(activeDownload(folder.id)) ? `Cancel download of ${folder.name}` : folderSaved(folder.id) ? `${folder.name} downloaded` : `Download ${folder.name} for offline use`}
                    onClick={() => Boolean(activeDownload(folder.id)) ? cancelFolderDownload(folder.id) : void downloadFolder(folder.id)}
                  >
                    {Boolean(activeDownload(folder.id)) ? <Loader2Icon className="h-4 w-4 animate-spin" /> : folderSaved(folder.id) ? <CheckIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
                    {Boolean(activeDownload(folder.id)) ? "Cancel download" : folderSaved(folder.id) ? `Saved · ${(folderDownloadBytes(folder.id) / 1048576).toFixed(1)} MB` : checkingDownloads ? "Checking…" : "Download / repair"}
                  </Button>
                  {Boolean(activeDownload(folder.id)) && <p role="status" className="mt-2 text-xs">{activeDownload(folder.id)?.progress}</p>}
                </div>
              </CardContent>
            </PressableCard>
          ))}
        </div>
    </div>
  );

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
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-xl font-semibold sm:text-2xl">
              {setData?.set.name ?? "Drawings"}
            </h2>
            {sheets.length > 0 && (
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                {sheets.length} {sheets.length === 1 ? "drawing" : "drawings"}
              </p>
            )}
          </div>
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
        {set.error && setSnapshot.online && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {set.error.message}
          </p>
        )}
        {folders.length > 0 && <section aria-label="Subfolders" className="mb-6">{folderGrid}</section>}
        {uploading && (
          <p role="status" className="text-muted-foreground mb-4 text-sm">
            Uploading {uploading}. Each page becomes its own drawing; large sets
            can take a few minutes.
          </p>
        )}
        {set.isLoading && !setData ? (
          <div role="status" aria-label="Loading drawings" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        ) : sheets.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                art="blueprint"
                title="No drawings yet. Upload a PDF and each page becomes a drawing."
                action={canUpload && uploadButton("", "default")}
              />
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
              <PressableCard
                key={item.id}
                data-tutorial="drawing-sheet"
                role="button"
                tabIndex={0}
                aria-label={`Open ${nonempty(item.name, bySheet.get(item.id)?.metadata.number ?? "")}`}
                className={
                  listView
                    ? "relative flex cursor-pointer flex-row gap-0 rounded-none border-0 border-b py-0 shadow-none"
                    : "card-lift relative cursor-pointer gap-0 overflow-hidden py-0"
                }
                onClick={() => openSheetFromList(item.id)}
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
                <div className={`flex min-w-0 flex-1 items-center gap-0 py-2 ${listView ? "pl-3 pr-14" : "pr-1.5 pl-3"}`}>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {nonempty(
                        item.name,
                        bySheet.get(item.id)?.metadata.number ?? "",
                      )}
                    </span>
                    <span className="text-muted-foreground block min-h-4 truncate text-xs">
                      {bySheet.get(item.id)?.metadata.title?.trim()}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-full"
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
                  <SheetOfflineButton iconOnly sheet={item} prepare={async (signal) => {
                    const workspace = await utils.client.drawingsWorkspace.get.query({ sheetId: item.id });
                    signal.throwIfAborted();
                    await account?.store?.saveSnapshot(`workspace:${item.id}`, workspace);
                    if (setData && instantMetadata.canPersistSet(setData)) await account?.store?.saveSnapshot(`drawing-set:${setId}`, setData);
                    if (setsData && instantMetadata.canPersistSets(setsData)) await account?.store?.saveSnapshot(`drawing-sets:${jobId}`, setsData);
                    if (summarySnapshot.data) await account?.store?.saveSnapshot(`drawing-index:${jobId}`, summarySnapshot.data);
                    const current = workspace.jobSheets.find(source => source.id === workspace.metadata.currentSourceSheetId);
                    return current ? [current.imageUrl] : [];
                  }} />
                  {(canUpload || canDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="bg-background/75 text-foreground hover:bg-background absolute top-2 right-2 z-10 size-8 shrink-0 rounded-full shadow-sm backdrop-blur-sm"
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
              </PressableCard>
            ))}
          </div>
        )}
        {/* Bottom bar like Add Parts: filters menu, search, add drawings. */}
        <div className="bg-card fixed inset-x-0 bottom-0 z-40 pin-viewport-bottom border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6">
          <PriorityActionBar
            className="mx-auto max-w-6xl"
            search={{
              value: query,
              onChange: setQuery,
              label: "Search drawings",
              placeholder: "Search drawings",
            }}
          >
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
                <DropdownMenuLabel>Sort</DropdownMenuLabel>
                <div
                  role="radiogroup"
                  aria-label="Drawing order"
                  className="bg-muted mx-1 mb-1 grid grid-cols-2 gap-1 rounded-lg p-1"
                >
                  {(
                    [
                      ["az", "Alphabetical"],
                      ["used", "Most used"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={sheetOrder.order === value}
                      className={`h-8 rounded-md px-2 text-xs font-medium transition-colors ${sheetOrder.order === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                      onClick={() => sheetOrder.setOrder(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <DropdownMenuSeparator />
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
                {canUpload && (
                  <DropdownMenuSeparator />
                )}
                {canUpload && <DropdownMenuItem onSelect={() => setRevisionsOpen(true)}><UploadIcon className="h-4 w-4" />Upload revised drawings</DropdownMenuItem>}
                {canUpload && sheets.length > 0 && (
                  <DropdownMenuItem onSelect={() => setRegisterOpen(true)}>
                    <FileTextIcon className="h-4 w-4" />
                    Read title blocks
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {canUpload && newFolderButton(BAR_BUTTON, "default")}
            {canUpload && <Button
              className={BAR_BUTTON}
              disabled={uploading !== null}
              title={
                canUpload
                  ? "Upload a PDF; each page becomes a drawing"
                  : "You can't add drawings"
              }
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? (
                <Loader2Icon className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <UploadIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              )}
              {uploading ? "Adding…" : "Add Drawings"}
            </Button>}
          </PriorityActionBar>
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
        {moveDialogView}
      {nameDialogView}
        {revisionDialog}
      </div>
    );
  }

  return (
    <div className="pb-24">
      <PageHeader
        level="section"
        title="Drawings"
        className="flex-row items-center justify-between sm:items-center"
        actions={
          <div className="flex shrink-0 items-center gap-2">
            {canUpload && folders.length > 0 && (
              <div className="hidden gap-2 sm:flex">
                {newFolderButton("h-11")}
                <Button
                  className="h-11"
                  variant="outline"
                  onClick={() => setRevisionsOpen(true)}
                >
                  Upload revised drawings
                </Button>
              </div>
            )}
            {folders.length > 1 && (
              <div
                role="radiogroup"
                aria-label="Folder order"
                className="border-border bg-card flex h-10 shrink-0 items-center gap-1 rounded-lg border p-1"
              >
                {(
                  [
                    ["used", "Most used"],
                    ["az", "A–Z"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={folderOrder.order === value}
                    variant={folderOrder.order === value ? "default" : "ghost"}
                    size="sm"
                    className={`h-8 px-2.5 text-xs ${folderOrder.order === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    onClick={() => folderOrder.setOrder(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        }
      />
      {sets.isLoading && !setsData ? (
        <div role="status" aria-label="Loading drawings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              art="folder"
              title="No drawing folders yet. Make one for each set, like Mechanical."
              action={canUpload && newFolderButton("", "default")}
            />
          </CardContent>
        </Card>
      ) : (
        folderGrid
      )}
      {canUpload && (
        <div className={BOTTOM_BAR}><div className="mx-auto flex max-w-6xl gap-2">{newFolderButton("h-12 min-w-0 flex-1 whitespace-normal px-2 text-xs")}<Button className="h-12 min-w-0 flex-1 whitespace-normal px-2 text-xs" variant="outline" onClick={() => setRevisionsOpen(true)}>Upload revised drawings</Button></div></div>
      )}
      {moveDialogView}
      {nameDialogView}
      {revisionDialog}
    </div>
  );
}

