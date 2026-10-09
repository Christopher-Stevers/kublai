// @vitest-environment node
// Only the ephemeral socket made by test-conversations-db.sh is accepted.
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import sharp from "sharp";
import * as schema from "~/server/db/schema";
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const conn = postgres({
    host:
      process.env.CONVERSATIONS_TEST_SOCKET ??
      "/tmp/no-conversation-test-cluster",
    port: 55450,
    database: "conversations_test",
    max: 8,
  });
  return { db: drizzle(conn, { schema }), __testConnection: conn };
});
vi.mock("~/server/chat/push", () => ({ enqueueChatPush: vi.fn() }));
import {
  checkConversationUser,
  conversationAccess,
  conversationPeople,
  createConversation,
  listConversations,
  conversationHistory,
  sendConversationMessage,
  markConversationRead,
  removeConversationMessage,
} from "./service";
import {
  uploadConversationAttachment,
  readConversationAttachment,
  deleteConversationAttachment,
} from "./attachments";
import { createConversationInput, sendConversationInput } from "./contracts";
import type { RequestUser } from "~/server/utils/get-request-identity";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  foreignOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const base = {
  id: "author",
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "admin",
} as RequestUser;
describe("private chat boundaries", () => {
  it("requires a signed-in approved person with dashboard access", () => {
    expect(() => checkConversationUser(null)).toThrow();
    for (const status of ["pending", "rejected", null])
      expect(() =>
        checkConversationUser({ ...base, organizationAccessStatus: status }),
      ).toThrow();
    expect(() =>
      checkConversationUser({
        ...base,
        role: "user",
        permissionConfig: {
          version: 2,
          permissions: { "tab.dashboard": false },
        },
      }),
    ).toThrow();
  });
  it("validates targets and message retries", () => {
    expect(
      createConversationInput.safeParse({
        kind: "direct",
        recipientIds: ["a", "a"],
      }).success,
    ).toBe(false);
    expect(
      sendConversationInput.safeParse({
        conversationId: randomUUID(),
        clientId: randomUUID(),
        body: "",
        attachmentIds: [],
      }).success,
    ).toBe(false);
    expect(
      sendConversationInput.safeParse({
        conversationId: randomUUID(),
        clientId: randomUUID(),
        body: "test",
        attachmentIds: [randomUUID()],
      }).success,
    ).toBe(true);
  });
});
const enabled = Boolean(process.env.CONVERSATIONS_TEST_SOCKET);
describe.skipIf(!enabled)("private chat against isolated PostgreSQL", () => {
  const conn = postgres({
      host:
        process.env.CONVERSATIONS_TEST_SOCKET ??
        "/tmp/no-conversation-test-cluster",
      port: 55450,
      database: "conversations_test",
      max: 1,
    }),
    fixture = drizzle(conn, { schema });
  beforeAll(async () => {
    if (
      !process.env.CONVERSATIONS_TEST_SOCKET?.startsWith(
        "/tmp/foremanhq-conversation-pg.",
      )
    )
      throw Error("Refusing non-isolated socket");
    const [scope] = await conn`select current_database() as name`;
    expect(scope!.name).toBe("conversations_test");
    for (const table of [schema.organizations, schema.users]) {
      const columns = Object.values(getTableColumns(table as PgTable)).map(
        (c) => `"${c.name}" ${c.getSQLType()}`,
      );
      await conn.unsafe(
        `CREATE TABLE "${getTableName(table)}" (${columns.join(",")}, PRIMARY KEY ("id"))`,
      );
    }
    const migration = await readFile(
      new URL(
        "../../../drizzle/0052_private_conversations.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await conn.unsafe(migration);
    await conn.unsafe(migration);
  });
  beforeEach(async () => {
    await conn.unsafe(
      "TRUNCATE kublai_organization,kublai_user RESTART IDENTITY CASCADE",
    );
    await fixture.insert(schema.organizations).values([
      { id: org, name: "Synthetic org" },
      { id: foreignOrg, name: "Other org" },
    ]);
    await fixture
      .insert(schema.users)
      .values(
        [
          "author",
          "recipient",
          "third",
          "outsider",
          "foreign",
          "pending",
          "disabled",
        ].map((id) => ({
          id,
          email: `${id}@example.invalid`,
          name: id,
          role: "user",
          organizationId: id === "foreign" ? foreignOrg : org,
          organizationAccessStatus: id === "pending" ? "pending" : "approved",
          permissionConfig:
            id === "disabled"
              ? { version: 2, permissions: { "tab.dashboard": false } }
              : null,
        })),
      );
  });
  afterAll(async () => {
    await conn.end();
    const databaseModule = (await import("~/server/db")) as unknown as {
      __testConnection: postgres.Sql;
    };
    await databaseModule.__testConnection.end();
  });
  const direct = () =>
    createConversation("author", {
      kind: "direct",
      name: "",
      recipientIds: ["recipient"],
    });
  it("reuses simultaneous direct starts; membership hides private rooms from coworkers and executives", async () => {
    const rooms = await Promise.all(Array.from({ length: 6 }, () => direct()));
    expect(new Set(rooms.map((r) => r.id)).size).toBe(1);
    const id = rooms[0]!.id;
    expect((await listConversations("recipient")).conversations).toHaveLength(
      1,
    );
    expect((await listConversations("outsider")).conversations).toHaveLength(0);
    for (const person of ["outsider", "foreign", "pending", "disabled"])
      await expect(conversationAccess(person, id)).rejects.toThrow();
    await conn`update kublai_user set role='admin' where id='outsider'`;
    await expect(conversationAccess("outsider", id)).rejects.toThrow(
      "Conversation not found",
    );
    const people = await conversationPeople("author");
    expect(people.map((p) => p.id)).toEqual(["outsider", "recipient", "third"]);
  });
  it("rejects foreign, unapproved and disabled recipients and preserves job-room independence", async () => {
    for (const recipient of [
      "foreign",
      "pending",
      "disabled",
      "missing",
      "author",
    ])
      await expect(
        createConversation("author", {
          kind: "direct",
          name: "",
          recipientIds: [recipient],
        }),
      ).rejects.toThrow();
    await expect(
      createConversation("author", {
        kind: "group",
        name: "",
        recipientIds: ["recipient", "third"],
      }),
    ).rejects.toThrow("Give the group a name");
  });
  it("delivers to every group member with unread counts and monotonic read cursors", async () => {
    const { id } = await createConversation("author", {
      kind: "group",
      name: "QA coordination",
      recipientIds: ["recipient", "third"],
    });
    const access = await conversationAccess("author", id),
      input = {
        conversationId: id,
        clientId: randomUUID(),
        body: "Branch review",
        attachmentIds: [],
      };
    const sent = await sendConversationMessage(access, input);
    expect(await sendConversationMessage(access, input)).toEqual(sent);
    await expect(
      sendConversationMessage(access, { ...input, body: "changed retry" }),
    ).rejects.toThrow("different contents");
    for (const person of ["recipient", "third"]) {
      const member = await conversationAccess(person, id),
        history = await conversationHistory(member, { limit: 50 });
      expect(history.messages[0]!.body).toBe("Branch review");
      expect(
        (await listConversations(person)).conversations[0]!.unreadCount,
      ).toBe(1);
      await markConversationRead(member, history.messages[0]!.sequence);
      await markConversationRead(member, 0);
      expect(
        (await listConversations(person)).conversations[0]!.unreadCount,
      ).toBe(0);
    }
  });
  it("protects files before and after send, rejects attachment theft, and hides deleted snapshots", async () => {
    const { id } = await direct(),
      author = await conversationAccess("author", id),
      recipient = await conversationAccess("recipient", id);
    const png = await sharp({
      create: { width: 30, height: 20, channels: 3, background: "#00ff00" },
    })
      .png()
      .toBuffer();
    const file = await uploadConversationAttachment(
      author,
      new Request("http://test.invalid", {
        method: "POST",
        headers: { "content-type": "image/png", "x-file-name": "snapshot.png" },
        body: new Uint8Array(png),
      }),
    );
    await expect(
      readConversationAttachment("recipient", file.id),
    ).rejects.toThrow();
    await expect(
      readConversationAttachment("outsider", file.id),
    ).rejects.toThrow();
    await expect(
      sendConversationMessage(recipient, {
        conversationId: id,
        clientId: randomUUID(),
        body: "stolen",
        attachmentIds: [file.id],
      }),
    ).rejects.toThrow("unavailable");
    const sent = await sendConversationMessage(author, {
      conversationId: id,
      clientId: randomUUID(),
      body: "Snapshot",
      attachmentIds: [file.id],
    });
    expect(
      (await readConversationAttachment("recipient", file.id)).data,
    ).toEqual(png);
    const history = await conversationHistory(recipient, { limit: 50 });
    expect(history.messages[0]!.attachments[0]!.id).toBe(file.id);
    await expect(
      deleteConversationAttachment("author", file.id),
    ).rejects.toThrow("already part");
    await expect(
      removeConversationMessage(recipient, sent.id),
    ).rejects.toThrow();
    await removeConversationMessage(author, sent.id);
    await expect(
      readConversationAttachment("recipient", file.id),
    ).rejects.toThrow();
    await conn`update kublai_user set "organizationAccessStatus"='rejected' where id='recipient'`;
    await expect(conversationAccess("recipient", id)).rejects.toThrow();
  });
  it("paginates without missing messages and rejects files from another room", async () => {
    const { id } = await direct(),
      access = await conversationAccess("author", id);
    for (let i = 0; i < 5; i++)
      await sendConversationMessage(access, {
        conversationId: id,
        clientId: randomUUID(),
        body: `message ${i}`,
        attachmentIds: [],
      });
    const latest = await conversationHistory(access, { limit: 2 });
    expect(latest.messages.map((m) => m.body)).toEqual([
      "message 3",
      "message 4",
    ]);
    const older = await conversationHistory(access, {
      limit: 3,
      beforeSequence: latest.nextBeforeSequence!,
    });
    expect(older.messages.map((m) => m.body)).toEqual([
      "message 0",
      "message 1",
      "message 2",
    ]);
    const other = await createConversation("author", {
      kind: "direct",
      name: "",
      recipientIds: ["third"],
    });
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const file = await uploadConversationAttachment(
      await conversationAccess("author", other.id),
      new Request("http://test.invalid", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(png),
      }),
    );
    await expect(
      sendConversationMessage(access, {
        conversationId: id,
        clientId: randomUUID(),
        body: "test",
        attachmentIds: [file.id],
      }),
    ).rejects.toThrow("unavailable");
    await deleteConversationAttachment("author", file.id);
  });
});
