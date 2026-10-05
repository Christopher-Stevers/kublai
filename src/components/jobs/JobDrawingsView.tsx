"use client";

import { useRef, useState } from "react";
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
} from "lucide-react";

import { api } from "~/trpc/react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { sourcePdfPage } from "~/lib/pdf-client";
import { uploadDrawings } from "~/lib/upload-drawings";
import { DrawingSheetViewer } from "./DrawingSheetViewer";

type NameDialog =
  | { kind: "new-set" }
  | { kind: "rename-set"; id: string; name: string }
  | { kind: "rename-sheet"; id: string; name: string };

const BOTTOM_BAR =
  "bg-background fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden";

/**
 * Drawings for a job: folders of drawing sheets. Uploading a PDF into a folder
 * splits it into one sheet per page. Sheets are only viewed (no room detection).
 */
export function JobDrawingsView({ jobId }: { jobId: string }) {
  const sandbox = useTutorialSandbox();
  const utils = api.useUtils();
  const [setId, setSetId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const sets = api.drawings.listSets.useQuery({ jobId }, { enabled: !sandbox });
  const set = api.drawings.getSet.useQuery(
    { setId: setId ?? "" },
    { enabled: !sandbox && Boolean(setId) },
  );
  const refresh = async () => {
    await utils.drawings.listSets.invalidate({ jobId });
    if (setId) await utils.drawings.getSet.invalidate({ setId });
  };
  const onError = (error: { message: string }) => notify(error.message, "error");
  const createSet = api.drawings.createSet.useMutation({
    onSuccess: async (result) => {
      await refresh();
      setSetId(result.id);
    },
    onError,
  });
  const renameSet = api.drawings.renameSet.useMutation({ onSuccess: refresh, onError });
  const deleteSet = api.drawings.deleteSet.useMutation({
    onSuccess: async () => {
      setSetId(null);
      await refresh();
    },
    onError,
  });
  const renameSheet = api.drawings.renameSheet.useMutation({ onSuccess: refresh, onError });
  const deleteSheet = api.drawings.deleteSheet.useMutation({ onSuccess: refresh, onError });

  const sheets = set.data?.sheets ?? [];
  const sheetIndex = sheets.findIndex((sheet) => sheet.id === sheetId);
  const sheet = sheetIndex >= 0 ? sheets[sheetIndex] : null;
  const canManage = !sandbox && Boolean(setId ? set.data?.canManage : sets.data?.canManage);

  // The app bar back arrow steps out of a sheet, then out of a folder.
  useHeaderBackOverride(
    sheetId ? () => setSheetId(null) : setId ? () => setSetId(null) : null,
  );

  const openNameDialog = (dialog: NameDialog) => {
    setNameDialog(dialog);
    setNameDraft(dialog.kind === "new-set" ? "" : dialog.name);
  };
  const saveName = () => {
    const name = nameDraft.trim();
    if (!nameDialog || !name) return;
    if (nameDialog.kind === "new-set") createSet.mutate({ jobId, name });
    else if (nameDialog.kind === "rename-set") renameSet.mutate({ setId: nameDialog.id, name });
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
    <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
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
            placeholder={nameDialog?.kind === "new-set" ? "e.g. Mechanical" : undefined}
            onChange={(event) => setNameDraft(event.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
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
      <div className="bg-background fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col sm:top-16">
        <div className="relative min-h-0 flex-1">
          <DrawingSheetViewer
            key={sheet.id}
            src={sheet.imageUrl}
            alt={sheet.name}
            pdf={sourcePdfPage(sheet.imageUrl)}
          />
          <span className="bg-card/90 pointer-events-none absolute top-2 left-2 rounded-md px-2 py-1 text-xs font-semibold shadow-sm">
            {sheet.name}
          </span>
        </div>
        <div className="bg-card shrink-0 border-t px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Button
              variant="outline"
              className="h-10"
              disabled={sheetIndex <= 0}
              onClick={() => setSheetId(sheets[sheetIndex - 1]!.id)}
            >
              <ChevronLeftIcon className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {sheetIndex + 1} of {sheets.length}
            </span>
            <Button
              variant="outline"
              className="h-10"
              disabled={sheetIndex >= sheets.length - 1}
              onClick={() => setSheetId(sheets[sheetIndex + 1]!.id)}
            >
              Next
              <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Inside a folder: its sheets.
  if (setId) {
    const uploadButton = (className: string, size: "default" | "lg" = "lg") => (
      <Button
        size={size}
        className={className}
        disabled={!canManage || uploading !== null}
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
            {set.data?.set.name ?? "Drawings"}
          </h2>
          {canManage && uploadButton("hidden h-11 sm:inline-flex")}
        </div>
        {uploading && (
          <p role="status" className="text-muted-foreground mb-4 text-sm">
            Uploading {uploading}. Each page becomes its own drawing; large sets can take a few minutes.
          </p>
        )}
        {set.isLoading ? (
          <p role="status" className="text-muted-foreground text-sm">Loading drawings…</p>
        ) : sheets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileTextIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
              <h3 className="mb-2 text-lg font-semibold">No drawings yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Upload a PDF. Each page becomes its own drawing in this folder.
              </p>
              {canManage && uploadButton("", "default")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {sheets.map((item) => (
              <Card
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Open ${item.name}`}
                className="cursor-pointer gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md"
                onClick={() => setSheetId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSheetId(item.id);
                  }
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="bg-muted aspect-[4/3] w-full border-b object-contain"
                />
                <div className="flex items-center gap-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                  {canManage && (
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
                      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenuItem
                          onSelect={() => openNameDialog({ kind: "rename-sheet", id: item.id, name: item.name })}
                        >
                          <PencilIcon className="h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={async () => {
                            if (
                              await confirmAction({
                                title: `Delete ${item.name}?`,
                                description: "This drawing will be removed from the folder.",
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        {canManage && <div className={BOTTOM_BAR}>{uploadButton("h-12 w-full")}</div>}
        {nameDialogView}
      </div>
    );
  }

  // Folders.
  const folders = sets.data?.sets ?? [];
  const newFolderButton = (className: string, size: "default" | "lg" = "lg") => (
    <Button
      size={size}
      className={className}
      disabled={!canManage}
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
        {canManage && folders.length > 0 && newFolderButton("hidden h-11 sm:inline-flex")}
      </div>
      {sandbox ? (
        <p className="text-muted-foreground text-sm">Drawings aren&apos;t part of the practice job.</p>
      ) : sets.isLoading ? (
        <p role="status" className="text-muted-foreground text-sm">Loading drawings…</p>
      ) : folders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
            <h3 className="mb-2 text-lg font-semibold">No drawing folders yet</h3>
            <p className="text-muted-foreground mb-4 text-center">
              Create a folder for each drawing set, like Mechanical or Electrical.
            </p>
            {canManage && newFolderButton("", "default")}
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
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSetId(folder.id);
                }
              }}
            >
              {folder.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
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
                <CardTitle className="min-w-0 leading-tight break-words">{folder.name}</CardTitle>
                {canManage && (
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
                    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenuItem
                        onSelect={() => openNameDialog({ kind: "rename-set", id: folder.id, name: folder.name })}
                      >
                        <PencilIcon className="h-4 w-4" />
                        Rename folder
                      </DropdownMenuItem>
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardHeader>
              <CardContent className="text-muted-foreground px-4 pt-1 pb-4 text-sm">
                {folder.sheetCount} {folder.sheetCount === 1 ? "drawing" : "drawings"}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage && <div className={BOTTOM_BAR}>{newFolderButton("h-12 w-full")}</div>}
      {nameDialogView}
    </div>
  );
}
