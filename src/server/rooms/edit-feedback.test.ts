// @vitest-environment node
import { describe, expect, it } from "vitest";
import { roomEditFeedback } from "./edit-feedback";
import { RoomReviewSourceError } from "./review-source";

const shape = { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.3 };
const before = { name: "Hallway", shape };
const source = { drawingHash: "a".repeat(64), sourcePageNumber: 18 };
const detection = { ...source, runId: "original-run" };
const input = {
  before,
  after: before,
  source,
  detection,
  observedRunId: "latest-run",
};

describe("automatic room-edit feedback", () => {
  it("does not treat unchanged rooms as approved training examples", () => {
    expect(roomEditFeedback(input)).toBeNull();
    expect(
      roomEditFeedback({ ...input, before: null, after: null }),
    ).toBeNull();
  });
  it("records manual additions on the original PDF page", () => {
    expect(
      roomEditFeedback({ ...input, before: null, detection: {} }),
    ).toMatchObject({
      decision: "added",
      proposalShape: shape,
      correctedShape: shape,
      detection: {
        drawingHash: source.drawingHash,
        sourcePageNumber: 18,
        sourcePageIndex: 17,
        observedRunId: "latest-run",
        userEdited: true,
        userEdit: { before: null, after: before },
      },
    });
  });
  it("records a rename without inventing a geometry correction", () => {
    expect(
      roomEditFeedback({
        ...input,
        after: { ...before, name: "Common hallway" },
      }),
    ).toMatchObject({
      decision: "renamed",
      proposalShape: shape,
      correctedShape: null,
      detection: {
        runId: "original-run",
        observedRunId: "latest-run",
        userEdit: { before, after: { ...before, name: "Common hallway" } },
      },
    });
  });
  it("records corrected boundaries and preserves polygon holes", () => {
    const corrected = {
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      holes: [
        [
          { x: 0.4, y: 0.4 },
          { x: 0.6, y: 0.4 },
          { x: 0.6, y: 0.6 },
          { x: 0.4, y: 0.6 },
        ],
      ],
    };
    expect(
      roomEditFeedback({ ...input, after: { ...before, shape: corrected } }),
    ).toMatchObject({
      decision: "corrected",
      proposalShape: shape,
      correctedShape: corrected,
    });
  });
  it("uses single deletions only as suppression evidence and distinguishes clearing a floor", () => {
    expect(roomEditFeedback({ ...input, after: null })).toMatchObject({
      decision: "rejected",
      correctedShape: null,
      detection: { suppressionOnly: true, editAction: "deleted" },
    });
    expect(
      roomEditFeedback({ ...input, after: null, clear: true }),
    ).toMatchObject({
      decision: "cleared",
      detection: { suppressionOnly: false },
    });
  });
  it("refuses to associate old proposals with a different drawing or page", () => {
    expect(() =>
      roomEditFeedback({
        ...input,
        after: null,
        source: { ...source, drawingHash: "b".repeat(64) },
      }),
    ).toThrow(RoomReviewSourceError);
    expect(() =>
      roomEditFeedback({
        ...input,
        after: null,
        source: { ...source, sourcePageNumber: 19 },
      }),
    ).toThrow(RoomReviewSourceError);
  });
});
