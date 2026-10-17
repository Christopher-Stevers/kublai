"use client";
import { DrawingPageModeSetting } from "./DrawingPageMode";
import { usePageViewState } from "~/hooks/use-page-view-state";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentSnapshotState } from "~/lib/snapshot-source";
import {
  ChevronRightIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  FolderIcon,
  FolderPlusIcon,
  DownloadIcon,
  LinkIcon,
  Loader2Icon,
  LockIcon,
  MoreVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
  UploadIcon,
  WifiOffIcon,
} from "lucide-react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import type {
  DocumentAction,
  DocumentOverview,
  DocumentRole,
  DocumentStatus,
  DocumentTransmittal,
  FolderPermission,
  JobDocument,
} from "~/server/documents/types";
import { SubmittalsView } from "./documents/SubmittalsView";
import { defaultSubmittal } from "~/lib/submittals";
import {
  DocumentEditor,
  type EditorAvailability,
} from "./documents/DocumentEditor";
import {
  DocumentDetails,
  type DocumentDialogKind,
} from "./documents/DocumentDetails";
import {
  DocumentIcon,
  documentKind,
  formatBytes,
  formatDate,
  memberName,
  selectClass,
  StatusBadge,
  statusLabels,
  textareaClass,
  versionUrl,
} from "./documents/document-ui";

type View = "submittals" | "files" | "reviews" | "transmittals" | "recycle";
type Modal = {
  kind:
    | "folder"
    | "rename-folder"
    | "permissions"
    | "office"
    | "new-word"
    | "new-spreadsheet"
    | DocumentDialogKind
    | "resolve";
  documentIds?: string[];
  folderId?: string;
  reviewId?: string;
};
type Draft = {
  name: string;
  description: string;
  tags: string;
  status: DocumentStatus;
  folderId: string;
  webUrl: string;
  reviewerId: string;
  recipients: string[];
  decision: "approved" | "changes_requested";
  permissions: FolderPermission[];
};
const emptyDraft: Draft = {
  name: "",
  description: "",
  tags: "",
  status: "draft",
  folderId: "",
  webUrl: "",
  reviewerId: "",
  recipients: [],
  decision: "approved",
  permissions: [],
};
const blankOverview: DocumentOverview = {
  schemaVersion: 1,
  folders: [],
  documents: [],
  versions: [],
  comments: [],
  activity: [],
  reviews: [],
  transmittals: [],
  members: [],
  capabilities: { canManage: false, canWrite: false, userId: "" },
  office: { mode: "linked", embeddedConfigured: false },
};

async function responseBody<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!response.ok)
    throw new Error(
      body?.error ??
        body?.message ??
        `Request failed (${response.status}). Please try again.`,
    );
  if (!body)
    throw new Error("The server returned an empty response. Please try again.");
  return body as T;
}

