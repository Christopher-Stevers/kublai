import { toPolygon, shapeBBox, type RoomShape } from "~/lib/room-shape";
import { roomArea } from "./supplementary-rooms";
import { validReviewShape } from "./review-memory";
type Example = {
  roomId: string;
  floorId: string;
  decision: string;
  proposalShape: unknown;
  detection: unknown;
};
function signature(shape: RoomShape, detection: unknown) {
  const polygon = toPolygon(shape),
    area = roomArea(polygon),
    box = shapeBBox(polygon);
  const size =
    area < 0.0002
      ? "tiny"
      : area < 0.001
        ? "small"
        : area < 0.01
          ? "medium"
          : area < 0.05
            ? "large"
            : "huge";
  const aspect =
    Math.max(box.w / box.h, box.h / box.w) > 5 ? "narrow" : "regular";
  const labeled =
    (detection as { basis?: string } | null)?.basis === "label-and-walls";
  return `${size}:${aspect}:${polygon.holes?.length ? "holes" : "solid"}:${labeled ? "label" : "no-label"}`;
}
/** A conservative human-feedback ranker; never authorizes deletion/approval. */
export function trainReviewRanker(events: Example[]) {
  const latest = new Map<string, Example>();
  for (const event of events)
    if (!latest.has(event.roomId)) latest.set(event.roomId, event);
  const bins = new Map<
    string,
    { approved: number; rejected: number; floors: Set<string> }
  >();
  for (const e of latest.values()) {
    if (e.decision !== "approved" && e.decision !== "rejected") continue;
    if (!validReviewShape(e.proposalShape)) continue;
    const key = signature(e.proposalShape, e.detection);
    const bin = bins.get(key) ?? {
      approved: 0,
      rejected: 0,
      floors: new Set<string>(),
    };
    bin[e.decision]++;
    bin.floors.add(e.floorId);
    bins.set(key, bin);
  }
  return (shape: RoomShape, detection: unknown) => {
    if (
      (detection as { invalidGeometry?: unknown } | null)?.invalidGeometry ===
        true ||
      !validReviewShape(shape)
    )
      return {
        priority: 1,
        examples: 0,
        floors: 0,
        reason: "invalid-geometry" as const,
      };
    const bin = bins.get(signature(shape, detection));
    // Repeated opinions on one sheet do not justify generalizing to another.
    if (!bin || bin.floors.size < 3 || bin.approved + bin.rejected < 10)
      return null;
    return {
      priority: (bin.rejected + 2) / (bin.approved + bin.rejected + 4),
      examples: bin.approved + bin.rejected,
      floors: bin.floors.size,
    };
  };
}
