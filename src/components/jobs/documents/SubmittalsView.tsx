"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  localDateKey,
  submittalRegister,
  submittalDueLabel,
  submittalStatus,
  submittalStatuses,
  type SubmittalStatus,
} from "~/lib/submittals";
import type { DocumentOverview, JobDocument } from "~/server/documents/types";
import { memberName, selectClass } from "./document-ui";

export function SubmittalBadge({
  document,
  data,
}: {
  document: JobDocument;
  data: DocumentOverview;
}) {
  return (
    <SubmittalStatusBadge status={submittalStatus(document, data.reviews)} />
  );
}
function SubmittalStatusBadge({ status }: { status: SubmittalStatus }) {
  const style = submittalStatuses[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${style.className}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {style.label}
    </span>
  );
}

export function SubmittalsView({
  data,
  canWrite,
  busy,
  onOpen,
  onUpload,
  onDrop,
}: {
  data: DocumentOverview;
  canWrite: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onDrop: (files: File[]) => void;
}) {
  const [filter, setFilter] = useState<
    "all" | "mine" | "overdue" | SubmittalStatus
  >("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [dragging, setDragging] = useState(false);
  const today = localDateKey();
  const documents = useMemo(
    () => submittalRegister(data, today),
    [data, today],
  );
  const categories = [
    ...new Set(
      documents.map((row) => row.document.submittal!.category).filter(Boolean),
    ),
  ].sort();
  const search = query.trim().toLocaleLowerCase();
  const filtered = documents.filter(
    (row) =>
      (filter === "all" ||
        (filter === "mine"
          ? row.mine
          : filter === "overdue"
            ? row.overdue
            : row.status === filter)) &&
      (!category || row.document.submittal!.category === category) &&
      row.search.includes(search),
  );
  const mine = documents.filter((row) => row.mine).length;
  const overdue = documents.filter((row) => row.overdue).length;
  return (
    <section
      aria-label="Submittal register"
      className="space-y-4"
      onDragOver={(event) => {
        event.preventDefault();
        if (canWrite && !busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (canWrite && !busy) onDrop(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Submittals</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            PDFs, revisions, and approvals in one place.
          </p>
        </div>
        {canWrite && (
          <Button onClick={onUpload} disabled={busy}>
            <UploadIcon />
            Upload PDFs
          </Button>
        )}
      </div>
      <div
        className="flex flex-wrap gap-2"
        aria-label="Submittal status filters"
      >
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All <span className="tabular-nums">{documents.length}</span>
        </Button>
        <Button
          variant={filter === "mine" ? "default" : "outline"}
          size="sm"
          aria-pressed={filter === "mine"}
          onClick={() => setFilter("mine")}
        >
          <ClipboardCheckIcon />
          Needs your review <span className="tabular-nums">{mine}</span>
        </Button>
        {(Object.keys(submittalStatuses) as SubmittalStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${submittalStatuses[status].className} ${filter === status ? "ring-offset-background ring-2 ring-current ring-offset-2" : "hover:brightness-110"}`}
          >
            {submittalStatuses[status].label}{" "}
            <span className="ml-1 tabular-nums">
              {documents.filter((row) => row.status === status).length}
            </span>
          </button>
        ))}
        {overdue > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filter === "overdue"}
            onClick={() => setFilter("overdue")}
            className="text-rose-700 dark:text-rose-300"
          >
            Overdue {overdue}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="text-muted-foreground absolute top-3 left-3 size-4" />
          <Input
            aria-label="Search submittals"
            placeholder="Search title, number, specification…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter submittals by category"
          className={`${selectClass} w-full sm:w-48`}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      {dragging && (
        <p
          role="status"
          className="border-primary bg-primary/10 rounded-lg border-2 border-dashed p-6 text-center font-medium"
        >
          Drop PDFs to upload submittals
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted/40 text-muted-foreground hidden grid-cols-[minmax(0,1fr)_12rem_10rem] gap-4 border-b px-4 py-3 text-xs font-medium md:grid">
          <span>SUBMITTAL</span>
          <span>STATUS / REVIEWER</span>
          <span>DUE DATE</span>
        </div>
        {filtered.map(
          ({ document, review, version, overdue: late, status }) => {
            const info = document.submittal!;
            return (
              <button
                type="button"
                key={document.id}
                onClick={() => onOpen(document.id)}
                className="hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-primary grid w-full gap-3 border-b px-4 py-4 text-left last:border-b-0 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:gap-4"
                aria-label={`Open ${info.number}: ${info.title}`}
              >
                <div className="flex min-w-0 gap-3">
                  <FileTextIcon className="text-muted-foreground mt-1 size-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-muted-foreground mb-1 text-xs font-medium">
                      {info.number} · v{version?.number ?? 1}
                    </div>
                    <p className="font-semibold break-words">{info.title}</p>
                    <p className="text-muted-foreground mt-1 text-xs break-words">
                      {[
                        info.category,
                        info.specSection && `Spec ${info.specSection}`,
                        info.manufacturer,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Uncategorized"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:block">
                  <SubmittalStatusBadge status={status} />
                  {review?.status === "pending" && (
                    <p className="text-muted-foreground text-xs md:mt-2">
                      {review.reviewerId === data.capabilities.userId ? (
                        <span className="text-primary font-semibold">
                          Your approval is needed
                        </span>
                      ) : (
                        memberName(data, review.reviewerId)
                      )}
                    </p>
                  )}
                  {review?.status === "changes_requested" && (
                    <p className="text-xs text-rose-700 md:mt-2 dark:text-rose-300">
                      Returned for changes
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs ${late ? "font-semibold text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}
                  >
                    {info.dueDate
                      ? `${late ? "Overdue · " : "Due "}${submittalDueLabel(info.dueDate)}`
                      : "No due date"}
                  </span>
                  <ArrowUpRightIcon className="text-muted-foreground size-4 shrink-0" />
                </div>
              </button>
            );
          },
        )}
        {!filtered.length && (
          <div className="px-6 py-12 text-center">
            <FileTextIcon className="text-muted-foreground mx-auto mb-3 size-8" />
            <p className="font-medium">
              {documents.length
                ? "No matching submittals"
                : "Your submittal register starts here"}
            </p>
            <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
              {documents.length
                ? "Try another status, category, or search."
                : "Upload product data, shop drawings, and other PDFs. Each gets a reference number and its own approval history."}
            </p>
            {documents.length > 0 ? (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setFilter("all");
                  setCategory("");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              canWrite && (
                <Button className="mt-4" onClick={onUpload} disabled={busy}>
                  <UploadIcon />
                  Upload your first PDF
                </Button>
              )
            )}
          </div>
        )}
      </div>
      {canWrite && (
        <p className="text-muted-foreground text-xs">
          Drop PDFs here or use Upload PDFs. Up to 50 MB per file; multiple
          files upload one at a time.
        </p>
      )}
    </section>
  );
}
