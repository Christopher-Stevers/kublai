"use client";

import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import type { SystemEvidence } from "~/lib/job-systems";
import { makeSnapshotSource } from "~/lib/snapshot-source";

/** Open the cited version and its one-based PDF page in the existing viewer. */
export function systemEvidenceHref(jobId: string, evidence: SystemEvidence) {
  if (evidence.drawing)
    return makeSnapshotSource(
      `/dashboard/jobs/${jobId}/drawings`,
      {
        version: 1,
        drawing: {
          jobId,
          ...evidence.drawing,
          viewport: { center: { x: 0.5, y: 0.5 }, zoom: 1 },
          appearance: { inverted: false, lineColor: null },
          layers: {
            markups: true,
            issues: true,
            private: true,
            published: true,
          },
          selectedId: null,
          search: "",
        },
      },
      evidence.documentTitle,
    ).href;
  return makeSnapshotSource(
    `/dashboard/jobs/${jobId}/documents`,
    {
      version: 1,
      document: {
        jobId,
        documentId: evidence.documentId,
        versionId: evidence.versionId,
        tab: "details",
        viewer: "preview",
      },
      ...(evidence.page
        ? { pdf: { page: evidence.page, zoom: 1, left: 0, top: 0 } }
        : {}),
    },
    evidence.documentTitle,
  ).href;
}

export function JobSystemEvidence({
  jobId,
  evidence,
  title = "Source evidence",
}: {
  jobId: string;
  evidence: SystemEvidence[];
  title?: string;
}) {
  if (!evidence.length)
    return (
      <p className="text-muted-foreground text-xs">
        No source passage attached. Verify this requirement before use.
      </p>
    );
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {title} ({evidence.length})
      </summary>
      <div className="mt-3 space-y-4">
        {evidence.map((source) => (
          <div key={source.id} className="space-y-2">
            <Link
              className="text-primary inline-flex items-start gap-1.5 underline underline-offset-2"
              href={systemEvidenceHref(jobId, source)}
            >
              <FileTextIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {source.documentTitle}
                {source.section && ` · ${source.section}`}
                {source.page && ` · page ${source.page}`}
              </span>
            </Link>
            <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap">
              {source.quote}
            </blockquote>
          </div>
        ))}
      </div>
    </details>
  );
}
