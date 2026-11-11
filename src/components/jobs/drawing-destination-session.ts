import type { DrawingSave, DrawingEntity } from "~/lib/drawing-workspace";
import type { SnapshotSource } from "~/lib/snapshot-source";

export type MarkupSave = Extract<DrawingSave, { kind: "markup" }>;
export type DestinationRequest = {
  jobId: string;
  draft: MarkupSave;
  baseEntity?: DrawingEntity;
  authorName: string;
};
export type DestinationSessionRequest = DestinationRequest & {
  returnTo: SnapshotSource;
};
export type DestinationResume = DestinationSessionRequest & { saved: boolean };
export type DestinationSession =
  | { phase: "picking"; request: DestinationSessionRequest }
  | { phase: "resume"; request: DestinationResume };
