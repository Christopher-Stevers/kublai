// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  duplicateTask,
  makeRequest,
  searchTask,
  suggestions,
  type Part,
} from "./decisions";
import { summarizeRoomShape } from "./room-review";
const part: Part = {
  id: "one",
  name: "Copper elbow",
  description: null,
  size: "2 inch",
  sizeId: "2",
  material: "Copper",
  materialId: "cu",
  category: null,
  categoryId: null,
};
describe("review decisions", () => {
  it("prevents a model from declaring known material conflicts a match", () => {
    const task = duplicateTask(part, { ...part, id: "two", materialId: "abs" });
    expect(task.options).not.toHaveProperty("same");
    expect(task.forcedReview).toContain("materials differ");
  });
  it("guards complete size labels even if primary size IDs agree", () => {
    const task = duplicateTask(part, {
      ...part,
      id: "two",
      size: "2 x 1 inch",
    });
    expect(task.options).not.toHaveProperty("same");
  });
  it("keeps every parallel question tied to its own record", () => {
    const request = makeRequest([
      searchTask("elbow", part),
      searchTask("tee", { ...part, id: "two" }),
    ]);
    expect(request.questions.q0?.instructions).toContain(
      "ONLY state.records.q0",
    );
    expect(request.questions.q1?.instructions).toContain(
      "ONLY state.records.q1",
    );
    expect(request.state).toMatchObject({
      records: { q0: { query: "elbow" }, q1: { query: "tee" } },
    });
  });
  it("prioritizes uncertainty and deterministic concerns over model confidence", () => {
    const tasks = [
      searchTask("elbow", part),
      duplicateTask(part, { ...part, id: "two", materialId: "abs" }),
    ];
    const result = suggestions(tasks, {
      q0: {
        type: "choice",
        choice: "match",
        confidence: 0.99,
        probabilities: { match: 0.99, uncertain: 0.01, different: 0 },
      },
      q1: {
        type: "choice",
        choice: "different",
        confidence: 0.99,
        probabilities: { different: 0.99, uncertain: 0.01 },
      },
    });
    expect(result[0]?.priority).toBe("review");
    expect(result[0]?.reason).toContain("materials differ");
    expect(result[1]?.priority).toBe("suggestion");
  });
  it("flags malformed and out-of-bounds geometry without repairing saved shapes", () => {
    expect(summarizeRoomShape({}).warning).toContain("invalid");
    const shape = { type: "bbox", x: 0.9, y: 0, w: 0.2, h: 0.5 };
    expect(summarizeRoomShape(shape).warning).toContain("outside");
    expect(shape.w).toBe(0.2);
  });
  it("bounds provider geometry for complex rooms while retaining area", () => {
    const points = Array.from({ length: 101 }, (_, i) => ({
      x: 0.5 + 0.2 * Math.cos((i * 2 * Math.PI) / 101),
      y: 0.5 + 0.2 * Math.sin((i * 2 * Math.PI) / 101),
    }));
    const result = summarizeRoomShape({ type: "polygon", points });
    expect(result.geometry?.points).toBeUndefined();
    expect(result.geometry?.normalizedArea).toBeCloseTo(Math.PI * 0.04, 3);
  });
});
