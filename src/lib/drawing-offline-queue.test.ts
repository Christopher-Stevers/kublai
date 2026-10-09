// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { DrawingOfflineQueue } from "./drawing-offline-queue";
import type { DrawingEntity, DrawingSave } from "./drawing-workspace";
const binding = vi.hoisted(() => ({ active: "org:worker" as string | null }));
vi.mock("./drawing-offline", () => ({
  isDrawingOfflineAccountActive: (key: string) => key === binding.active,
}));
const sheetId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
let Queue: typeof DrawingOfflineQueue;
function draft(overrides: Partial<DrawingSave> = {}): DrawingSave {
  return {
    sheetId,
    id: crypto.randomUUID(),
    expectedRevision: 0,
    visibility: "private",
    kind: "markup",
    data: {
      sourceSheetId: sheetId,
      type: "line",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      stroke: "#ff0000",
      width: 2,
    },
    ...overrides,
  } as DrawingSave;
}
function saved(input: DrawingSave): DrawingEntity {
  if (input.kind !== "markup") throw new Error("test expects markup");
  return {
    id: input.id,
    sheetId,
    kind: "markup",
    data: input.data,
    authorId: "worker",
    authorName: "Worker",
    revision: input.expectedRevision + 1,
    visibility: input.visibility,
    comments: [],
    createdAt: "2026-10-07T12:00:00Z",
    updatedAt: "2026-10-07T12:00:00Z",
  };
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  binding.active = "org:worker";
  Queue = (await import("./drawing-offline-queue")).DrawingOfflineQueue;
});
describe("durable account-bound drawing edit queue", () => {
  it("saves simulation edits as the employee and isolates separate sessions", async () => {
    binding.active = "org:worker:simulation:session-one";
    const queue = new Queue(binding.active, "worker");
    const input = draft();
    const record = await queue.enqueue({ jobId, input, authorName: "Worker" });
    expect(record).toMatchObject({
      accountKey: binding.active,
      input: { expectedUserId: "worker" },
      preview: { authorId: "worker" },
    });
    const send = vi.fn(async (value: DrawingSave) => saved(value));
    await queue.flush({ save: send });
    expect(send.mock.calls[0]?.[0].expectedUserId).toBe("worker");
    expect(await queue.list()).toEqual([]);
    await queue.enqueue({ jobId, input: draft() });
    binding.active = "org:worker:simulation:session-two";
    const next = new Queue(binding.active, "worker");
    expect(await next.list()).toEqual([]);
    await expect(queue.flush({ save: send })).rejects.toThrow(/account changed/);
    expect(send).toHaveBeenCalledOnce();
  });
  it("persists before returning and survives another queue instance", async () => {
    const queue = new Queue("org:worker", "worker"),
      input = draft();
    const record = await queue.enqueue({ jobId, input, authorName: "Worker" });
    const reloaded = new Queue("org:worker", "worker");
    const rows = await reloaded.list({ jobId, sheetId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationId: record.operationId,
      state: "pending",
      input: { expectedUserId: "worker" },
      preview: { id: input.id, authorId: "worker", authorName: "Worker" },
    });
    expect(await reloaded.list({ sheetId: jobId })).toEqual([]);
  });
  it("coalesces unsent changes without losing the original server CAS revision", async () => {
    const queue = new Queue("org:worker", "worker"),
      input = draft({ expectedRevision: 2 });
    const base = saved({ ...input, expectedRevision: 1 });
    const first = await queue.enqueue({ jobId, input, baseEntity: base });
    if (input.kind !== "markup") throw Error("fixture");
    const second = await queue.enqueue({
      jobId,
      input: { ...input, data: { ...input.data, text: "newer" } },
    });
    expect(second.operationId).toBe(first.operationId);
    expect(second.input.expectedRevision).toBe(2);
    expect(await queue.list()).toHaveLength(1);
    expect(second.input.data).toHaveProperty("text", "newer");
  });
  it("requires own current private base to edit an existing item and forbids publishing/reviews", async () => {
    const queue = new Queue("org:worker", "worker"),
      input = draft({ expectedRevision: 1 });
    await expect(queue.enqueue({ jobId, input })).rejects.toThrow(
      /Download your current/,
    );
    await expect(
      queue.enqueue({
        jobId,
        input,
        baseEntity: {
          ...saved({ ...input, expectedRevision: 0 }),
          authorId: "other",
        },
      }),
    ).rejects.toThrow(/Download your current/);
    await expect(
      queue.enqueue({ jobId, input: draft({ visibility: "published" }) }),
    ).rejects.toThrow(/private markup/);
  });
  it("leases pending entries across tabs and deletes only after matching server acknowledgement", async () => {
    const queue = new Queue("org:worker", "worker"),
      other = new Queue("org:worker", "worker");
    const input = draft();
    await queue.enqueue({ jobId, input });
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async (value: DrawingSave) => {
      await barrier;
      return saved(value);
    });
    const flush = queue.flush({ save: send });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await other.flush({ save: send });
    expect(send).toHaveBeenCalledOnce();
    expect((await queue.list())[0]?.state).toBe("syncing");
    await expect(other.enqueue({ jobId, input })).rejects.toThrow(
      /Resolve or finish/,
    );
    release!();
    await flush;
    expect(await other.list()).toEqual([]);
    expect(send.mock.calls[0]?.[0].expectedUserId).toBe("worker");
  });
  it("retains CAS conflicts and denies silent rebase/retry", async () => {
    const queue = new Queue("org:worker", "worker");
    await queue.enqueue({ jobId, input: draft() });
    const send = vi.fn().mockRejectedValue({
      data: { code: "CONFLICT" },
      message: "Server changed",
    });
    await queue.flush({ save: send });
    const [record] = await queue.list();
    expect(record).toMatchObject({
      state: "conflict",
      error: "Server changed",
      attempts: 1,
    });
    await expect(queue.retry(record!.operationId)).rejects.toThrow(
      /never overwritten/,
    );
    await queue.flush({ save: send });
    expect(send).toHaveBeenCalledOnce();
    await queue.discard(record!.operationId);
    expect(await queue.list()).toEqual([]);
  });
  it("keeps forbidden or deleted-resource edits blocked for explicit user handling", async () => {
    const queue = new Queue("org:worker", "worker");
    await queue.enqueue({ jobId, input: draft() });
    await queue.flush({
      save: vi.fn().mockRejectedValue({
        data: { code: "FORBIDDEN" },
        message: "Access changed",
      }),
    });
    const [record] = await queue.list();
    expect(record?.state).toBe("blocked");
    await queue.retry(record!.operationId);
    expect((await queue.list())[0]?.state).toBe("pending");
  });
  it("retains network failures with backoff and does not drop later edits", async () => {
    const queue = new Queue("org:worker", "worker");
    await queue.enqueue({ jobId, input: draft() });
    await queue.enqueue({ jobId, input: draft() });
    const send = vi.fn().mockRejectedValue(new Error("Offline"));
    await queue.flush({ save: send });
    const records = await queue.list();
    expect(records).toHaveLength(2);
    expect(records[0]?.attempts).toBe(1);
    expect(records[0]?.availableAt).toBeGreaterThan(Date.now());
    expect(records[1]?.attempts).toBe(0);
    expect(send).toHaveBeenCalledOnce();
  });
  it("rejects old account access and never submits old drafts after switching accounts", async () => {
    const queue = new Queue("org:worker", "worker");
    await queue.enqueue({ jobId, input: draft() });
    binding.active = "org:other";
    const send = vi.fn();
    await expect(queue.flush({ save: send })).rejects.toThrow(
      /account changed/,
    );
    expect(send).not.toHaveBeenCalled();
    await expect(queue.list()).rejects.toThrow(/account changed/);
    const other = new Queue("org:other", "other");
    expect(await other.list()).toEqual([]);
    binding.active = "org:worker";
    const old = new Queue("org:worker", "worker");
    expect(await old.list()).toEqual([]);
  });
  it("does not resurrect an in-flight record after logout clears account storage", async () => {
    const queue = new Queue("org:worker", "worker");
    await queue.enqueue({ jobId, input: draft() });
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async (input: DrawingSave) => {
      await barrier;
      return saved(input);
    });
    const flushing = queue.flush({ save: send });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    binding.active = null;
    window.dispatchEvent(
      new CustomEvent("foremanhq-drawing-offline-binding-change", {
        detail: { accountKey: null },
      }),
    );
    release!();
    await expect(flushing).rejects.toThrow(/account changed/);
    binding.active = "org:other";
    expect(await new Queue("org:other", "other").list()).toEqual([]);
  });
  it("bounds pending records atomically even with concurrent queues", async () => {
    const queue = new Queue("org:worker", "worker"),
      other = new Queue("org:worker", "worker");
    await Promise.all(
      Array.from({ length: 199 }, () =>
        queue.enqueue({ jobId, input: draft() }),
      ),
    );
    const results = await Promise.allSettled([
      queue.enqueue({ jobId, input: draft() }),
      other.enqueue({ jobId, input: draft() }),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await queue.list()).toHaveLength(200);
  });
});
