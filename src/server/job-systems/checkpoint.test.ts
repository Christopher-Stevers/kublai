// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { checkpoint, checkpointEvaluator } from "./checkpoint";
it("reuses durable answers after recreating the evaluator but invalidates changed evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "assessment-checkpoint-"));
  const answer = {
    model: "test",
    answers: {
      q: { type: "choice" as const, choice: "yes", confidence: 0.99 },
    },
  };
  const run = vi.fn(async () => answer);
  const questions = {
    q: {
      type: "choice" as const,
      instructions: "Required?",
      criteria: { yes: "Yes", no: "No" },
    },
  };
  try {
    await checkpointEvaluator(root, run)({ text: "source A" }, questions);
    const resumed = checkpointEvaluator(root, run);
    expect(await resumed({ text: "source A" }, questions)).toEqual(answer);
    expect(run).toHaveBeenCalledTimes(1);
    await resumed({ text: "source B" }, questions);
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("never saves a failed batch and preserves earlier work", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "assessment-checkpoint-"));
  const parse = (value: unknown) => {
    if (typeof value !== "number") throw Error();
    return value;
  };
  try {
    await checkpoint(root, "first", parse, async () => 1);
    await expect(
      checkpoint(root, "second", parse, async () => {
        throw Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");
    const cached = vi.fn(async () => 2);
    expect(await checkpoint(root, "first", parse, cached)).toBe(1);
    expect(cached).not.toHaveBeenCalled();
    expect(await checkpoint(root, "second", parse, cached)).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
