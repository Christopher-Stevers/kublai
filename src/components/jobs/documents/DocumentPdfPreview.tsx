"use client";

import { DocumentDrawingWorkspace } from "./DocumentDrawingWorkspace";
import { PassiveDocumentPdfPreview } from "./PassiveDocumentPdfPreview";
import type { SnapshotState } from "~/lib/snapshot-source";

type PreviewProps = {
  url: string;
  title: string;
  onReady?: () => void;
  initialView?: SnapshotState["pdf"];
  fillHeight?: boolean;
  jobId?: string;
  versionId?: string;
  folderId?: string | null;
  onDocumentDetails?: () => void;
  onClose?: () => void;
};
/** Full document views use the actual Drawings workspace. Comparisons retain a passive preview. */
export function DocumentPdfPreview(props: PreviewProps) {
  if (props.jobId && props.versionId)
    return (
      <DocumentDrawingWorkspace
        jobId={props.jobId}
        versionId={props.versionId}
        folderId={props.folderId}
        initialView={props.initialView}
        onReady={props.onReady}
        onDocumentDetails={props.onDocumentDetails}
        onClose={props.onClose}
      />
    );
  return <PassiveDocumentPdfPreview {...props} />;
}

