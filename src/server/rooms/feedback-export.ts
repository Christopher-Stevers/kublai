import { createHash } from "node:crypto";
import { toPolygon } from "~/lib/room-shape";
import { validReviewShape } from "./review-memory";
import { getSourcePageFromFloorImage } from "./storage";

export type FeedbackExportEvent = {
  roomId: string;
  floorId: string;
  jobId: string;
  decision: string;
  drawingKey: string;
  proposalShape: unknown;
  correctedShape: unknown;
  detection: unknown;
  createdAt: Date;
};
export type FeedbackExportFloor = {
  id: string;
  jobId: string;
  imageUrl: string;
  pageNumber: number;
  status: string;
  confirmedAt: Date | null;
  completenessReviewedAt: Date | null;
};
export type FeedbackExportRoom = {
  id: string;
  floorId: string;
  reviewStatus: string;
  shape: unknown;
  detection?: unknown;
};

export function reviewDrawingHash(detection: unknown): string | null {
  const hash = (detection as { drawingHash?: unknown } | null)?.drawingHash;
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)
    ? hash.toLowerCase()
    : null;
}

function reviewSourcePageMatches(
  detection: unknown,
  sourcePageNumber: number | null,
) {
  if (
    sourcePageNumber !== null &&
    (!Number.isSafeInteger(sourcePageNumber) || sourcePageNumber < 1)
  )
    return false;
  const recorded = detection as Record<string, unknown> | null;
  // Legacy reviews identify their page through drawingKey. Explicit recorded
  // page information must never contradict the original page from that key.
  for (const [key, offset] of [
    ["sourcePageNumber", 0],
    ["sourcePageIndex", -1],
  ] as const) {
    const value = recorded?.[key];
    if (value === undefined || value === null) continue;
    if (sourcePageNumber === null || value !== sourcePageNumber + offset)
      return false;
  }
  return true;
}

export function reviewSourceMatches(
  detection: unknown,
  sourceHash: string,
  sourcePageNumber?: number | null,
) {
  return (
    reviewDrawingHash(detection) === sourceHash.toLowerCase() &&
    (sourcePageNumber === undefined ||
      reviewSourcePageMatches(detection, sourcePageNumber))
  );
}

export function partitionVerifiedExamples<
  T extends {
    floorId: string;
    detection: unknown;
    sourcePageNumber?: number | null;
  },
>(snapshots: T[], sourceHashes: Map<string, string>) {
  const verified = snapshots.filter((example) => {
    const hash = sourceHashes.get(example.floorId);
    return (
      hash !== undefined &&
      reviewSourceMatches(example.detection, hash, example.sourcePageNumber)
    );
  });
  const verifiedSet = new Set(verified);
  return {
    examples: verified.map((example) => ({
      ...example,
      sourceVerified: true as const,
    })),
    unverifiedExamples: snapshots
      .filter((example) => !verifiedSet.has(example))
      .map((example) => ({
        ...example,
        sourceVerified: false as const,
        exclusionReason:
          "Review-time source hash or page is missing or differs from the copied source PDF. Not verified training/evaluation ground truth.",
      })),
  };
}

export function feedbackSplit(jobId: string) {
  return parseInt(
    createHash("sha256").update(jobId).digest("hex").slice(0, 8),
    16,
  ) %
    5 ===
    0
    ? ("holdout" as const)
    : ("development" as const);
}

