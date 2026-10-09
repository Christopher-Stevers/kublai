"use client";

import { useState } from "react";
import { useSnapshot } from "~/components/chat/SnapshotProvider";
import {
  supportsDocumentEditor,
  type EditorAvailability,
} from "./DocumentEditor";
import { DocumentPdfPreview } from "./DocumentPdfPreview";
import { SubmittalReviewPanel } from "./SubmittalReviewPanel";
import { SubmittalBadge } from "./SubmittalsView";
import { defaultSubmittal } from "~/lib/submittals";
import { DocumentVersionCompare } from "./DocumentVersionCompare";
import {
  DownloadIcon,
  CameraIcon,
  ExternalLinkIcon,
  HistoryIcon,
  LockIcon,
  MessageSquareIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type {
  DocumentAction,
  DocumentOverview,
  JobDocument,
} from "~/server/documents/types";
import {
  documentKind,
  formatBytes,
  formatDate,
  memberName,
  StatusBadge,
  textareaClass,
  versionUrl,
} from "./document-ui";

export type DocumentDialogKind =
  | "metadata"
  | "move"
  | "copy"
  | "review"
  | "transmittal";
type Props = {
  document: JobDocument;
  data: DocumentOverview;
  jobId: string;
  mutable: boolean;
  busy: boolean;
  onClose: () => void;
  onDialog: (kind: DocumentDialogKind) => void;
  onUpload: () => void;
  onReview: () => void;
  editorStatus: EditorAvailability | null;
  onEdit: () => void;
  mutate: (action: DocumentAction) => Promise<boolean>;
};

export function DocumentDetails({
  document,
  data,
  jobId,
  mutable,
  busy,
  onClose,
  onDialog,
  onUpload,
  onReview,
  editorStatus,
  onEdit,
  mutate,
}: Props) {
  const snapshot = useSnapshot();
  const [tab, setTab] = useState<
    "details" | "versions" | "comments" | "activity"
  >("details");
  const [readyVersionId, setReadyVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const versions = data.versions
    .filter((item) => item.documentId === document.id)
    .sort((a, b) => b.number - a.number);
  const version =
    versions.find(
      (item) => item.id === (previewVersionId ?? document.currentVersionId),
    ) ?? versions[0];
  const canWrite = mutable && Boolean(document.canWrite) && !document.deletedAt;
  const lockedElsewhere = Boolean(
    document.lockedBy && document.lockedBy !== data.capabilities.userId,
  );
  const canEdit = canWrite && !lockedElsewhere;
  const canUnlock =
    mutable &&
    Boolean(document.lockedBy) &&
    (document.lockedBy === data.capabilities.userId || document.canManage);
  const comments = data.comments.filter(
    (item) => item.documentId === document.id,
  );
  const activity = data.activity
    .filter((item) => item.documentId === document.id)
    .slice()
    .reverse();
  const kind = documentKind(document, data);
  const officeLabel =
    kind === "word"
      ? "Open in Word"
      : kind === "spreadsheet"
        ? "Open in Excel"
        : "Open in Microsoft 365";

  const currentVersion = versions.find(
    (item) => item.id === document.currentVersionId,
  );
  const editableFormat =
    !document.officeWebUrl &&
    supportsDocumentEditor(currentVersion?.name ?? document.name);
  const comparisonVersion = versions.find(
    (item) => item.id === compareVersionId,
  );
  return (
    <>
      {currentVersion && comparisonVersion && (
        <DocumentVersionCompare
          jobId={jobId}
          current={currentVersion}
          previous={comparisonVersion}
          onClose={() => setCompareVersionId(null)}
        />
      )}
      <Dialog
        open={compareVersionId === null}
        onOpenChange={(open) => !open && onClose()}
      >
        <DialogContent
          className="max-h-[92dvh] overflow-y-auto sm:max-w-6xl"
          showCloseButton={!document.submittal}
        >
          <DialogHeader
            className={`pr-8 text-left ${document.submittal ? "bg-background sticky top-0 z-10 border-b pb-3" : ""}`}
          >
            {document.submittal && (
              <Button
                type="button"
                aria-label="Close"
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 size-8"
                onClick={onClose}
              >
                <XIcon />
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {document.submittal ? (
                <SubmittalBadge document={document} data={data} />
              ) : (
                <StatusBadge status={document.status} />
              )}
              {document.officeWebUrl && (
                <span className="text-muted-foreground text-xs">
                  Microsoft 365 linked file
                </span>
              )}
              {document.deletedAt && (
                <span className="text-destructive text-xs">In recycle bin</span>
              )}
            </div>
            <DialogTitle className="text-xl leading-tight break-all">
              {document.submittal?.title ?? document.name}
            </DialogTitle>
            <DialogDescription>
              Updated {formatDate(document.updatedAt)} ·{" "}
              {versions.length
                ? `${versions.length} version${versions.length === 1 ? "" : "s"}`
                : "Version history lives in Microsoft 365"}
            </DialogDescription>
          </DialogHeader>
          {document.lockedBy && (
            <p className="flex items-center gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
              <LockIcon className="size-4 shrink-0" />
              Locked by {memberName(data, document.lockedBy)}.
              {canUnlock && (
                <Button
                  className="ml-auto"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate({ action: "unlock", documentId: document.id })
                  }
                >
                  Unlock
                </Button>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {snapshot && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={snapshot.start}
              >
                <CameraIcon />
                Snapshot
              </Button>
            )}
            {editableFormat &&
              editorStatus?.configured &&
              mutable &&
              !document.deletedAt && (
                <Button disabled={busy} onClick={onEdit}>
                  {canEdit ? "Edit together" : "Open read-only"}
                </Button>
              )}
            {document.officeWebUrl && (
              <Button asChild>
                <a
                  href={document.officeWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLinkIcon />
                  {officeLabel}
                </a>
              </Button>
            )}
            {version && (
              <Button variant="outline" asChild>
                <a href={versionUrl(jobId, version.id, true)}>
                  <DownloadIcon />
                  Download{previewVersionId ? ` v${version.number}` : ""}
                </a>
              </Button>
            )}
            {canEdit && !document.officeWebUrl && (
              <Button variant="outline" disabled={busy} onClick={onUpload}>
                <UploadIcon />
                Upload new version
              </Button>
            )}
            {canEdit && !document.submittal && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onDialog("metadata")}
              >
                Edit details
              </Button>
            )}
            {canEdit &&
              !document.submittal &&
              currentVersion?.mimeType === "application/pdf" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      action: "registerSubmittal",
                      documentId: document.id,
                      expectedVersionId: currentVersion.id,
                      details: defaultSubmittal(document.name),
                    })
                  }
                >
                  Move to Submittals
                </Button>
              )}
            {document.submittal && version && (
              <Button variant="outline" asChild>
                <a
                  href={versionUrl(jobId, version.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLinkIcon />
                  Open PDF
                </a>
              </Button>
            )}
            {canWrite && !document.lockedBy && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void mutate({ action: "lock", documentId: document.id })
                }
              >
                <LockIcon />
                Lock
              </Button>
            )}
            {document.deletedAt && mutable && document.canWrite && (
              <Button
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate({ action: "restore", documentId: document.id })
                  )
                    onClose();
                }}
              >
                Restore document
              </Button>
            )}
          </div>
          {editableFormat && (
            <p className="text-muted-foreground rounded-md border p-3 text-sm">
              {editorStatus?.configured
                ? "Open this file in Collabora Online to edit together in your browser. Saves become project document revisions; no Microsoft account is required."
                : "Live editing is not set up on this server. Ask your workspace administrator to connect the Collabora editing service. Your saved file can still be downloaded."}
            </p>
          )}
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="bg-muted/40 flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-lg border lg:min-h-[480px]">
                {document.officeWebUrl ? (
                  <div className="max-w-md space-y-3 p-6 text-center">
                    <ExternalLinkIcon className="text-primary mx-auto size-10" />
                    <h3 className="font-semibold">
                      Work together in Microsoft 365
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      This is a link to an existing Microsoft file. Live
                      editing, sharing permissions, and its version history are
                      managed by Microsoft. Changes are saved there.
                    </p>
                    <p className="text-muted-foreground text-xs">
                      ForemanHQ locks protect this record only; they do not stop
                      edits in Microsoft 365. Upload a fixed revision for review
                      or a transmittal.
                    </p>
                  </div>
                ) : version?.mimeType === "application/pdf" ? (
                  <DocumentPdfPreview
                    key={version.id}
                    title={`Preview ${document.name} version ${version.number}`}
                    url={versionUrl(jobId, version.id)}
                    onReady={() => setReadyVersionId(version.id)}
                  />
                ) : version &&
                  [
                    "image/png",
                    "image/jpeg",
                    "image/webp",
                    "image/gif",
                    "image/avif",
                  ].includes(version.mimeType) ? (
                  // Authenticated binary route intentionally bypasses the public Next image optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={versionUrl(jobId, version.id)}
                    alt={document.name}
                    className="max-h-[65dvh] w-full object-contain"
                  />
                ) : (
                  <div className="max-w-md space-y-3 p-6 text-center">
                    <DownloadIcon className="text-muted-foreground mx-auto size-10" />
                    <h3 className="font-semibold">
                      Download to view this file
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      PDFs and images can be previewed here. Download other
                      formats to open them in their app.
                    </p>
                    {(kind === "word" || kind === "spreadsheet") && (
                      <p className="text-muted-foreground text-sm">
                        Open-source live editing is available for supported
                        Office files when the Collabora service is configured.
                        No Microsoft account is needed.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {version && (
                <p className="text-muted-foreground mt-2 text-xs">
                  Viewing v{version.number} · {formatBytes(version.size)} ·{" "}
                  {version.name}
                  {previewVersionId &&
                    previewVersionId !== document.currentVersionId && (
                      <button
                        type="button"
                        className="text-primary ml-2 underline"
                        onClick={() => setPreviewVersionId(null)}
                      >
                        Return to current version
                      </button>
                    )}
                </p>
              )}
            </div>
            <div className="min-w-0">
              {document.submittal && (
                <SubmittalReviewPanel
                  document={document}
                  data={data}
                  canEdit={canEdit}
                  mutable={mutable}
                  busy={busy}
                  reviewingCurrentVersion={
                    readyVersionId === document.currentVersionId &&
                    (!previewVersionId ||
                      previewVersionId === document.currentVersionId)
                  }
                  mutate={mutate}
                  onReview={onReview}
                />
              )}
              <div
                role="tablist"
                aria-label="Document information"
                className="mb-4 flex overflow-x-auto border-b"
              >
                {(["details", "versions", "comments", "activity"] as const).map(
                  (item) => (
                    <button
                      key={item}
                      role="tab"
                      aria-selected={tab === item}
                      className={`px-3 py-2 text-sm capitalize ${tab === item ? "border-primary text-primary border-b-2 font-medium" : "text-muted-foreground"}`}
                      onClick={() => setTab(item)}
                    >
                      {item}
                      {item === "comments" && comments.length
                        ? ` (${comments.length})`
                        : ""}
                    </button>
                  ),
                )}
              </div>
              <div role="tabpanel" aria-label={tab} className="space-y-4">
                {tab === "details" && (
                  <>
                    <dl className="space-y-4 text-sm">
                      <div>
                        <dt className="text-muted-foreground mb-1 text-xs">
                          DESCRIPTION
                        </dt>
                        <dd className="whitespace-pre-wrap">
                          {document.description || "No description yet."}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground mb-1 text-xs">
                          TAGS
                        </dt>
                        <dd className="flex flex-wrap gap-1">
                          {document.tags.length
                            ? document.tags.map((tag) => (
                                <span
                                  className="bg-muted rounded px-2 py-1 text-xs"
                                  key={tag}
                                >
                                  {tag}
                                </span>
                              ))
                            : "No tags"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground mb-1 text-xs">
                          ADDED BY
                        </dt>
                        <dd>
                          {memberName(data, document.createdBy)} ·{" "}
                          {formatDate(document.createdAt)}
                        </dd>
                      </div>
                    </dl>
                    {!document.deletedAt && (
                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onDialog("move")}
                          >
                            Move
                          </Button>
                        )}
                        {mutable && data.capabilities.canWrite && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onDialog("copy")}
                          >
                            Copy
                          </Button>
                        )}
                        {canEdit &&
                          !document.officeWebUrl &&
                          !document.submittal && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => onDialog("review")}
                            >
                              Request review
                            </Button>
                          )}
                        {canEdit && !document.officeWebUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onDialog("transmittal")}
                          >
                            Create transmittal
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                await confirmAction({
                                  title: "Move document to recycle bin?",
                                  description:
                                    "The document and its versions can be restored later.",
                                  confirmLabel: "Move to recycle bin",
                                  destructive: true,
                                })
                              ) {
                                if (
                                  await mutate({
                                    action: "delete",
                                    documentId: document.id,
                                  })
                                )
                                  onClose();
                              }
                            }}
                          >
                            Move to recycle bin
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {tab === "versions" && (
                  <>
                    {document.officeWebUrl && (
                      <p className="text-muted-foreground text-sm">
                        Open the file in Microsoft 365 to view its version
                        history. ForemanHQ records the link, not copies of the
                        Microsoft file.
                      </p>
                    )}
                    {versions.map((item) => (
                      <div
                        key={item.id}
                        className="space-y-2 rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-2">
                          <HistoryIcon className="text-muted-foreground size-4" />
                          <strong className="text-sm">
                            Version {item.number}
                          </strong>
                          {item.id === document.currentVersionId && (
                            <span className="text-primary text-xs">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {formatDate(item.createdAt)} ·{" "}
                          {memberName(data, item.createdBy)} ·{" "}
                          {formatBytes(item.size)}
                        </p>
                        {item.restoredFromVersionId && (
                          <p className="text-muted-foreground text-xs">
                            Restored from an earlier version
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPreviewVersionId(item.id)}
                          >
                            Preview v{item.number}
                          </Button>
                          {currentVersion && item.id !== currentVersion.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCompareVersionId(item.id)}
                            >
                              Compare v{item.number}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" asChild>
                            <a href={versionUrl(jobId, item.id, true)}>
                              Download v{item.number}
                            </a>
                          </Button>
                          {canEdit && item.id !== document.currentVersionId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await confirmAction({
                                    title: `Restore version ${item.number}?`,
                                    description:
                                      "This creates a new current version and preserves the full history.",
                                    confirmLabel: "Restore version",
                                  })
                                ) {
                                  if (
                                    await mutate({
                                      action: "restoreVersion",
                                      documentId: document.id,
                                      versionId: item.id,
                                    })
                                  )
                                    setPreviewVersionId(null);
                                }
                              }}
                            >
                              Restore v{item.number}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {tab === "comments" && (
                  <>
                    {comments.length === 0 && (
                      <p className="text-muted-foreground py-4 text-sm">
                        No comments yet. Keep document decisions with the file.
                      </p>
                    )}
                    {comments.map((item) => (
                      <article
                        key={item.id}
                        className="space-y-1 rounded-lg border p-3"
                      >
                        <p className="text-sm font-medium">
                          {memberName(data, item.createdBy)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDate(item.createdAt)}
                        </p>
                        <p className="pt-1 text-sm break-words whitespace-pre-wrap">
                          {item.body}
                        </p>
                      </article>
                    ))}
                    {mutable && !document.deletedAt && (
                      <form
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (
                            await mutate({
                              action: "comment",
                              documentId: document.id,
                              body: comment.trim(),
                            })
                          )
                            setComment("");
                        }}
                        className="space-y-2"
                      >
                        <textarea
                          aria-label="Add a comment"
                          placeholder="Add a comment…"
                          maxLength={5000}
                          className={textareaClass}
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                        />
                        <Button size="sm" disabled={busy || !comment.trim()}>
                          <MessageSquareIcon />
                          Post comment
                        </Button>
                      </form>
                    )}
                  </>
                )}
                {tab === "activity" && (
                  <>
                    {activity.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        No activity recorded.
                      </p>
                    )}
                    {activity.map((item) => (
                      <div key={item.id} className="border-l-2 pl-3">
                        <p className="text-sm">
                          {item.detail || item.action.replaceAll("_", " ")}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {memberName(data, item.createdBy)} ·{" "}
                          {formatDate(item.createdAt)}
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
