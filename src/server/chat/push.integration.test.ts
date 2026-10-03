// @vitest-environment node
/** Executes real outbox SQL on its own temporary database; only provider I/O is fake. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import {
  getTableColumns,
  getTableName,
  eq,
  inArray,
  not,
  sql,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "~/server/db/schema";
import { users as userColumns } from "./tables";

const network = vi.hoisted(() => ({ send: vi.fn(), lookup: vi.fn() }));
vi.mock("~/env", () => ({
  env: {
    WEB_PUSH_PUBLIC_KEY: "test-public",
    WEB_PUSH_PRIVATE_KEY: "test-private",
    WEB_PUSH_SUBJECT: "mailto:ops@example.invalid",
  },
}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: network.send },
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const conn = postgres({
    host: process.env.JOB_CHAT_TEST_SOCKET ?? "/tmp/no-chat-test-cluster",
    port: 55448,
    database: "chat_push_integration",
    max: 8,
  });
  return { db: drizzle(conn, { schema }), __testConnection: conn };
});
import { db } from "~/server/db";
import { drainChatPush, enqueueChatPush } from "./push";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const socket = process.env.JOB_CHAT_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-chat-test-cluster",
  port: 55448,
  database: "chat_push_integration",
  max: 1,
});
const fixtureDb = drizzle(conn, { schema });
const people = [
  "sender",
  "creator",
  "foreman",
  "current",
  "joined",
  "muted",
  "read",
  "revoked",
  "denied",
  "foreign",
  "outsider",
];
const deviceIds = new Map<string, string>();

async function keepDevices(names: string[]) {
  await fixtureDb.delete(schema.chatPushSubscriptions).where(
    not(
      inArray(
        schema.chatPushSubscriptions.id,
        names.map((name) => deviceIds.get(name)!),
      ),
    ),
  );
}
async function enqueueMessage() {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(schema.jobChatMessages)
      .values({
        jobId: job,
        authorId: "sender",
        clientId: crypto.randomUUID(),
        requestHash: "a".repeat(64),
        body: "Private message text must stay out of push payload",
      })
      .returning();
    if (!message) throw new Error("Expected message");
    const input = {
      organizationId: org,
      jobId: job,
      messageId: message.id,
      senderId: "sender",
      sequence: message.sequence,
    };
    await enqueueChatPush(tx, input);
    return input;
  });
}
async function rows() {
  return fixtureDb.select().from(schema.chatPushOutbox);
}

describe.skipIf(!socket)(
  "real PostgreSQL push enqueue, leases and settlement (isolated)",
  () => {
    beforeAll(async () => {
      if (!socket?.startsWith("/tmp/foremanhq-chat-pg."))
        throw new Error("Refusing non-isolated test socket");
      const [database] = await conn`SELECT current_database() AS name`;
      if (database?.name !== "chat_push_integration")
        throw new Error("Refusing unexpected database");
      for (const table of [schema.organizations, schema.users, schema.jobs]) {
        const columns = Object.values(getTableColumns(table as PgTable)).map(
          (column) => `"${column.name}" ${column.getSQLType()}`,
        );
        await conn.unsafe(
          `CREATE TABLE "${getTableName(table)}" (${columns.join(",")}, PRIMARY KEY ("id"))`,
        );
      }
      for (const name of ["0042_job_chat", "0043_job_chat_push"])
        await conn.unsafe(
          await readFile(
            new URL(`../../../drizzle/${name}.sql`, import.meta.url),
            "utf8",
          ),
        );
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      deviceIds.clear();
      network.lookup.mockResolvedValue([{ address: "142.250.1.1", family: 4 }]);
      network.send.mockResolvedValue({ statusCode: 201 });
      await conn.unsafe(
        'TRUNCATE "kublai_organization", "kublai_user", "kublai_job", "kublai_job_chat_member", "kublai_job_chat_message", "kublai_job_chat_event", "kublai_job_chat_attachment", "kublai_chat_push_subscription", "kublai_chat_push_outbox" RESTART IDENTITY CASCADE',
      );
      await fixtureDb.insert(schema.organizations).values([
        { id: org, name: "Synthetic organization" },
        { id: foreignOrg, name: "Foreign organization" },
      ]);
      for (const person of people) {
        await fixtureDb.insert(schema.users).values({
          id: person,
          email: `${person}@example.invalid`,
          name: person,
          organizationId: person === "foreign" ? foreignOrg : org,
          organizationAccessStatus:
            person === "revoked" ? "pending" : "approved",
          currentJobId: ["current", "revoked", "denied", "foreign"].includes(
            person,
          )
            ? job
            : null,
          permissionConfig:
            person === "denied"
              ? { version: 2, permissions: { "tab.dashboard": false } }
              : null,
        });
      }
      await fixtureDb.insert(schema.jobs).values({
        id: job,
        organizationId: org,
        name: "Secret job name",
        createdByUserId: "creator",
        foremanUserId: "foreman",
      });
      for (const person of ["joined", "muted", "read"])
        await fixtureDb.insert(schema.jobChatMembers).values({
          jobId: job,
          userId: person,
          muted: person === "muted",
          lastReadSequence: person === "read" ? 999 : 0,
        });
      for (const person of [...people, "creator-second"]) {
        const id = crypto.randomUUID();
        deviceIds.set(person, id);
        await fixtureDb.insert(schema.chatPushSubscriptions).values({
          id,
          userId: person === "creator-second" ? "creator" : person,
          endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${person}`,
          p256dh: "fake-provider-key",
          auth: "fake-provider-auth",
          revokeTokenHash: "0".repeat(64),
        });
      }
    });
    afterAll(async () => {
      await conn.end();
      const testDbModule = (await import("~/server/db")) as unknown as {
        __testConnection: postgres.Sql;
      };
      await testDbModule.__testConnection.end();
    });

    it("joins actual eligible users/devices and deduplicates each message/device atomically", async () => {
      const message = await enqueueMessage();
      const queued = await rows();
      expect(queued).toHaveLength(5);
      expect(queued.map((row) => row.recipientId).sort()).toEqual([
        "creator",
        "creator",
        "current",
        "foreman",
        "joined",
      ]);
      await db.transaction(async (tx) => {
        await enqueueChatPush(tx, message);
        await enqueueChatPush(tx, message);
      });
      expect(await rows()).toHaveLength(5);
      expect(network.send).not.toHaveBeenCalled();
      await drainChatPush();
      expect(network.send).toHaveBeenCalledTimes(5);
      expect(
        (await rows()).every(
          (row) =>
            row.outcome === "sent" &&
            row.completedAt &&
            row.attempts === 1 &&
            row.leaseToken === null &&
            row.leasedUntil === null,
        ),
      ).toBe(true);
      for (const call of network.send.mock.calls) {
        const payload = call[1] as string;
        expect(payload).not.toContain("Private message text");
        expect(payload).not.toContain("Secret job name");
        expect(JSON.parse(payload)).toMatchObject({
          type: "job-chat",
          url: `/dashboard/jobs/${job}/chat`,
        });
      }
    });

    it("rechecks mute, read cursors and lost permission/organization immediately before delivery", async () => {
      const message = await enqueueMessage();
      await fixtureDb
        .insert(schema.jobChatMembers)
        .values({ jobId: job, userId: "creator", muted: true });
      await fixtureDb.insert(schema.jobChatMembers).values({
        jobId: job,
        userId: "foreman",
        lastReadSequence: message.sequence,
      });
      await fixtureDb
        .update(schema.users)
        .set({
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        })
        .where(eq(userColumns.id, "current"));
      await fixtureDb
        .update(schema.users)
        .set({ organizationId: foreignOrg })
        .where(eq(userColumns.id, "joined"));
      await drainChatPush();
      expect(network.send).not.toHaveBeenCalled();
      expect(network.lookup).not.toHaveBeenCalled();
      expect(
        (await rows()).every(
          (row) =>
            row.outcome === "skipped" &&
            row.completedAt &&
            row.leaseToken === null,
        ),
      ).toBe(true);
    });

    it("does not send queued messages after deletion, revoked approval or subscription rebinding", async () => {
      await keepDevices(["current"]);
      const message = await enqueueMessage();
      await fixtureDb
        .update(schema.jobChatMessages)
        .set({ deletedAt: new Date(), body: "" })
        .where(eq(schema.jobChatMessages.id, message.messageId));
      await drainChatPush();
      expect((await rows())[0]?.outcome).toBe("skipped");
      await enqueueMessage();
      await fixtureDb
        .update(schema.users)
        .set({ organizationAccessStatus: "rejected" })
        .where(eq(userColumns.id, "current"));
      await drainChatPush();
      expect(network.send).not.toHaveBeenCalled();
      await fixtureDb
        .update(schema.users)
        .set({ organizationAccessStatus: "approved" })
        .where(eq(userColumns.id, "current"));
      await enqueueMessage();
      await fixtureDb
        .update(schema.chatPushSubscriptions)
        .set({ userId: "outsider" })
        .where(eq(schema.chatPushSubscriptions.id, deviceIds.get("current")!));
      await drainChatPush();
      expect(network.send).not.toHaveBeenCalled();
      expect((await rows()).every((row) => row.outcome === "skipped")).toBe(
        true,
      );
    });

    it("claims a live lease once across concurrent drainers and settles exactly that claim", async () => {
      await keepDevices(["current"]);
      await enqueueMessage();
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      network.send.mockImplementation(async () => {
        await blocked;
        return { statusCode: 201 };
      });
      const first = drainChatPush();
      await vi.waitFor(() => expect(network.send).toHaveBeenCalledOnce());
      const [leased] = await rows();
      expect(leased?.attempts).toBe(1);
      expect(leased?.leaseToken).toBeTruthy();
      expect(leased?.leasedUntil).toBeInstanceOf(Date);
      expect(leased?.completedAt).toBeNull();
      await drainChatPush();
      expect(network.send).toHaveBeenCalledOnce();
      release();
      await first;
      const [settled] = await rows();
      expect(settled).toMatchObject({
        outcome: "sent",
        attempts: 1,
        leaseToken: null,
        leasedUntil: null,
      });
      expect(settled?.completedAt).toBeInstanceOf(Date);
    });

    it("persists retry backoff, waits until due, and recovers an expired lease", async () => {
      await keepDevices(["current"]);
      await enqueueMessage();
      network.send.mockRejectedValueOnce({ statusCode: 429 });
      await drainChatPush();
      const [retry] = await rows();
      expect(retry).toMatchObject({
        attempts: 1,
        outcome: "retry",
        completedAt: null,
        leaseToken: null,
        leasedUntil: null,
      });
      expect(retry!.availableAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
      await drainChatPush();
      expect(network.send).toHaveBeenCalledOnce();
      await fixtureDb
        .update(schema.chatPushOutbox)
        .set({
          availableAt: new Date(0),
          leaseToken: crypto.randomUUID(),
          leasedUntil: new Date(0),
        })
        .where(eq(schema.chatPushOutbox.id, retry!.id));
      await drainChatPush();
      expect(network.send).toHaveBeenCalledTimes(2);
      expect((await rows())[0]).toMatchObject({
        attempts: 2,
        outcome: "sent",
        leaseToken: null,
        leasedUntil: null,
      });
    });

    it("bounds exhausted attempts and removes expired provider subscriptions with their pending rows", async () => {
      await keepDevices(["current"]);
      await enqueueMessage();
      await fixtureDb
        .update(schema.chatPushOutbox)
        .set({ attempts: 6 })
        .where(sql`true`);
      await drainChatPush();
      expect((await rows())[0]?.outcome).toBe("expired");
      expect(network.send).not.toHaveBeenCalled();
      await enqueueMessage();
      network.send.mockRejectedValueOnce({ statusCode: 410 });
      await drainChatPush();
      expect(
        await fixtureDb.select().from(schema.chatPushSubscriptions),
      ).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });
  },
);
