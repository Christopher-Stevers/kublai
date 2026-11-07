"use client";

import { useState } from "react";
import { CheckIcon, PencilIcon, SendIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  currentSubmittalReview,
  submittalDueLabel,
  submittalOverdue,
} from "~/lib/submittals";
import type {
  DocumentAction,
  DocumentOverview,
  JobDocument,
  SubmittalInput,
} from "~/server/documents/types";
import {
  formatDate,
  memberName,
  selectClass,
  textareaClass,
} from "./document-ui";

export function SubmittalReviewPanel({
  document,
  data,
  canEdit,
  mutable,
  busy,
  reviewingCurrentVersion,
  mutate,
  onReview,
}: {
  document: JobDocument;
  data: DocumentOverview;
  canEdit: boolean;
  mutable: boolean;
  busy: boolean;
  reviewingCurrentVersion: boolean;
  mutate: (action: DocumentAction) => Promise<boolean>;
  onReview: () => void;
}) {
  const info = document.submittal!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SubmittalInput>(info);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(
    document.updatedAt,
  );
  const [reviewerId, setReviewerId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const review = currentSubmittalReview(document, data.reviews);
  const pending = review?.status === "pending";
  const history = data.reviews
    .filter((entry) =>
      entry.documents.some((snapshot) => snapshot.documentId === document.id),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const currentVersion =
    data.versions.find((version) => version.id === document.currentVersionId)
      ?.number ?? 1;
  const decide = async (decision: "approved" | "changes_requested") => {
    if (
      review?.documents.length !== 1 ||
      busy ||
      !mutable ||
      !reviewingCurrentVersion
    )
      return;
    if (decision === "changes_requested" && !comment.trim()) {
      setError("Describe the changes needed before returning this PDF.");
      return;
    }
    setError("");
    if (
      await mutate({
        action: "resolveReview",
        reviewId: review.id,
        decision,
        comment: comment.trim(),
      })
    )
      setComment("");
  };
  return (
    <section
      aria-label="Submittal approval and details"
      className="mb-5 space-y-4 rounded-lg border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {info.number} · Revision {currentVersion}
        </h3>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft({
                title: info.title,
                category: info.category,
                specSection: info.specSection,
                manufacturer: info.manufacturer,
                dueDate: info.dueDate,
              });
              setExpectedUpdatedAt(document.updatedAt);
              setEditing(!editing);
              setError("");
            }}
          >
            <PencilIcon />
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            void mutate({
              action: "updateSubmittal",
              documentId: document.id,
              expectedUpdatedAt,
              details: draft,
            }).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <label className="block text-xs font-medium">
            Title
            <Input
              className="mt-1"
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium">
              Category
              <Input
                list={`submittal-categories-${document.id}`}
                className="mt-1"
                maxLength={100}
                placeholder="e.g. Plumbing"
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
              />
              <datalist id={`submittal-categories-${document.id}`}>
                {[
                  ...new Set([
                    "Plumbing",
                    "Mechanical",
                    "Electrical",
                    "Architectural",
                    "Structural",
                    "Fire protection",
                    ...data.documents
                      .map((doc) => doc.submittal?.category)
                      .filter((category): category is string =>
                        Boolean(category),
                      ),
                  ]),
                ].map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>
            <label className="text-xs font-medium">
              Specification section
              <Input
                className="mt-1"
                maxLength={100}
                placeholder="e.g. 22 11 16"
                value={draft.specSection}
                onChange={(event) =>
                  setDraft({ ...draft, specSection: event.target.value })
                }
              />
            </label>
          </div>
          <label className="block text-xs font-medium">
            Manufacturer
            <Input
              className="mt-1"
              maxLength={200}
              value={draft.manufacturer}
              onChange={(event) =>
                setDraft({ ...draft, manufacturer: event.target.value })
              }
            />
          </label>
          <label className="block text-xs font-medium">
            Approval due date
            <Input
              type="date"
              className="mt-1"
              value={draft.dueDate ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, dueDate: event.target.value || null })
              }
            />
          </label>
          <Button size="sm" disabled={busy || !draft.title.trim()}>
            Save details
          </Button>
        </form>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="mt-0.5 break-words">
              {info.category || "Uncategorized"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Specification</dt>
            <dd className="mt-0.5 break-words">{info.specSection || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Manufacturer</dt>
            <dd className="mt-0.5 break-words">{info.manufacturer || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due date</dt>
            <dd
              className={`mt-0.5 ${submittalOverdue(document, data.reviews) ? "font-semibold text-rose-700 dark:text-rose-300" : ""}`}
            >
              {info.dueDate ? submittalDueLabel(info.dueDate) : "Not set"}
            </dd>
          </div>
        </dl>
      )}
      <div className="space-y-3 border-t pt-3">
        {pending ? (
          <>
            <p className="text-sm">
              Waiting for <strong>{memberName(data, review.reviewerId)}</strong>{" "}
              to review revision {currentVersion}.
            </p>
            {review.documents.length > 1 && (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  This approval covers {review.documents.length} documents.
                  Check every attached PDF in Reviews before deciding.
                </p>
                <Button size="sm" variant="outline" onClick={onReview}>
                  Open grouped review
                </Button>
              </div>
            )}
            {review.reviewerId === data.capabilities.userId &&
              review.documents.length === 1 &&
              mutable &&
              !document.deletedAt && (
                <>
                  {!reviewingCurrentVersion && (
                    <p
                      role="status"
                      className="text-xs text-amber-800 dark:text-amber-300"
                    >
                      Return to the current version in the preview before
                      deciding.
                    </p>
                  )}
                  <label className="block text-xs font-medium">
                    Review comments
                    <textarea
                      className={`${textareaClass} mt-1 min-h-20`}
                      maxLength={10000}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Optional for approval; required when requesting changes."
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !reviewingCurrentVersion}
                      onClick={() => void decide("approved")}
                    >
                      <CheckIcon />
                      Approve PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !reviewingCurrentVersion}
                      onClick={() => void decide("changes_requested")}
                    >
                      Return for changes
                    </Button>
                  </div>
                </>
              )}
          </>
        ) : (
          <>
            {review?.status === "approved" && (
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Approved by {memberName(data, review.reviewerId)} ·{" "}
                {formatDate(review.resolvedAt ?? review.createdAt)}
              </p>
            )}
            {review?.status === "changes_requested" && (
              <div className="rounded-md border border-rose-500/25 bg-rose-500/5 p-3">
                <p className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                  Changes requested by {memberName(data, review.reviewerId)}
                </p>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {review.comment}
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  Upload a corrected PDF as a new version, then request approval
                  again.
                </p>
              </div>
            )}
            {canEdit && review?.status !== "approved" && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setError("");
                  void mutate({
                    action: "createReview",
                    documentIds: [document.id],
                    title: `${info.number} · ${info.title}`.slice(0, 200),
                    reviewerId,
                  });
                }}
              >
                <label className="block text-xs font-medium">
                  Send for approval
                  <select
                    className={`${selectClass} mt-1 w-full`}
                    required
                    value={reviewerId}
                    onChange={(event) => setReviewerId(event.target.value)}
                  >
                    <option value="">Choose a reviewer</option>
                    {data.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name ?? member.email}
                        {member.id === data.capabilities.userId ? " (you)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button size="sm" disabled={busy || !reviewerId}>
                  <SendIcon />
                  Request approval
                </Button>
              </form>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
      {history.length > 0 && (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-xs font-medium">
            Approval history ({history.length})
          </summary>
          <ol className="mt-3 space-y-3">
            {history.map((entry) => {
              const versionId = entry.documents.find(
                (snapshot) => snapshot.documentId === document.id,
              )?.versionId;
              const revision = data.versions.find(
                (version) => version.id === versionId,
              )?.number;
              return (
                <li key={entry.id} className="border-l-2 pl-3 text-xs">
                  <p className="font-medium">
                    v{revision ?? "?"} ·{" "}
                    {entry.status === "changes_requested"
                      ? "Changes requested"
                      : entry.status === "superseded"
                        ? "Replaced by a newer revision"
                        : entry.status === "pending"
                          ? "Awaiting approval"
                          : "Approved"}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {memberName(data, entry.reviewerId)} ·{" "}
                    {formatDate(entry.resolvedAt ?? entry.createdAt)}
                  </p>
                  {entry.comment && (
                    <p className="mt-1 break-words whitespace-pre-wrap">
                      {entry.comment}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}
