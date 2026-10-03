// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { ChatTransaction } from "./types";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  send: vi.fn(),
  lookup: vi.fn(),
  insert: vi.fn(),
  env: {
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:ops@example.test",
  },
}));
vi.mock("~/env", () => ({ env: mocks.env }));
vi.mock("~/server/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: mocks.send },
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
import { drainChatPush, enqueueChatPush, startChatPushWorker } from "./push";

const dialect = new PgDialect();
const queries: { sql: string; params: unknown[] }[] = [];
const delivery = {
  id: "delivery",
  leaseToken: "lease",
  attempts: 1,
  jobId: "job",
  organizationId: "org",
  messageId: "msg",
  senderId: "sender",
  recipientId: "worker",
  sequence: 4,
  subscriptionId: "device",
  endpoint: "https://fcm.googleapis.com/fcm/send/fake",
  p256dh: "fake",
  auth: "fake",
};
const candidate = {
  subscriptionId: "device",
  subscriptionUserId: "worker",
  user: {
    id: "worker",
    organizationId: "org",
    organizationAccessStatus: "approved",
    role: "worker",
    currentJobId: "job",
  },
  createdById: null,
  foremanId: null,
  member: null,
};
let current: unknown[];
beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  current = [candidate];
  mocks.lookup.mockResolvedValue([{ address: "142.250.1.1", family: 4 }]);
  mocks.send.mockResolvedValue({ statusCode: 201 });
  mocks.execute.mockImplementation(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    queries.push(query);
    if (query.sql.includes("WITH picked")) return [delivery];
    if (query.sql.includes('SELECT s."userId"')) return current;
    return [];
  });
});
afterEach(() => {
  vi.useRealTimers();
});
describe("durable push delivery", () => {
  it("claims with SKIP LOCKED, leases and attempt caps, then sends a generic payload", async () => {
    await drainChatPush();
    const claim = queries.find((query) => query.sql.includes("WITH picked"))!;
    expect(claim.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim.sql).toContain("interval '2 minutes'");
    expect(claim.sql).toContain("attempts=attempts+1");
    expect(mocks.send).toHaveBeenCalledOnce();
    const [, payload, options] = mocks.send.mock.calls[0]! as unknown[];
    expect(JSON.parse(payload as string) as unknown).toMatchObject({
      type: "job-chat",
    });
    expect(options).toMatchObject({ TTL: 86400, timeout: 8000 });
    expect(
      queries.some(
        (query) =>
          query.params.includes("sent") && query.params.includes("lease"),
      ),
    ).toBe(true);
  });
  it("rechecks changed access/read/mute or removed messages before using the network", async () => {
    for (const changed of [
      [],
      [{ ...candidate, member: { muted: true, lastReadSequence: 0 } }],
      [{ ...candidate, member: { muted: false, lastReadSequence: 4 } }],
      [{ ...candidate, subscriptionUserId: "someone-else" }],
    ]) {
      current = changed;
      await drainChatPush();
    }
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      queries.filter((query) => query.params.includes("skipped")),
    ).toHaveLength(4);
  });
  it("deletes permanently expired endpoints and schedules bounded retries for 429", async () => {
    mocks.send.mockRejectedValueOnce({ statusCode: 410 });
    await drainChatPush();
    expect(
      queries.some(
        (query) =>
          query.sql.startsWith("DELETE FROM kublai_chat_push_subscription") &&
          query.params.includes("worker"),
      ),
    ).toBe(true);
    mocks.send.mockRejectedValueOnce({ statusCode: 429 });
    await drainChatPush();
    expect(
      queries.some(
        (query) =>
          query.params.includes("retry") && query.params.includes(30000),
      ),
    ).toBe(true);
  });
  it("never contacts a provider resolving to private addresses", async () => {
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await drainChatPush();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(queries.some((query) => query.params.includes("failed"))).toBe(true);
  });
  it("queues each eligible device transactionally and deduplicates message retries", async () => {
    const conflict = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing: conflict }));
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValue([
          candidate,
          { ...candidate, subscriptionUserId: "someone-else" },
        ]),
      insert: vi.fn(() => ({ values })),
    };
    await enqueueChatPush(tx as unknown as ChatTransaction, {
      organizationId: "org",
      jobId: "job",
      messageId: "msg",
      senderId: "sender",
      sequence: 4,
    });
    expect(values).toHaveBeenCalledWith([
      {
        organizationId: "org",
        jobId: "job",
        messageId: "msg",
        senderId: "sender",
        sequence: 4,
        subscriptionId: "device",
        recipientId: "worker",
      },
    ]);
    expect(conflict).toHaveBeenCalledOnce();
  });
  it("starts one recurring drain per Node process, including a recovery drain at startup", async () => {
    vi.useFakeTimers();
    const state = globalThis as typeof globalThis & {
      chatPushDrainTimer?: NodeJS.Timeout;
      chatPushDraining?: boolean;
    };
    delete state.chatPushDrainTimer;
    delete state.chatPushDraining;
    startChatPushWorker();
    startChatPushWorker();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    clearInterval(state.chatPushDrainTimer);
    delete state.chatPushDrainTimer;
    delete state.chatPushDraining;
  });
});
