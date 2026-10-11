import { toPolygon } from "~/lib/room-shape";
import { validReviewShape } from "./review-memory";
import { bindReviewSource, type ReviewSource } from "./review-source";

export type RoomEditSnapshot = { name: string; shape: unknown };
export type RoomEditDecision =
  | "added"
  | "corrected"
  | "renamed"
  | "rejected"
  | "cleared";

function sameShape(left: unknown, right: unknown) {
  if (validReviewShape(left) && validReviewShape(right))
    return JSON.stringify(toPolygon(left)) === JSON.stringify(toPolygon(right));
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Capture actions, not inferred approval of everything a user leaves untouched. */
export function roomEditFeedback(input: {
  before: RoomEditSnapshot | null;
  after: RoomEditSnapshot | null;
  detection: unknown;
  source: ReviewSource;
  observedRunId?: string | null;
  clear?: boolean;
}) {
  const { before, after } = input;
  if (!before && !after) return null;
  let decision: RoomEditDecision;
  if (!before) decision = "added";
  else if (!after) decision = input.clear ? "cleared" : "rejected";
  else if (!sameShape(before.shape, after.shape)) decision = "corrected";
  else if (before.name !== after.name) decision = "renamed";
  else return null;
  const detection = bindReviewSource(input.detection, input.source);
  return {
    decision,
    name: before?.name ?? after!.name,
    proposalShape: before?.shape ?? after!.shape,
    correctedShape:
      decision === "added" || decision === "corrected" ? after!.shape : null,
    detection: {
      ...detection,
      // The original proposal runId is preserved; manual additions have no
      // originating model run. This separate field captures the edit context.
      observedRunId: input.observedRunId ?? null,
      userEdited: true,
      editAction: decision === "rejected" ? "deleted" : decision,
      suppressionOnly: decision === "rejected",
      userEdit: { before, after },
    },
  };
}
