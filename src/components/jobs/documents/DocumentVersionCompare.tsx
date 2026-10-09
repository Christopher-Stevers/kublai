"use client";

import { DownloadIcon } from "lucide-react";
import { DocumentPdfPreview } from "./DocumentPdfPreview";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { DocumentVersion } from "~/server/documents/types";

function VersionPane({
  version,
  jobId,
}: {
  version: DocumentVersion;
  jobId: string;
}) {
  const url = `/api/job-documents/files/${encodeURIComponent(version.id)}?jobId=${encodeURIComponent(jobId)}`;
  const image = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
    version.mimeType,
  );
  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-2"
      aria-label={`Version ${version.number}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">Version {version.number}</h3>
          <p className="text-muted-foreground truncate text-xs">
            {version.name} · {new Date(version.createdAt).toLocaleString()}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`${url}&download=1`}>
            <DownloadIcon className="mr-1 h-4 w-4" />
            Download v{version.number}
          </a>
        </Button>
      </div>
      {version.mimeType === "application/pdf" ? (
        <DocumentPdfPreview
          key={version.id}
          title={`PDF version ${version.number}`}
          url={url}
        />
      ) : image ? (
        <div className="bg-muted/30 flex min-h-[35vh] flex-1 items-center justify-center overflow-auto rounded-md border p-2">
          {/* Browser requests carry the session; the image optimizer cannot. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`${version.name}, version ${version.number}`}
            className="max-h-[65vh] max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="text-muted-foreground flex min-h-48 flex-1 items-center justify-center rounded-md border p-6 text-center text-sm">
          Download this revision to compare it in its original application.
        </div>
      )}
    </section>
  );
}

/** Authenticated saved revisions; no third-party viewer receives private file URLs. */
export function DocumentVersionCompare({
  jobId,
  current,
  previous,
  onClose,
}: {
  jobId: string;
  current: DocumentVersion;
  previous: DocumentVersion;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[95dvh] w-[96vw] max-w-[96vw] flex-col overflow-auto sm:max-w-[96vw]">
        <DialogHeader>
          <DialogTitle>Compare saved revisions</DialogTitle>
          <DialogDescription>
            View the two versions side by side. Changes are not highlighted
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5 lg:flex-row">
          <VersionPane version={previous} jobId={jobId} />
          <VersionPane version={current} jobId={jobId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
