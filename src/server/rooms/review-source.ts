export interface ReviewSource {
  drawingHash: string | null;
  /** Original, one-based PDF page, never the floor's import/display slot. */
  sourcePageNumber: number | null;
}

export class RoomReviewSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomReviewSourceError";
  }
}

const changedSource =
  "The source drawing or page changed after this outline was created. Run detection again or add a new outline before reviewing it.";
const unavailableSource =
  "The original drawing is unavailable. Restore it before reviewing this outline.";

function fingerprint(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value))
    throw new RoomReviewSourceError(
      "This outline has invalid source information. Run detection again or add a new outline before reviewing it.",
    );
  return value.toLowerCase();
}

/**
 * A human review may bind a legacy outline with no recorded source, but must
 * never relabel an existing proposal as coming from different drawing bytes or
 * a different page. Missing legacy sources stay unverified (drawingHash=null).
 * Call for every approved outline before any whole-floor confirmation writes.
 */
export function bindReviewSource(
  detection: unknown,
  source: ReviewSource,
): Record<string, unknown> {
  const previous =
    detection && typeof detection === "object" && !Array.isArray(detection)
      ? (detection as Record<string, unknown>)
      : {};
  const recordedHash = fingerprint(previous.drawingHash);
  const currentHash = fingerprint(source.drawingHash);
  if (recordedHash && !currentHash)
    throw new RoomReviewSourceError(unavailableSource);
  if (recordedHash && recordedHash !== currentHash)
    throw new RoomReviewSourceError(changedSource);

  const page = source.sourcePageNumber;
  if (page !== null && (!Number.isSafeInteger(page) || page < 1))
    throw new RoomReviewSourceError(unavailableSource);
  for (const [key, offset] of [
    ["sourcePageNumber", 0],
    ["sourcePageIndex", -1],
  ] as const) {
    const recorded = previous[key];
    if (recorded === undefined || recorded === null) continue;
    if (page === null) throw new RoomReviewSourceError(unavailableSource);
    if (recorded !== page + offset)
      throw new RoomReviewSourceError(changedSource);
  }

  return {
    ...previous,
    drawingHash: currentHash,
    ...(page === null
      ? {}
      : { sourcePageNumber: page, sourcePageIndex: page - 1 }),
  };
}
