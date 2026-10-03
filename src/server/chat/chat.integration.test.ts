// @vitest-environment node
/** Requires the isolated cluster created by scripts/test-job-chat-db.sh. Never uses DATABASE_URL. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getTableColumns, getTableName, sql, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "~/server/db/schema";

const state = vi.hoisted(() => ({ failPush: false }));
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const conn = postgres({
    host: process.env.JOB_CHAT_TEST_SOCKET ?? "/tmp/no-chat-test-cluster",
    port: 55448,
    database: "chat_integration",
    max: 8,
  });
  return { db: drizzle(conn, { schema }), __testConnection: conn };
});
vi.mock("~/server/chat/push", () => ({
  enqueueChatPush: async (
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    input: { messageId: string },
  ) => {
    if (state.failPush) throw new Error("simulated transaction failure");
    await tx.execute(
      sql`INSERT INTO chat_notification_probe (message_id) VALUES (${input.messageId})`,
    );
  },
}));
import {
  assertChatAccess,
  assertMessageOwner,
  checkChatAccess,
} from "./access";
import {
  changeChatMessage,
  chatHistory,
  chatMembers,
  chatOverview,
  joinChat,
  markChatRead,
  sendChatMessage,
  setChatNotifications,
} from "./service";
import {
  cleanupExpiredChatAttachments,
  deletePendingAttachment,
  readChatAttachment,
  uploadChatAttachment,
} from "./attachments";
import { requestHash, sendInput, chatSequence } from "./contracts";
import { users as userColumns } from "./tables";
import type { RequestUser } from "~/server/utils/get-request-identity";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherJob = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const foreignJob = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const author = "chat-author";
const coworker = "chat-coworker";
const executive = "chat-executive";
const foreign = "chat-foreign";
const baseUser = {
  id: author,
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "user",
  permissionConfig: null,
} as RequestUser;
const baseJob = {
  id: job,
  name: "Synthetic job",
  organizationId: org,
  createdByUserId: author,
  foremanUserId: null,
};

describe("job chat access and contracts", () => {
  it("requires an approved organization member with dashboard access", () => {
    expect(() => checkChatAccess(null, baseJob)).toThrow();
    for (const status of [null, "pending", "rejected"])
      expect(() =>
        checkChatAccess(
          { ...baseUser, organizationAccessStatus: status },
          baseJob,
        ),
      ).toThrow();
    expect(() =>
      checkChatAccess(
        {
          ...baseUser,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        },
        baseJob,
      ),
    ).toThrow();
    expect(() =>
      checkChatAccess({ ...baseUser, organizationId: otherOrg }, baseJob),
    ).toThrow("Job not found");
    expect(checkChatAccess(baseUser, baseJob).user.id).toBe(author);
  });
  it("allows only the author or an Executive to edit/delete", () => {
    const access = checkChatAccess(baseUser, baseJob);
    expect(() => assertMessageOwner(access, coworker)).toThrow();
    expect(() => assertMessageOwner(access, author)).not.toThrow();
    expect(() =>
      assertMessageOwner(
        checkChatAccess({ ...baseUser, role: "admin" }, baseJob),
        coworker,
      ),
    ).not.toThrow();
  });
  it("rejects empty, oversized, repeated-attachment, or unsafe cursor inputs", () => {
    const input = { jobId: job, clientId: crypto.randomUUID(), body: "  " };
    expect(sendInput.safeParse(input).success).toBe(false);
    expect(
      sendInput.safeParse({ ...input, body: "x".repeat(8001) }).success,
    ).toBe(false);
    const id = crypto.randomUUID();
    expect(
      sendInput.safeParse({ ...input, attachmentIds: [id, id] }).success,
    ).toBe(false);
    expect(sendInput.safeParse({ ...input, attachmentIds: [id] }).success).toBe(
      true,
    );
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity])
      expect(chatSequence.safeParse(value).success).toBe(false);
  });
  it("hashes retry content independently of attachment order but includes body/reply", () => {
    const message = { body: "Hi", attachmentIds: [job, otherJob] };
    expect(requestHash(message)).toBe(
      requestHash({ ...message, attachmentIds: [otherJob, job] }),
    );
    expect(requestHash(message)).not.toBe(
      requestHash({ ...message, body: "Changed" }),
    );
    expect(requestHash(message)).not.toBe(
      requestHash({ ...message, replyToId: job }),
    );
  });
});

const temporaryFiles = new Set<string>();
const socket = process.env.JOB_CHAT_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-chat-test-cluster",
  port: 55448,
  database: "chat_integration",
  max: 1,
});
const fixtureDb = drizzle(conn, { schema });
describe.skipIf(!socket)(
  "job chat real PostgreSQL transactions (isolated)",
  () => {
    beforeAll(async () => {
      if (!socket?.startsWith("/tmp/foremanhq-chat-pg."))
        throw new Error("Refusing non-isolated database socket");
      const [database] = await conn`select current_database() as name`;
      if (database?.name !== "chat_integration")
        throw new Error("Refusing unexpected test database");
      for (const table of [schema.organizations, schema.users, schema.jobs]) {
        const definitions = Object.values(
          getTableColumns(table as PgTable),
        ).map((column) => `"${column.name}" ${column.getSQLType()}`);
        await conn.unsafe(
          `CREATE TABLE "${getTableName(table)}" (${definitions.join(",")}, PRIMARY KEY ("id"))`,
        );
      }
      await conn.unsafe(
        await readFile(
          new URL("../../../drizzle/0042_job_chat.sql", import.meta.url),
          "utf8",
        ),
      );
      await conn.unsafe(
        "CREATE TABLE chat_notification_probe (message_id uuid PRIMARY KEY)",
      );
    });
    beforeEach(async () => {
      state.failPush = false;
      await conn.unsafe(
        'TRUNCATE "kublai_organization", "kublai_user", "kublai_job", "kublai_job_chat_member", "kublai_job_chat_message", "kublai_job_chat_event", "kublai_job_chat_attachment", chat_notification_probe RESTART IDENTITY CASCADE',
      );
      await fixtureDb.insert(schema.organizations).values([
        { id: org, name: "Synthetic organization" },
        { id: otherOrg, name: "Foreign synthetic organization" },
      ]);
      await fixtureDb.insert(schema.users).values([
        {
          id: author,
          email: "author@example.invalid",
          name: "Author",
          organizationId: org,
          organizationAccessStatus: "approved",
          currentJobId: job,
        },
        {
          id: coworker,
          email: "coworker@example.invalid",
          name: "Coworker",
          organizationId: org,
          organizationAccessStatus: "approved",
        },
        {
          id: executive,
          email: "executive@example.invalid",
          name: "Executive",
          role: "admin",
          organizationId: org,
          organizationAccessStatus: "approved",
        },
        {
          id: foreign,
          email: "foreign@example.invalid",
          name: "Foreign",
          organizationId: otherOrg,
          organizationAccessStatus: "approved",
        },
      ]);
      await fixtureDb.insert(schema.jobs).values([
        {
          id: job,
          organizationId: org,
          name: "Test job",
          createdByUserId: author,
        },
        { id: otherJob, organizationId: org, name: "Other job" },
        {
          id: foreignJob,
          organizationId: otherOrg,
          name: "Foreign job",
          createdByUserId: foreign,
        },
      ]);
    });
    afterAll(async () => {
      for (const id of temporaryFiles)
        await unlink(path.resolve("uploads/job-chat", id)).catch(
          () => undefined,
        );
      await conn.end();
      const testModule = (await import("~/server/db")) as unknown as {
        __testConnection: postgres.Sql;
      };
      await testModule.__testConnection.end();
    });
    const send = async (
      userId = author,
      body = "Test message",
      clientId = crypto.randomUUID(),
    ) =>
      sendChatMessage(await assertChatAccess(userId, job), {
        clientId,
        body,
        attachmentIds: [],
      });
    it("does not grant guessed cross-organization jobs and rechecks revoked access", async () => {
      await expect(assertChatAccess(foreign, job)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(assertChatAccess(author, foreignJob)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await assertChatAccess(author, job)).user.id).toBe(author);
      await fixtureDb
        .update(schema.users)
        .set({ organizationAccessStatus: "pending" })
        .where(eq(userColumns.id, author));
      await expect(assertChatAccess(author, job)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(assertChatAccess(null, job)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
    it("persists concurrent duplicate retries once including event and outbox", async () => {
      const id = crypto.randomUUID();
      const sent = await Promise.all(
        Array.from({ length: 6 }, () => send(author, "one message", id)),
      );
      expect(new Set(sent.map((m) => m.id)).size).toBe(1);
      expect(
        await fixtureDb.select().from(schema.jobChatMessages),
      ).toHaveLength(1);
      expect(await fixtureDb.select().from(schema.jobChatEvents)).toHaveLength(
        1,
      );
      expect(await conn`SELECT * FROM chat_notification_probe`).toHaveLength(1);
      await expect(send(author, "different payload", id)).rejects.toMatchObject(
        { code: "CONFLICT" },
      );
    });
    it("rolls back message/membership/event on outbox failure then retries successfully", async () => {
      state.failPush = true;
      await expect(send()).rejects.toThrow("simulated transaction failure");
      expect(
        await fixtureDb.select().from(schema.jobChatMessages),
      ).toHaveLength(0);
      expect(await fixtureDb.select().from(schema.jobChatMembers)).toHaveLength(
        0,
      );
      expect(await fixtureDb.select().from(schema.jobChatEvents)).toHaveLength(
        0,
      );
      state.failPush = false;
      expect((await send()).body).toBe("Test message");
    });
    it("paginates deterministically and preserves concurrent sends when marking read", async () => {
      const messages = [];
      for (let i = 0; i < 7; i++)
        messages.push(await send(author, `Message ${i}`));
      const access = await assertChatAccess(coworker, job);
      const newest = await chatHistory(access, { limit: 3 });
      expect(newest.messages.map((m) => m.id)).toEqual(
        messages.slice(4).map((m) => m.id),
      );
      const previous = await chatHistory(access, {
        limit: 3,
        beforeSequence: newest.nextBeforeSequence!,
      });
      expect(previous.messages.map((m) => m.id)).toEqual(
        messages.slice(1, 4).map((m) => m.id),
      );
      await markChatRead(access, messages[4]!.sequence);
      expect((await chatOverview(access)).unreadCount).toBe(2);
      await markChatRead(access, messages[0]!.sequence);
      expect((await chatOverview(access)).unreadCount).toBe(2);
      await markChatRead(access, Number.MAX_SAFE_INTEGER);
      const after = await send();
      expect(after.sequence).toBeGreaterThan(messages[6]!.sequence);
      expect((await chatOverview(access)).unreadCount).toBe(1);
    });
    it("tombstones edits/deletes in durable events and enforces ownership", async () => {
      const message = await send();
      const authorAccess = await assertChatAccess(author, job);
      const coworkerAccess = await assertChatAccess(coworker, job);
      await expect(
        changeChatMessage(coworkerAccess, message.id, "Hijack"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await changeChatMessage(authorAccess, message.id, "Edited")).editedAt,
      ).toBeInstanceOf(Date);
      const deleted = await changeChatMessage(
        await assertChatAccess(executive, job),
        message.id,
        null,
      );
      expect(deleted.body).toBe("");
      expect(deleted.attachments).toEqual([]);
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      await changeChatMessage(authorAccess, message.id, null);
      await expect(
        changeChatMessage(authorAccess, message.id, "Revive"),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await fixtureDb.select().from(schema.jobChatEvents)).map(
          (e) => e.type,
        ),
      ).toEqual(["created", "edited", "deleted"]);
      expect((await chatOverview(coworkerAccess)).unreadCount).toBe(0);
    });
    it("refuses replies and attachments from another job/user or an expired upload", async () => {
      const parent = await sendChatMessage(
        await assertChatAccess(author, otherJob),
        {
          clientId: crypto.randomUUID(),
          body: "Other lobby",
          attachmentIds: [],
        },
      );
      const access = await assertChatAccess(author, job);
      await expect(
        sendChatMessage(access, {
          clientId: crypto.randomUUID(),
          body: "Reply",
          replyToId: parent.id,
          attachmentIds: [],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      for (const attachment of [
        { jobId: otherJob, uploadedById: author, createdAt: new Date() },
        { jobId: job, uploadedById: coworker, createdAt: new Date() },
        { jobId: job, uploadedById: author, createdAt: new Date(0) },
      ]) {
        const id = crypto.randomUUID();
        await fixtureDb.insert(schema.jobChatAttachments).values({
          ...attachment,
          id,
          name: "fake.png",
          mimeType: "image/png",
          size: 20,
        });
        await expect(
          sendChatMessage(access, {
            clientId: crypto.randomUUID(),
            body: "File",
            attachmentIds: [id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    });
    it("attaches exactly once, redacts after delete, and supports same-job replies", async () => {
      const access = await assertChatAccess(author, job);
      const id = crypto.randomUUID();
      await fixtureDb.insert(schema.jobChatAttachments).values({
        id,
        jobId: job,
        uploadedById: author,
        name: "sample.png",
        mimeType: "image/png",
        size: 20,
      });
      const message = await sendChatMessage(access, {
        clientId: crypto.randomUUID(),
        body: "",
        attachmentIds: [id],
      });
      expect(message.attachments[0]?.url).toBe(
        `/api/job-chat/attachments/${id}`,
      );
      expect(
        (
          await sendChatMessage(access, {
            clientId: crypto.randomUUID(),
            body: "Reply",
            replyToId: message.id,
            attachmentIds: [],
          })
        ).replyToId,
      ).toBe(message.id);
      await expect(
        sendChatMessage(access, {
          clientId: crypto.randomUUID(),
          body: "Reuse",
          attachmentIds: [id],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (await changeChatMessage(access, message.id, null)).attachments,
      ).toEqual([]);
    });
    it("keeps pending uploads private, shares sent files only within the job, and revokes tombstones", async () => {
      const access = await assertChatAccess(author, job);
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const attachment = await uploadChatAttachment(
        access,
        new Request("http://local.invalid", {
          method: "POST",
          headers: { "content-type": "image/png", "x-file-name": "test.png" },
          body: new Uint8Array(png),
        }),
      );
      temporaryFiles.add(attachment.id);
      expect((await readChatAttachment(author, attachment.id)).data).toEqual(
        png,
      );
      await expect(
        readChatAttachment(coworker, attachment.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        readChatAttachment(foreign, attachment.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const message = await sendChatMessage(access, {
        clientId: crypto.randomUUID(),
        body: "Photo",
        attachmentIds: [attachment.id],
      });
      expect((await readChatAttachment(coworker, attachment.id)).data).toEqual(
        png,
      );
      await expect(
        deletePendingAttachment(author, attachment.id),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await changeChatMessage(access, message.id, null);
      await expect(
        readChatAttachment(coworker, attachment.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("removes pending and expired uploads, and rechecks permission after receiving the file", async () => {
      const access = await assertChatAccess(author, job);
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const request = () =>
        new Request("http://local.invalid", {
          method: "POST",
          headers: { "content-type": "image/png", "x-file-name": "test.png" },
          body: new Uint8Array(png),
        });
      const attachment = await uploadChatAttachment(access, request());
      temporaryFiles.add(attachment.id);
      await expect(
        deletePendingAttachment(coworker, attachment.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await deletePendingAttachment(author, attachment.id);
      await expect(
        readChatAttachment(author, attachment.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const expired = await uploadChatAttachment(access, request());
      temporaryFiles.add(expired.id);
      await fixtureDb
        .update(schema.jobChatAttachments)
        .set({ createdAt: new Date(0) })
        .where(eq(schema.jobChatAttachments.id, expired.id));
      expect(await cleanupExpiredChatAttachments()).toBe(1);
      await expect(
        readFile(path.resolve("uploads/job-chat", expired.id)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await fixtureDb
        .update(schema.users)
        .set({ organizationAccessStatus: "pending" })
        .where(eq(userColumns.id, author));
      await expect(
        uploadChatAttachment(access, request()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("includes job people and joined members, filters revoked people, saves mute", async () => {
      const access = await assertChatAccess(author, job);
      expect((await chatMembers(access)).map((m) => m.id)).toEqual([author]);
      await joinChat(await assertChatAccess(coworker, job));
      expect((await chatMembers(access)).map((m) => m.id)).toEqual([
        author,
        coworker,
      ]);
      await setChatNotifications(await assertChatAccess(coworker, job), true);
      expect(
        (await chatOverview(await assertChatAccess(coworker, job))).muted,
      ).toBe(true);
      await fixtureDb
        .update(schema.users)
        .set({
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        })
        .where(eq(userColumns.id, coworker));
      expect((await chatMembers(access)).map((m) => m.id)).toEqual([author]);
    });
    it("bounds sends by author across jobs but always permits identical retries", async () => {
      let first: ChatMessage | undefined;
      for (let i = 0; i < 30; i++) {
        const access = await assertChatAccess(author, i % 2 ? otherJob : job);
        const message = await sendChatMessage(access, {
          clientId: crypto.randomUUID(),
          body: `Message ${i}`,
          attachmentIds: [],
        });
        first ??= message;
      }
      await expect(send()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect((await send(author, first!.body, first!.clientId)).id).toBe(
        first!.id,
      );
    });
  },
);
import type { ChatMessage } from "./contracts";
