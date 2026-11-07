// @vitest-environment node
import { expect, it, vi, afterEach } from "vitest";
import { backgroundScheduler } from "./scheduler";
import { acceptBackgroundHint, onBackgroundHint } from "./hints";
import { canDispatchBackground } from "./mode";
import { workerCommand } from "./command";
afterEach(() => vi.unstubAllEnvs());
it("limits concurrent heavy tasks and admits waiting features fairly", async () => {
  const releases: Array<() => void> = [],
    seen: string[] = [];
  const scheduler = backgroundScheduler(
    ["a", "b", "c"].map((name) => ({
      name,
      run: () => {
        seen.push(name);
        return new Promise<void>((r) => releases.push(r));
      },
    })),
    2,
  );
  scheduler.tick();
  await Promise.resolve();
  expect(seen).toEqual(["a", "b"]);
  scheduler.tick();
  expect(scheduler.active()).toEqual(["a", "b"]);
  releases[0]!();
  await new Promise((r) => setTimeout(r, 0));
  scheduler.tick();
  await Promise.resolve();
  expect(seen).toEqual(["a", "b", "c"]);
  const stopping = scheduler.stop();
  releases.slice(1).forEach((r) => r());
  await stopping;
  scheduler.tick();
  expect(scheduler.active()).toEqual([]);
  expect(seen).toHaveLength(3);
});
it("reads packing slips while other features fill every slot", async () => {
  const releases: Record<string, () => void> = {},
    seen: string[] = [];
  const scheduler = backgroundScheduler(
    ["rooms", "models", "packing-slips", "assessments"].map((name) => ({
      name,
      run: () => {
        seen.push(name);
        return new Promise<void>((r) => (releases[name] = r));
      },
    })),
    2,
  );
  scheduler.tick();
  await Promise.resolve();
  expect(seen).toEqual(["packing-slips", "rooms", "models"]);
  // A finished slip frees no other feature's slot.
  releases["packing-slips"]!();
  await new Promise((r) => setTimeout(r, 0));
  scheduler.tick();
  await Promise.resolve();
  expect(seen).toEqual(["packing-slips", "rooms", "models", "packing-slips"]);
  const stopping = scheduler.stop();
  Object.values(releases).forEach((r) => r());
  await stopping;
});
it("starts a queued slip at once and reads the next as soon as one is read", async () => {
  const queue = ["one", "two"],
    seen: string[] = [],
    rooms = vi.fn(async () => undefined);
  const scheduler = backgroundScheduler(
    [
      {
        name: "packing-slips",
        run: async () => {
          const slip = queue.shift();
          if (slip) seen.push(slip);
          return !!slip;
        },
      },
      { name: "rooms", run: rooms },
    ],
    2,
  );
  const queued = () =>
    acceptBackgroundHint(
      JSON.stringify({
        origin: "00000000-0000-4000-8000-000000000001",
        hint: { topic: "work", feature: "packing-slips" },
      }),
    );
  // No tick: the hint alone starts the reading, and the queue drains.
  queued();
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual(["one", "two"]);
  expect(rooms).not.toHaveBeenCalled();
  await scheduler.stop();
  queue.push("three");
  queued();
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual(["one", "two"]);
});
it("releases a failed feature slot and keeps dispatching", async () => {
  const error = vi.fn(),
    next = vi.fn(async () => undefined);
  const scheduler = backgroundScheduler(
    [
      {
        name: "bad",
        run: async () => {
          throw Error("private details");
        },
      },
      { name: "next", run: next },
    ],
    1,
    error,
  );
  scheduler.tick();
  await new Promise((r) => setTimeout(r, 0));
  scheduler.tick();
  await scheduler.stop();
  expect(error).toHaveBeenCalledWith("bad");
  expect(next).toHaveBeenCalledOnce();
});
it("accepts only bounded identifier hints", () => {
  const listener = vi.fn(),
    stop = onBackgroundHint(listener),
    origin = "00000000-0000-4000-8000-000000000001";
  acceptBackgroundHint(
    JSON.stringify({
      origin,
      hint: {
        topic: "conversation",
        conversationId: "one",
        text: "do not forward content",
      },
    }),
  );
  expect(listener).toHaveBeenCalledWith({
    topic: "conversation",
    conversationId: "one",
  });
  acceptBackgroundHint("bad");
  acceptBackgroundHint(
    JSON.stringify({ origin, hint: { topic: "execute", command: "x" } }),
  );
  acceptBackgroundHint("x".repeat(5000));
  expect(listener).toHaveBeenCalledOnce();
  stop();
});
it("keeps dispatch out of the separate-mode web process", () => {
  vi.stubEnv("FOREMANHQ_BACKGROUND_MODE", "separate");
  vi.stubEnv("FOREMANHQ_PROCESS_ROLE", "web");
  expect(canDispatchBackground()).toBe(false);
  vi.stubEnv("FOREMANHQ_PROCESS_ROLE", "worker");
  expect(canDispatchBackground()).toBe(true);
});
it("uses release-pinned compiled children and rejects path traversal", () => {
  vi.stubEnv("FOREMANHQ_WORKER_BUNDLE", "/release/123");
  expect(workerCommand("src/server/job-systems/extract-worker.ts")).toEqual([
    "/release/123/server/job-systems/extract-worker.mjs",
  ]);
  expect(() => workerCommand("src/server/../../secrets.ts")).toThrow();
});
