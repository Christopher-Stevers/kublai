import { expect, it, vi } from "vitest";
import { DrawingDownloadQueue } from "./drawing-download-queue";
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
it("accepts multiple sets, limits active transfers, and continues without page subscribers", async () => {
  const queue = new DrawingDownloadQueue(2),
    releases: (() => void)[] = [];
  const work = vi.fn(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  const unsubscribe = queue.subscribe(vi.fn());
  for (let i = 0; i < 5; i++)
    queue.enqueue({ id: String(i), account: "alice", label: "Set" }, work);
  await flush();
  expect(work).toHaveBeenCalledTimes(2);
  expect(queue.getSnapshot().filter((t) => t.status === "queued")).toHaveLength(
    3,
  );
  unsubscribe();
  releases[0]!();
  await flush();
  expect(work).toHaveBeenCalledTimes(3);
  releases[1]!();
  await flush();
  releases[2]!();
  await flush();
  releases[3]!();
  await flush();
  releases[4]!();
  await flush();
  expect(queue.getSnapshot().every((t) => t.status === "complete")).toBe(true);
});
it("deduplicates active sets and cancels queued work without starting it", async () => {
  const queue = new DrawingDownloadQueue(1);
  let release!: () => void;
  const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    ),
    next = vi.fn(async () => undefined);
  const task = { id: "one", account: "alice", label: "One" };
  queue.enqueue(task, first);
  queue.enqueue(task, first);
  queue.enqueue({ ...task, id: "two" }, next);
  queue.cancel("two");
  await flush();
  expect(first).toHaveBeenCalledTimes(1);
  release();
  await flush();
  expect(next).not.toHaveBeenCalled();
});
it("cancels transfers on account change and lets failed tasks retry", async () => {
  const queue = new DrawingDownloadQueue();
  let signal!: AbortSignal;
  queue.enqueue({ id: "one", account: "alice", label: "One" }, async (s) => {
    signal = s;
    await new Promise<void>((resolve) =>
      s.addEventListener("abort", () => resolve()),
    );
  });
  await flush();
  queue.cancelOtherAccounts("bob");
  await flush();
  expect(signal.aborted).toBe(true);
  const task = { id: "two", account: "bob", label: "Two" };
  queue.enqueue(task, async () => {
    throw new Error("No space");
  });
  await flush();
  expect(queue.getSnapshot().find((t) => t.id === "two")?.progress).toBe(
    "No space",
  );
  queue.enqueue(task, async () => undefined);
  await flush();
  expect(queue.getSnapshot().find((t) => t.id === "two")?.status).toBe(
    "complete",
  );
});
