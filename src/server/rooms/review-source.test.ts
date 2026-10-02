import { describe, expect, it } from "vitest";
import { bindReviewSource, RoomReviewSourceError } from "./review-source";

const source = { drawingHash: "a".repeat(64), sourcePageNumber: 18 };

describe("review source binding", () => {
  it("preserves detector metadata and holes evidence without mutating input", () => {
    const detection = Object.freeze({
      drawingHash: source.drawingHash,
      sourcePageNumber: 18,
      sourcePageIndex: 17,
      version: "physical-fixture",
      holeCount: 2,
      requiresReview: true,
    });
    expect(bindReviewSource(detection, source)).toEqual(detection);
    expect(bindReviewSource(detection, source)).not.toBe(detection);
  });

  it("normalizes valid uppercase fingerprints", () => {
    expect(
      bindReviewSource(
        { drawingHash: source.drawingHash.toUpperCase() },
        source,
      ).drawingHash,
    ).toBe(source.drawingHash);
  });

  it("refuses to rebind an old outline to replacement PDF bytes", () => {
    expect(() =>
      bindReviewSource({ drawingHash: "b".repeat(64) }, source),
    ).toThrow(/drawing or page changed/);
  });

  it.each([
    { sourcePageNumber: 19 },
    { sourcePageIndex: 18 },
    { sourcePageNumber: 18, sourcePageIndex: 18 },
    { sourcePageNumber: "18" },
  ])("refuses same-PDF wrong-page provenance: %j", (recorded) => {
    expect(() => bindReviewSource(recorded, source)).toThrow(
      RoomReviewSourceError,
    );
  });

  it.each(["not-a-hash", "", 123])(
    "does not turn malformed existing provenance into verified truth: %j",
    (drawingHash) => {
      expect(() => bindReviewSource({ drawingHash }, source)).toThrow(
        /invalid source information/,
      );
    },
  );

  it("does not erase a recorded fingerprint when its source disappears", () => {
    expect(() =>
      bindReviewSource(source, { ...source, drawingHash: null }),
    ).toThrow(/unavailable/);
  });

  it("does not ignore a recorded page when its source cannot be resolved", () => {
    expect(() =>
      bindReviewSource(source, { ...source, sourcePageNumber: null }),
    ).toThrow(/unavailable/);
  });

  it.each([null, {}, { drawingHash: null, version: "legacy" }])(
    "binds previously unrecorded provenance during a real human review: %j",
    (detection) => {
      expect(bindReviewSource(detection, source)).toMatchObject({
        drawingHash: source.drawingHash,
        sourcePageNumber: 18,
        sourcePageIndex: 17,
      });
    },
  );

  it("allows legacy manual work without fabricating a source fingerprint", () => {
    expect(
      bindReviewSource(
        { basis: "human-added-space" },
        {
          drawingHash: null,
          sourcePageNumber: null,
        },
      ),
    ).toEqual({ basis: "human-added-space", drawingHash: null });
  });
});