function downloadManifest(transmittal: DocumentTransmittal, jobId: string) {
  const manifest = {
    jobId,
    ...transmittal,
    documents: transmittal.documents.map((snapshot) => ({
      ...snapshot,
      downloadUrl: snapshot.versionId
        ? new URL(
            versionUrl(jobId, snapshot.versionId, true),
            window.location.origin,
          ).href
        : null,
    })),
  };
  const objectUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
  );
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = `transmittal-${transmittal.title.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || transmittal.id}.json`;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function JobDocumentsView({
  jobId,
  sandbox: sandboxProp = false,
}: {
  jobId: string;
  sandbox?: boolean;
}) {
  const tutorialSandbox = useTutorialSandbox();
  const sandbox = sandboxProp || Boolean(tutorialSandbox);
  const [data, setData] = useState<DocumentOverview>(blankOverview);
  const [loading, setLoading] = useState(!sandbox);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = usePageViewState<View>(
    `documents:${jobId}:view`,
    "files",
  );
  const [folderId, setFolderId] = usePageViewState<string | null>(
    `documents:${jobId}:folderId`,
    null,
  );
  const [selectedId, setSelectedId] = usePageViewState<string | null>(
    `documents:${jobId}:selectedId`,
    null,
  );
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = usePageViewState(`documents:${jobId}:query`, "");
  const [status, setStatus] = usePageViewState(`documents:${jobId}:status`, "");
  const [kind, setKind] = usePageViewState(`documents:${jobId}:kind`, "");
  const [modal, setModal] = useState<Modal | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [modalError, setModalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editorStatus, setEditorStatus] = useState<EditorAvailability | null>(
    null,
  );
  const [editorDocument, setEditorDocument] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAsSubmittal = useRef(false);
  const uploadMutex = useRef(false);
  const uploadTarget = useRef<JobDocument | null>(null);
  const requestNumber = useRef(0);
  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => {
      uploadTarget.current = null;
      uploadAsSubmittal.current = false;
    };
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, []);
  const loadedJobId = useRef<string | null>(null);
  const openedDocumentLink = useRef<string | null>(null);
  const openedOfficeSnapshot = useRef(false);
  const mutable = !sandbox && !offline;
  const currentFolder = data.folders.find((item) => item.id === folderId);
  const canWrite =
    mutable &&
    (currentFolder
      ? Boolean(currentFolder.canWrite)
      : data.capabilities.canWrite);
  const canManage =
    mutable &&
    (currentFolder
      ? Boolean(currentFolder.canManage)
      : data.capabilities.canManage);
  const selected = data.documents.find((item) => item.id === selectedId);
  useEffect(() => {
    if (loading || error || sandbox || loadedJobId.current !== jobId) return;
    const id = new URLSearchParams(window.location.search).get("document");
    const request = `${jobId}:${id ?? ""}`;
    if (!id || openedDocumentLink.current === request) return;
    openedDocumentLink.current = request;
    const document = data.documents.find(
      (item) => item.id === id && !item.deletedAt,
    );
    if (!document) {
      setError("This document is unavailable or you do not have access to it.");
      return;
    }
    setFolderId(document.folderId);
    setView("files");
    setSelectedId(id);
  }, [data.documents, loading, error, jobId, sandbox]);
  useEffect(() => {
    if (
      openedOfficeSnapshot.current ||
      sandbox ||
      offline ||
      !editorStatus?.configured ||
      !selected
    )
      return;
    const saved = currentSnapshotState()?.document;
    if (
      saved?.viewer !== "office" ||
      saved.jobId !== jobId ||
      saved.documentId !== selected.id ||
      saved.versionId !== selected.currentVersionId
    )
      return;
    openedOfficeSnapshot.current = true;
    setEditorDocument({ id: selected.id, name: selected.name });
  }, [selected, editorStatus, jobId, offline, sandbox]);
  const processing = busy || Boolean(uploading);
  const endpoint = `/api/job-documents?jobId=${encodeURIComponent(jobId)}`;

  const refresh = useCallback(async () => {
    if (sandbox) return;
    const number = ++requestNumber.current;
    const response = await fetch(
      `/api/job-documents?jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    const result = await responseBody<DocumentOverview>(response);
    if (number === requestNumber.current) {
      loadedJobId.current = jobId;
      setData(result);
      setError(null);
    }
  }, [jobId, sandbox]);

  useEffect(() => {
    if (sandbox) return;
    const controller = new AbortController();
    void fetch(`/api/job-documents/editor?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(responseBody<EditorAvailability>)
      .then((result) => {
        if (!controller.signal.aborted)
          setEditorStatus({
            ...result,
            configured: result.configured === true,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setEditorStatus({
            configured: false,
            provider: "collabora",
            reason: "The editing service status could not be checked.",
          });
      });
    return () => controller.abort();
  }, [jobId, sandbox]);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (sandbox) {
      setData(blankOverview);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void refresh()
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load documents.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      // Invalidate asynchronous responses; this counter is not a DOM reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestNumber.current;
    };
  }, [refresh, sandbox]);

  useHeaderBackOverride(
    editorDocument
      ? null
      : selectedId
        ? () => setSelectedId(null)
        : folderId
          ? () => setFolderId(currentFolder?.parentId ?? null)
          : view !== "files"
            ? () => setView("files")
            : null,
  );

  const mutate = async (action: DocumentAction) => {
    if (!mutable || processing) return false;
    setBusy(true);
    setModalError(null);
    try {
      await responseBody(
        await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, ...action }),
        }),
      );
      await refresh().catch((reason: unknown) => {
        const message =
          reason instanceof Error
            ? reason.message
            : "Could not refresh documents.";
        setError(
          `Your change was saved, but the list could not refresh: ${message}`,
        );
      });
      return true;
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "The change could not be saved.";
      setModalError(message);
      notify(message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: File[]) => {
    if (!mutable || processing || uploadMutex.current || !files.length) return;
    const target = uploadTarget.current;
    if (
      target
        ? !target.canWrite || target.officeWebUrl || target.deletedAt
        : uploadAsSubmittal.current
          ? !data.capabilities.canWrite
          : !canWrite
    )
      return;
    uploadMutex.current = true;
    const asSubmittal = uploadAsSubmittal.current;
    let uploaded = 0;
    const failures: string[] = [];
    setError(null);
    try {
      const queue = target ? files.slice(0, 1) : files;
      for (const [index, file] of queue.entries()) {
        try {
          if ((asSubmittal || target?.submittal) && !/\.pdf$/i.test(file.name))
            throw new Error("Choose a PDF file for submittals.");
          if (!file.size || file.size > 50 * 1024 * 1024)
            throw new Error("Upload a nonempty file up to 50 MB.");
          setUploading(
            asSubmittal
              ? `${file.name} (${index + 1} of ${queue.length})`
              : file.name,
          );
          const body = new FormData();
          body.append("jobId", jobId);
          body.append("file", file);
          if (target) {
            body.append("documentId", target.id);
            if (target.currentVersionId)
              body.append("expectedVersionId", target.currentVersionId);
          } else if (asSubmittal)
            body.append(
              "submittal",
              JSON.stringify(defaultSubmittal(file.name)),
            );
          else if (folderId) body.append("folderId", folderId);
          await responseBody(
            await fetch(
              `/api/job-documents/upload?jobId=${encodeURIComponent(jobId)}`,
              { method: "POST", credentials: "same-origin", body },
            ),
          );
          uploaded++;
        } catch (reason) {
          if (!asSubmittal || target) throw reason;
          failures.push(
            `${file.name}: ${reason instanceof Error ? reason.message : "Upload failed."}`,
          );
        }
      }
      await refresh();
      if (failures.length) {
        const message = `${uploaded} uploaded; ${failures.length} could not upload. ${failures.join(" ")}`;
        setError(message);
        notify(message, "error");
      } else
        notify(
          `${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded.`,
          "success",
        );
    } catch (reason) {
      notify(
        `${uploaded ? `${uploaded} file(s) uploaded. ` : ""}${reason instanceof Error ? reason.message : "Upload failed."}`,
        "error",
      );
      await refresh().catch(() => undefined);
    } finally {
      uploadMutex.current = false;
      uploadAsSubmittal.current = false;
      setUploading(null);
      uploadTarget.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const pickFiles = (target: JobDocument | null = null) => {
    uploadTarget.current = target;
    uploadAsSubmittal.current = !target && view === "submittals";
    if (fileInput.current) {
      fileInput.current.multiple = !target;
      fileInput.current.accept =
        uploadAsSubmittal.current || target?.submittal
          ? ".pdf,application/pdf"
          : "";
      fileInput.current.click();
    }
  };
  const openModal = (next: Modal) => {
    const document = next.documentIds?.[0]
      ? data.documents.find((item) => item.id === next.documentIds![0])
      : undefined;
    const folder = next.folderId
      ? data.folders.find((item) => item.id === next.folderId)
      : undefined;
    setDraft({
      ...emptyDraft,
      ...(next.kind === "new-word"
        ? { name: "Untitled document.docx" }
        : next.kind === "new-spreadsheet"
          ? { name: "Untitled spreadsheet.xlsx" }
          : {}),
      folderId: folderId ?? "",
      ...(document
        ? {
            name: document.name,
            description: document.description,
            tags: document.tags.join(", "),
            status: document.status,
            folderId: document.folderId ?? "",
          }
        : {}),
      ...(folder
        ? {
            name: folder.name,
            permissions: folder.permissions.map((item) => ({ ...item })),
          }
        : {}),
      ...(["review", "transmittal", "resolve"].includes(next.kind)
        ? { name: "", description: "" }
        : {}),
    });
    setModalError(null);
    setModal(next);
  };
  const closeModal = () => {
    if (!busy) {
      setModal(null);
      setModalError(null);
    }
  };
  const saveModal = async () => {
    if (!modal) return;
    if (modal.kind === "new-word" || modal.kind === "new-spreadsheet") {
      if (!mutable || processing || !editorStatus?.configured) return;
      setBusy(true);
      setModalError(null);
      try {
        const result = await responseBody<{
          documentId: string;
          versionId: string;
        }>(
          await fetch("/api/job-documents/editor/new", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              folderId,
              kind: modal.kind === "new-word" ? "word" : "spreadsheet",
              name: draft.name.trim(),
            }),
          }),
        );
        await refresh().catch(() =>
          setError(
            "The document was created, but the list could not refresh. Refresh Documents after editing.",
          ),
        );
        setSelectedId(result.documentId);
        setEditorDocument({ id: result.documentId, name: draft.name.trim() });
        setModal(null);
      } catch (reason) {
        setModalError(
          reason instanceof Error
            ? reason.message
            : "The document could not be created.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const documentId = modal.documentIds?.[0];
    let action: DocumentAction | undefined;
    switch (modal.kind) {
      case "folder":
        action = {
          action: "createFolder",
          name: draft.name.trim(),
          parentId: folderId,
        };
        break;
      case "rename-folder":
        if (modal.folderId)
          action = {
            action: "updateFolder",
            folderId: modal.folderId,
            name: draft.name.trim(),
          };
        break;
      case "permissions":
        if (modal.folderId)
          action = {
            action: "setFolderPermissions",
            folderId: modal.folderId,
            permissions: draft.permissions,
          };
        break;
      case "office":
        action = {
          action: "linkOffice",
          name: draft.name.trim(),
          folderId,
          webUrl: draft.webUrl.trim(),
        };
        break;
      case "metadata":
        if (documentId)
          action = {
            action: "updateDocument",
            documentId,
            name: draft.name.trim(),
            description: draft.description.trim(),
            tags: draft.tags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            ...(data.documents.find((item) => item.id === documentId)
              ?.status !== draft.status
              ? { status: draft.status }
              : {}),
          };
        break;
      case "move":
        if (documentId)
          action = {
            action: "updateDocument",
            documentId,
            folderId: draft.folderId || null,
          };
        break;
      case "copy":
        if (documentId)
          action = {
            action: "copy",
            documentId,
            folderId: draft.folderId || null,
            name: draft.name.trim(),
          };
        break;
      case "review":
        action = {
          action: "createReview",
          documentIds: modal.documentIds ?? [],
          title: draft.name.trim(),
          reviewerId: draft.reviewerId,
        };
        break;
      case "resolve":
        if (modal.reviewId)
          action = {
            action: "resolveReview",
            reviewId: modal.reviewId,
            decision: draft.decision,
            comment: draft.description.trim(),
          };
        break;
      case "transmittal":
        action = {
          action: "createTransmittal",
          documentIds: modal.documentIds ?? [],
          title: draft.name.trim(),
          recipients: draft.recipients,
          message: draft.description.trim(),
        };
        break;
    }
    if (action && (await mutate(action))) {
      setModal(null);
      setCheckedIds([]);
      notify("Saved.", "success");
    }
  };
  const openFolder = (id: string | null) => {
    setFolderId(id);
    setView("files");
    setQuery("");
    setCheckedIds([]);
  };
  const breadcrumbs = [] as Array<{ id: string; name: string }>;
  let ancestor = currentFolder;
  const visited = new Set<string>();
  while (ancestor && !visited.has(ancestor.id)) {
    visited.add(ancestor.id);
    breadcrumbs.unshift(ancestor);
    ancestor = data.folders.find((item) => item.id === ancestor?.parentId);
  }
  const filtered = data.documents
    .filter(
      (item) =>
        (view === "recycle"
          ? Boolean(item.deletedAt)
          : !item.deletedAt && !item.submittal) &&
        (view === "recycle" || query.trim() || item.folderId === folderId) &&
        (!query.trim() ||
          `${item.name} ${item.description} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())) &&
        (!status || item.status === status) &&
        (!kind || documentKind(item, data) === kind),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const childFolders = data.folders.filter(
    (item) => item.parentId === folderId,
  );
  const selectedWritable =
    checkedIds.length > 0 &&
    checkedIds.every((id) => {
      const item = data.documents.find((document) => document.id === id);
      return item?.canWrite && !item.officeWebUrl && !item.deletedAt;
    });
  const writableFolders = data.folders.filter((item) => item.canWrite);
  const activeDocs = data.documents.filter((item) => !item.deletedAt);
  const titles: Record<Modal["kind"], string> = {
    folder: "New document folder",
    "rename-folder": "Rename folder",
    permissions: "Folder permissions",
    office: "Link Microsoft file",
    "new-word": "New Word document",
    "new-spreadsheet": "New spreadsheet",
    metadata: "Edit document details",
    move: "Move document",
    copy: "Copy document",
    review: "Request document review",
    resolve: "Complete review",
    transmittal: "Create transmittal",
  };
  const folderOptions = (
    <>
      {data.capabilities.canWrite && (
        <option value="">Project documents</option>
      )}
      {writableFolders.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <input
        ref={fileInput}
        type="file"
        aria-label="Upload document files"
        className="hidden"
        multiple
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <h2 className="text-foreground !mb-6 text-xl font-semibold">Documents</h2>
      {sandbox && (
        <p className="bg-muted rounded-lg border p-3 text-sm">
          Documents is read-only in the tutorial. Open a real job to upload
          files and manage documents.
        </p>
      )}
      {offline && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          <WifiOffIcon className="size-4 shrink-0" />
          You are offline. Document files and edits require an internet
          connection; changes are not queued.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </div>
      )}
      {uploading && (
        <p
          role="status"
          className="bg-primary/5 text-primary flex items-center gap-2 rounded-lg border p-3 text-sm"
        >
          <Loader2Icon className="size-4 animate-spin" />
          Uploading {uploading}… Keep this page open.
        </p>
      )}
      {view === "submittals" && (
        <SubmittalsView
          data={data}
          canWrite={mutable && data.capabilities.canWrite}
          busy={processing}
          onOpen={setSelectedId}
          onUpload={() => pickFiles()}
          onDrop={(files) => {
            uploadTarget.current = null;
            uploadAsSubmittal.current = true;
            void upload(files);
          }}
        />
      )}
      {(view === "files" || view === "recycle") && (
        <section
          aria-label={view === "files" ? "Project files" : "Recycled files"}
        >
          {(view === "recycle" || breadcrumbs.length > 0) && (
            <nav
              aria-label="Document folders"
              className="mb-4 flex flex-wrap items-center gap-1 text-sm"
            >
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => openFolder(null)}
              >
                Project documents
              </button>
              {view === "recycle" ? (
                <>
                  <ChevronRightIcon className="text-muted-foreground size-4" />
                  <span>Recycle bin</span>
                </>
              ) : (
                breadcrumbs.map((item) => (
                  <span key={item.id} className="flex items-center gap-1">
                    <ChevronRightIcon className="text-muted-foreground size-4" />
                    <button
                      onClick={() => openFolder(item.id)}
                      className="max-w-52 truncate font-medium"
                    >
                      {item.name}
                    </button>
                  </span>
                ))
              )}
            </nav>
          )}
          {view === "files" && !query && childFolders.length > 0 && (
            <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {childFolders.map((folder) => (
                <div
                  className="bg-card flex items-center rounded-lg border"
                  key={folder.id}
                >
                  <button
                    className="hover:bg-muted flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
                    onClick={() => openFolder(folder.id)}
                  >
                    <FolderIcon className="text-primary size-6 shrink-0" />
                    <span className="truncate text-sm font-medium">
                      {folder.name}
                    </span>
                    {folder.permissions.length > 0 && (
                      <ShieldIcon className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                  </button>
                  {mutable && folder.canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="mr-2"
                          aria-label={`Manage ${folder.name}`}
                        >
                          <MoreVerticalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onSelect={() =>
                            openModal({
                              kind: "rename-folder",
                              folderId: folder.id,
                            })
                          }
                        >
                          Rename folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            openModal({
                              kind: "permissions",
                              folderId: folder.id,
                            })
                          }
                        >
                          Folder permissions
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          )}
          {checkedIds.length > 0 && (
            <div className="bg-primary/5 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="mr-auto text-sm">
                {checkedIds.length} selected
              </span>
              {mutable && selectedWritable && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={processing}
                    onClick={() =>
                      openModal({ kind: "review", documentIds: checkedIds })
                    }
                  >
                    Request review
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={processing}
                    onClick={() =>
                      openModal({
                        kind: "transmittal",
                        documentIds: checkedIds,
                      })
                    }
                  >
                    Create transmittal
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCheckedIds([])}
              >
                Clear selection
              </Button>
            </div>
          )}
          <div
            className={`overflow-hidden rounded-lg border ${dragging ? "border-primary bg-primary/5 ring-primary/20 ring-4" : "bg-card"}`}
            aria-label="Document file list"
            onDragOver={(event) => {
              event.preventDefault();
              if (canWrite && view === "files" && !processing)
                setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (canWrite && view === "files") {
                uploadTarget.current = null;
                uploadAsSubmittal.current = false;
                void upload(Array.from(event.dataTransfer.files));
              }
            }}
          >
            {loading && data.documents.length === 0 ? (
              <div
                role="status"
                className="text-muted-foreground flex items-center justify-center gap-2 p-12"
              >
                <Loader2Icon className="size-5 animate-spin" />
                Loading documents…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-8 text-center sm:p-14">
                <div className="bg-muted rounded-2xl p-4">
                  {view === "recycle" ? (
                    <Trash2Icon className="text-muted-foreground size-8" />
                  ) : (
                    <FileTextIcon className="text-primary size-8" />
                  )}
                </div>
                <h2 className="font-semibold">
                  {query || status || kind
                    ? "No matching documents"
                    : view === "recycle"
                      ? "The recycle bin is empty"
                      : "A home for your project files"}
                </h2>
                <p className="text-muted-foreground max-w-md text-sm">
                  {query || status || kind
                    ? "Try a different search or clear the filters."
                    : view === "recycle"
                      ? "Deleted documents appear here and can be restored."
                      : "Upload specifications, contracts, photos, and schedules. Every revision stays with its document."}
                </p>
                {canWrite && view === "files" && !query && !status && !kind && (
                  <Button
                    variant="outline"
                    disabled={processing}
                    onClick={() => pickFiles()}
                  >
                    <UploadIcon />
                    Choose files or drop them here
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="text-muted-foreground hidden grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_11rem] gap-3 border-b px-4 py-3 text-xs font-medium md:grid">
                  <span />
                  <span>NAME</span>
                  <span>STATUS</span>
                  <span>VERSION</span>
                  <span>UPDATED</span>
                </div>
                {filtered.map((document) => {
                  const current = data.versions.find(
                    (item) => item.id === document.currentVersionId,
                  );
                  return (
                    <div
                      className="hover:bg-muted/40 flex items-start gap-3 border-b p-4 last:border-b-0 md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_11rem] md:items-center"
                      key={document.id}
                    >
                      {view === "files" ? (
                        <input
                          type="checkbox"
                          className="accent-primary mt-2 size-4 cursor-pointer md:mt-0"
                          aria-label={`Select ${document.name}`}
                          checked={checkedIds.includes(document.id)}
                          onChange={(event) =>
                            setCheckedIds((items) =>
                              event.target.checked
                                ? [...items, document.id]
                                : items.filter((id) => id !== document.id),
                            )
                          }
                        />
                      ) : (
                        <Trash2Icon className="text-muted-foreground mt-1 size-4" />
                      )}
                      <button
                        className="flex min-w-0 flex-1 items-start gap-3 text-left md:items-center"
                        onClick={() => setSelectedId(document.id)}
                        aria-label={`Open ${document.name}`}
                      >
                        <span className="bg-primary/5 text-primary mt-0.5 rounded-lg p-2 md:mt-0">
                          <DocumentIcon kind={documentKind(document, data)} />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <span className="truncate">{document.name}</span>
                            {document.lockedBy && (
                              <LockIcon className="text-muted-foreground size-3.5 shrink-0" />
                            )}
                            {document.officeWebUrl && (
                              <LinkIcon className="text-muted-foreground size-3.5 shrink-0" />
                            )}
                          </span>
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {document.officeWebUrl
                              ? "Microsoft 365 linked file"
                              : current
                                ? formatBytes(current.size)
                                : "No file version"}
                            {query && document.folderId
                              ? ` · ${data.folders.find((item) => item.id === document.folderId)?.name ?? "Folder"}`
                              : ""}
                          </span>
                          <span className="mt-2 flex gap-2 md:hidden">
                            <StatusBadge status={document.status} />
                            <span className="text-muted-foreground text-xs">
                              {current ? `v${current.number}` : "Linked"}
                            </span>
                          </span>
                        </span>
                      </button>
                      <div className="hidden md:block">
                        <StatusBadge status={document.status} />
                      </div>
                      <span className="text-muted-foreground hidden text-sm md:block">
                        {current ? `v${current.number}` : "Linked"}
                      </span>
                      <span className="text-muted-foreground hidden text-xs md:block">
                        {formatDate(document.updatedAt)}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </section>
      )}
      {view === "reviews" && (
        <section aria-label="Document reviews" className="space-y-3">
          <div>
            <h2 className="font-semibold">Review decisions</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Select uploaded files in Files to request a review of their
              current versions.
            </p>
          </div>
          {data.reviews.length === 0 && (
            <p className="text-muted-foreground rounded-lg border p-10 text-center text-sm">
              No reviews yet. Review requests and decisions will appear here.
            </p>
          )}
          {data.reviews
            .slice()
            .reverse()
            .map((review) => (
              <article
                className="bg-card space-y-3 rounded-lg border p-4"
                key={review.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{review.title}</h3>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${review.status === "approved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : review.status === "changes_requested" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                  >
                    {review.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Assigned to {memberName(data, review.reviewerId)} · Requested{" "}
                  {formatDate(review.createdAt)}
                </p>
                <SnapshotFiles
                  snapshots={review.documents}
                  jobId={jobId}
                  data={data}
                />
                {review.comment && (
                  <p className="text-sm whitespace-pre-wrap">
                    {review.comment}
                  </p>
                )}
                {review.resolvedAt && (
                  <p className="text-muted-foreground text-xs">
                    Completed {formatDate(review.resolvedAt)}
                  </p>
                )}
                {mutable &&
                  review.status === "pending" &&
                  review.reviewerId === data.capabilities.userId && (
                    <Button
                      size="sm"
                      disabled={processing}
                      onClick={() =>
                        openModal({ kind: "resolve", reviewId: review.id })
                      }
                    >
                      Complete review
                    </Button>
                  )}
              </article>
            ))}
        </section>
      )}
      {view === "transmittals" && (
        <section aria-label="Document transmittals" className="space-y-3">
          <div>
            <h2 className="font-semibold">Transmittal register</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              A dated record of the exact uploaded revisions issued to project
              members. Recipients can open these records here; no email is sent.
            </p>
          </div>
          {data.transmittals.length === 0 && (
            <p className="text-muted-foreground rounded-lg border p-10 text-center text-sm">
              Select uploaded files in Files and create a transmittal to record
              an issue.
            </p>
          )}
          {data.transmittals
            .slice()
            .reverse()
            .map((item) => (
              <article
                className="bg-card space-y-3 rounded-lg border p-4"
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{item.title}</h3>
                  <PackageIcon className="text-muted-foreground size-5 shrink-0" />
                </div>
                <p className="text-muted-foreground text-xs">
                  Recorded by {memberName(data, item.createdBy)} ·{" "}
                  {formatDate(item.createdAt)}
                </p>
                <p className="text-sm">
                  Recipients: {item.recipients.join(", ")}
                </p>
                {item.message && (
                  <p className="text-sm whitespace-pre-wrap">{item.message}</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadManifest(item, jobId)}
                >
                  <DownloadIcon />
                  Download manifest
                </Button>
                <SnapshotFiles
                  snapshots={item.documents}
                  jobId={jobId}
                  data={data}
                />
              </article>
            ))}
        </section>
      )}
      {editorDocument && (
        <DocumentEditor
          key={editorDocument.id}
          jobId={jobId}
          documentId={editorDocument.id}
          name={editorDocument.name}
          onClose={() => {
            setEditorDocument(null);
            void refresh().catch(() =>
              setError(
                "The editor closed, but document revisions could not refresh. Please refresh the list.",
              ),
            );
          }}
        />
      )}
      {selected && !modal && !editorDocument && (
        <DocumentDetails
          key={selected.id}
          document={selected}
          data={data}
          jobId={jobId}
          mutable={mutable}
          busy={processing}
          onClose={() => setSelectedId(null)}
          onDialog={(kind) => openModal({ kind, documentIds: [selected.id] })}
          onUpload={() => pickFiles(selected)}
          onReview={() => {
            setSelectedId(null);
            setView("reviews");
          }}
          editorStatus={editorStatus}
          onEdit={() =>
            setEditorDocument({ id: selected.id, name: selected.name })
          }
          mutate={mutate}
        />
      )}
      <div
        role="toolbar"
        aria-label="Document controls"
        hidden={Boolean(selected || editorDocument)}
        className="bg-card fixed inset-x-0 bottom-0 z-30 border-t px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-2">
          <Button
            variant="outline"
            className="h-11 gap-1 px-2 text-xs sm:text-sm"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontalIcon className="size-4" />
            More
          </Button>
          <div className="relative min-w-0">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-3.5 left-2 size-4" />
            <Input
              className="h-11 min-w-0 pr-2 pl-7"
              aria-label="Search documents"
              placeholder="Search documents"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (view !== "files" && view !== "recycle") setView("files");
              }}
            />
          </div>
          <Button
            className="h-11 gap-1 px-1 text-xs sm:text-sm"
            disabled={!canWrite || processing}
            onClick={() => setAddOpen(true)}
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="leading-tight whitespace-normal">
              Add document
            </span>
          </Button>
        </div>
      </div>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
            <DialogDescription>
              Browse sections, filter documents, and manage folders.
            </DialogDescription>
          </DialogHeader>
          <DrawingPageModeSetting />
          <div
            className="flex flex-wrap gap-1 border-b"
            role="tablist"
            aria-label="Document workspace"
          >
            {(
              [
                { id: "files", label: "Files", icon: FolderIcon },
                {
                  id: "submittals",
                  label: "Submittals",
                  icon: ClipboardCheckIcon,
                },
                { id: "reviews", label: "Reviews", icon: ClipboardCheckIcon },
                {
                  id: "transmittals",
                  label: "Transmittals",
                  icon: PackageIcon,
                },
                { id: "recycle", label: "Recycle bin", icon: Trash2Icon },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                role="tab"
                aria-selected={view === id}
                key={id}
                className={`flex shrink-0 items-center gap-2 px-3 py-3 text-sm ${view === id ? "border-primary text-primary border-b-2 font-semibold" : "text-muted-foreground"}`}
                onClick={() => {
                  setView(id);
                  setMoreOpen(false);
                  setCheckedIds([]);
                }}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className={selectClass}
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              aria-label="Filter by file type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">All file types</option>
              <option value="pdf">PDF</option>
              <option value="word">Word</option>
              <option value="spreadsheet">Spreadsheets</option>
              <option value="image">Images</option>
              <option value="office">Microsoft 365</option>
              <option value="other">Other files</option>
            </select>
          </div>
          {view === "files" && (
            <div className="flex gap-2">
              {folderId && canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMoreOpen(false);
                    openModal({ kind: "permissions", folderId });
                  }}
                >
                  <ShieldIcon />
                  Permissions
                </Button>
              )}
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMoreOpen(false);
                    openModal({ kind: "folder" });
                  }}
                >
                  <FolderPlusIcon />
                  New folder
                </Button>
              )}
            </div>
          )}
          <Button
            aria-label="Refresh documents"
            variant="outline"
            className="justify-start"
            disabled={loading || processing || sandbox || offline}
            onClick={() => {
              setLoading(true);
              void refresh()
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Refresh failed.",
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : ""} /> Refresh
            documents
          </Button>
          <p className="text-muted-foreground text-xs">
            {data.reviews.filter((item) => item.status === "pending").length}{" "}
            pending reviews ·{" "}
            {activeDocs.filter((item) => item.status === "approved").length}{" "}
            approved documents
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add document</DialogTitle>
            <DialogDescription>
              Upload a file, create a document, or link a Microsoft file.
            </DialogDescription>
          </DialogHeader>
          {!sandbox && editorStatus && !editorStatus.configured && (
            <p className="text-muted-foreground text-sm">
              Online Word and spreadsheet editing is not set up. You can upload
              existing files.
            </p>
          )}
          <div className="flex flex-col gap-2 [&_button]:justify-start">
            {" "}
            {canWrite && (
              <>
                {editorStatus?.configured && (
                  <>
                    <Button
                      variant="outline"
                      disabled={processing}
                      onClick={() => {
                        setAddOpen(false);
                        openModal({ kind: "new-word" });
                      }}
                    >
                      <FileTextIcon />
                      New Word document
                    </Button>
                    <Button
                      variant="outline"
                      disabled={processing}
                      onClick={() => {
                        setAddOpen(false);
                        openModal({ kind: "new-spreadsheet" });
                      }}
                    >
                      <FileSpreadsheetIcon />
                      New spreadsheet
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={processing}
                  onClick={() => {
                    setAddOpen(false);
                    openModal({ kind: "office" });
                  }}
                >
                  <LinkIcon />
                  Link Microsoft file
                </Button>
                <Button
                  disabled={processing}
                  onClick={() => {
                    setAddOpen(false);
                    pickFiles();
                  }}
                >
                  {uploading ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <UploadIcon />
                  )}
                  Upload files
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(open) => !open && closeModal()}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {modal ? titles[modal.kind] : "Documents"}
            </DialogTitle>
            <DialogDescription>
              {modal?.kind === "new-word" || modal?.kind === "new-spreadsheet"
                ? "Create a project file and open it in Collabora Online. Changes are saved back to this document’s version history."
                : modal?.kind === "office"
                  ? "Link an existing Word, Excel, or PowerPoint file in OneDrive or SharePoint. Microsoft controls live editing and sharing access."
                  : modal?.kind === "permissions"
                    ? "An empty list inherits access from the parent folder. A custom list restricts access to these members; project managers retain access."
                    : modal?.kind === "transmittal"
                      ? "Record the selected file revisions and recipients. This creates an in-app record and does not send an email."
                      : modal?.kind === "review"
                        ? "The assigned reviewer decides on the selected uploaded versions. If a revision changes, request a new review."
                        : modal?.kind === "resolve"
                          ? "Check the attached revisions before recording your decision."
                          : "Changes are saved to this project's document workspace."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveModal();
            }}
          >
            {modal &&
              !["permissions", "move", "resolve"].includes(modal.kind) && (
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>
                    {["review", "transmittal"].includes(modal.kind)
                      ? "Title"
                      : "Name"}
                  </span>
                  <Input
                    autoFocus
                    required
                    maxLength={255}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    placeholder={
                      modal.kind === "office"
                        ? "Schedule.xlsx"
                        : modal.kind === "folder"
                          ? "e.g. Specifications"
                          : undefined
                    }
                  />
                </label>
              )}
            {modal?.kind === "office" && (
              <>
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>Microsoft file URL</span>
                  <Input
                    required
                    type="url"
                    value={draft.webUrl}
                    onChange={(event) =>
                      setDraft({ ...draft, webUrl: event.target.value })
                    }
                    placeholder="https://company.sharepoint.com/…/Scope.docx"
                  />
                </label>
                <p className="text-muted-foreground text-xs">
                  Use the full browser address of your existing Microsoft file.
                  ForemanHQ stores the link; uploaded files are not synced. To
                  review or transmit a fixed revision, upload an exported copy.
                </p>
              </>
            )}
            {modal &&
              ["metadata", "transmittal", "resolve"].includes(modal.kind) && (
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>
                    {modal.kind === "metadata"
                      ? "Description"
                      : modal.kind === "resolve"
                        ? "Decision notes"
                        : "Message"}
                  </span>
                  <textarea
                    className={textareaClass}
                    maxLength={5000}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                </label>
              )}
            {modal?.kind === "metadata" && (
              <>
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>Tags</span>
                  <Input
                    value={draft.tags}
                    placeholder="contract, electrical, phase 1"
                    onChange={(event) =>
                      setDraft({ ...draft, tags: event.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>Status</span>
                  <select
                    className={`${selectClass} w-full`}
                    value={draft.status}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        status: event.target.value as DocumentStatus,
                      })
                    }
                  >
                    {Object.entries(statusLabels).map(([id, label]) => (
                      <option value={id} key={id} disabled={id === "approved"}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-muted-foreground text-xs">
                  Approval is recorded by the assigned reviewer through a review
                  request.
                </p>
              </>
            )}
            {modal && ["move", "copy"].includes(modal.kind) && (
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Destination folder</span>
                <select
                  className={`${selectClass} w-full`}
                  value={draft.folderId}
                  onChange={(event) =>
                    setDraft({ ...draft, folderId: event.target.value })
                  }
                >
                  {folderOptions}
                </select>
              </label>
            )}
            {modal?.kind === "review" && (
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Assigned reviewer</span>
                <select
                  required
                  className={`${selectClass} w-full`}
                  value={draft.reviewerId}
                  onChange={(event) =>
                    setDraft({ ...draft, reviewerId: event.target.value })
                  }
                >
                  <option value="">Choose a project member</option>
                  {data.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name ?? member.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal?.kind === "resolve" && (
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Decision</span>
                <select
                  className={`${selectClass} w-full`}
                  value={draft.decision}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      decision: event.target.value as Draft["decision"],
                    })
                  }
                >
                  <option value="approved">Approve</option>
                  <option value="changes_requested">Request changes</option>
                </select>
              </label>
            )}
            {modal?.kind === "transmittal" && (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Recipients</legend>
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                  {data.members.map((member) => (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={member.id}
                    >
                      <input
                        type="checkbox"
                        checked={draft.recipients.includes(member.email)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            recipients: event.target.checked
                              ? [...draft.recipients, member.email]
                              : draft.recipients.filter(
                                  (email) => email !== member.email,
                                ),
                          })
                        }
                      />
                      {member.name ?? member.email}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {modal?.kind === "permissions" && (
              <div className="space-y-3">
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                  {data.members.map((member) => {
                    const permission = draft.permissions.find(
                      (item) => item.userId === member.id,
                    );
                    return (
                      <div
                        className="flex items-center justify-between gap-3"
                        key={member.id}
                      >
                        <span className="min-w-0 truncate text-sm">
                          {member.name ?? member.email}
                        </span>
                        <select
                          className={selectClass}
                          aria-label={`Access for ${member.name ?? member.email}`}
                          value={permission?.role ?? "none"}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              permissions: [
                                ...draft.permissions.filter(
                                  (item) => item.userId !== member.id,
                                ),
                                ...(event.target.value === "none"
                                  ? []
                                  : [
                                      {
                                        userId: member.id,
                                        role: event.target
                                          .value as DocumentRole,
                                      },
                                    ]),
                              ],
                            })
                          }
                        >
                          <option value="none">Not listed</option>
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="manager">Manager</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  {draft.permissions.length
                    ? `${draft.permissions.length} members explicitly listed. Unlisted members lose access unless they manage the project.`
                    : "Access is inherited. No custom restrictions."}{" "}
                  Editor and manager roles also require the member’s document
                  management permission.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft({ ...draft, permissions: [] })}
                >
                  Use inherited permissions
                </Button>
              </div>
            )}
            {modal && ["review", "transmittal"].includes(modal.kind) && (
              <div className="bg-muted/50 space-y-1 rounded-md p-3">
                <p className="text-xs font-medium">
                  {modal.documentIds?.length} document(s) included
                </p>
                {modal.documentIds?.map((id) => (
                  <p
                    className="text-muted-foreground truncate text-xs"
                    key={id}
                  >
                    {data.documents.find((item) => item.id === id)?.name}
                  </p>
                ))}
              </div>
            )}
            {modalError && (
              <p role="alert" className="text-destructive text-sm">
                {modalError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={closeModal}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !mutable ||
                  (modal?.kind === "transmittal" &&
                    draft.recipients.length === 0)
                }
              >
                {busy && <Loader2Icon className="animate-spin" />}
                {modal?.kind === "folder"
                  ? "Create folder"
                  : modal?.kind === "review"
                    ? "Request review"
                    : modal?.kind === "transmittal"
                      ? "Create transmittal"
                      : modal?.kind === "new-word" ||
                          modal?.kind === "new-spreadsheet"
                        ? "Create and edit"
                        : modal?.kind === "office"
                          ? "Link file"
                          : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SnapshotFiles({
  snapshots,
  jobId,
  data,
}: {
  snapshots: DocumentOverview["reviews"][number]["documents"];
  jobId: string;
  data: DocumentOverview;
}) {
  return (
    <ul className="divide-y rounded-md border">
      {snapshots.map((snapshot) => {
        const version = data.versions.find(
          (item) => item.id === snapshot.versionId,
        );
        return (
          <li
            key={snapshot.documentId}
            className="flex flex-wrap items-center gap-2 p-3 text-sm"
          >
            <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-all">{snapshot.name}</span>
            {version && (
              <span className="text-muted-foreground text-xs">
                v{version.number}
              </span>
            )}
            {snapshot.versionId && (
              <a
                className="text-primary text-xs underline"
                href={versionUrl(jobId, snapshot.versionId, true)}
              >
                Download recorded version
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