/** Immutable review snapshots, never a later room's mutable replacement geometry. */
export function buildFeedbackExamples(
  events: FeedbackExportEvent[],
  floors: FeedbackExportFloor[],
  rooms: FeedbackExportRoom[],
) {
  const byFloor = new Map(floors.map((floor) => [floor.id, floor]));
  const byRoom = new Map(rooms.map((room) => [room.id, room]));
  const newest = new Map<string, FeedbackExportEvent>();
  // The database supplies descending microsecond timestamps; preserve that order.
  for (const event of events)
    if (!newest.has(event.roomId)) newest.set(event.roomId, event);
  return [...newest.values()].flatMap((event) => {
    const floor = byFloor.get(event.floorId);
    if (
      !floor ||
      event.drawingKey !== `${floor.imageUrl}:${floor.pageNumber}` ||
      !reviewSourcePageMatches(
        event.detection,
        getSourcePageFromFloorImage(floor.imageUrl),
      ) ||
      !["approved", "rejected"].includes(event.decision) ||
      !validReviewShape(event.proposalShape)
    )
      return [];
    const current = byRoom.get(event.roomId);
    // A removed/reset manual room is not current positive ground truth. Its
    // historical event remains in the database, but cannot score today's sheet.
    if (
      event.decision === "approved" &&
      (current?.floorId !== event.floorId ||
        current.reviewStatus !== "approved" ||
        !validReviewShape(current.shape) ||
        JSON.stringify(toPolygon(current.shape)) !==
          JSON.stringify(toPolygon(event.proposalShape)))
    )
      return [];
    return [
      {
        id: event.roomId,
        group: event.jobId,
        floorId: event.floorId,
        split: feedbackSplit(event.jobId),
        drawingKey: event.drawingKey,
        sourcePageNumber: getSourcePageFromFloorImage(floor.imageUrl),
        detection: event.detection,
        decision: event.decision,
        sourceReviewHash: reviewDrawingHash(event.detection),
        reviewReason:
          (event.detection as { reviewReason?: string } | null)?.reviewReason ??
          null,
        proposal: toPolygon(event.proposalShape),
        corrected:
          event.decision === "approved" ? toPolygon(event.proposalShape) : null,
        reviewedAt: event.createdAt.toISOString(),
        correctionHistory: events
          .filter(
            (other) =>
              other.roomId === event.roomId &&
              other.drawingKey === event.drawingKey &&
              other.decision === "corrected" &&
              reviewDrawingHash(event.detection) !== null &&
              reviewSourceMatches(
                other.detection,
                reviewDrawingHash(event.detection)!,
                getSourcePageFromFloorImage(floor.imageUrl),
              ) &&
              validReviewShape(other.proposalShape) &&
              validReviewShape(other.correctedShape),
          )
          .map((other) => ({
            proposal: other.proposalShape,
            corrected: other.correctedShape,
            sourceReviewHash: reviewDrawingHash(other.detection),
            sourcePageNumber: getSourcePageFromFloorImage(floor.imageUrl),
            correctedAt: other.createdAt.toISOString(),
          })),
      },
    ];
  });
}

export function buildFeedbackFloor(
  floor: FeedbackExportFloor,
  rooms: FeedbackExportRoom[],
) {
  const drawingKey = `${floor.imageUrl}:${floor.pageNumber}`;
  const sourcePageNumber = getSourcePageFromFloorImage(floor.imageUrl);
  const active = rooms.filter(
    (room) =>
      room.floorId === floor.id &&
      room.reviewStatus !== "rejected" &&
      room.reviewStatus !== "superseded",
  );
  const approved = active.filter((room) => room.reviewStatus === "approved");
  const hashes = approved.map((room) => reviewDrawingHash(room.detection));
  const sourceReviewHash =
    hashes.length > 0 &&
    hashes.every((hash) => hash !== null && hash === hashes[0])
      ? hashes[0]!
      : null;
  const complete =
    floor.status === "confirmed" &&
    active.length > 0 &&
    active.every(
      (room) =>
        room.reviewStatus === "approved" && validReviewShape(room.shape),
    ) &&
    approved.every((room) =>
      reviewSourcePageMatches(room.detection, sourcePageNumber),
    ) &&
    floor.completenessReviewedAt !== null &&
    floor.confirmedAt !== null &&
    sourceReviewHash !== null;
  return {
    floorId: floor.id,
    jobId: floor.jobId,
    group: floor.jobId,
    split: feedbackSplit(floor.jobId),
    drawingKey,
    sourcePageNumber,
    completenessReviewed: complete,
    sourceReviewHash,
    floorStatus: floor.status,
    floorConfirmedAt: floor.confirmedAt?.toISOString() ?? null,
    completenessReviewedAt: floor.completenessReviewedAt?.toISOString() ?? null,
    reviewCompletenessProvenance: complete
      ? "User explicitly attested that the entire floor was checked and missing rooms added. This is a human completeness assertion."
      : "Current complete-room review lacks an attestation or consistent reviewed source bytes; legacy confirmation alone is insufficient.",
    approvedRooms: active.flatMap((room) =>
      room.reviewStatus === "approved" && validReviewShape(room.shape)
        ? [{ id: room.id, shape: toPolygon(room.shape) }]
        : [],
    ),
  };
}

/** Only the current attested approved snapshot matters, never superseded history. */
export function verifyFeedbackFloorSource<
  T extends ReturnType<typeof buildFeedbackFloor>,
>(floor: T, copiedSourceHash: string): T {
  if (floor.sourceReviewHash !== copiedSourceHash.toLowerCase())
    return {
      ...floor,
      completenessReviewed: false,
      reviewCompletenessProvenance:
        "Approved outlines have unknown or changed source bytes. Review and attest the current drawing again before using complete-floor ground truth.",
    };
  return floor;
}
