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
import { eq, getTableColumns, getTableName } from "drizzle-orm";
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
const network = vi.hoisted(() => ({ send: vi.fn(), lookup: vi.fn() }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: network.send },
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("~/env", () => ({
  env: {
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:ops@example.invalid",
  },
}));
import { drainConversationPush, enqueueConversationPush } from "./push";
import { db } from "~/server/db";
import { users as userColumns } from "~/server/chat/tables";
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
  savedConversationSnapshot,
  editConversationSnapshot,
  listSavedSnapshots,
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
    const subscriptionMigration = await readFile(
      new URL("../../../drizzle/0043_job_chat_push.sql", import.meta.url),
      "utf8",
    );
    await conn.unsafe(
      subscriptionMigration.split(
        'CREATE TABLE IF NOT EXISTS "kublai_chat_push_outbox"',
      )[0]!,
    );
    const pushMigration = await readFile(
      new URL("../../../drizzle/0053_conversation_push.sql", import.meta.url),
      "utf8",
    );
    await conn.unsafe(pushMigration);
    await conn.unsafe(pushMigration);
    const sourceMigration = await readFile(
      new URL(
        "../../../drizzle/0054_snapshot_source_links.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await conn.unsafe(sourceMigration);
    await conn.unsafe(sourceMigration);
    const editMigration = await readFile(
      new URL("../../../drizzle/0056_snapshot_editing.sql", import.meta.url),
      "utf8",
    );
    await conn.unsafe(editMigration);
    await conn.unsafe(editMigration);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    network.lookup.mockResolvedValue([{ address: "142.250.1.1", family: 4 }]);
    network.send.mockResolvedValue({ statusCode: 201 });
    await conn.unsafe(
      "TRUNCATE kublai_organization,kublai_user RESTART IDENTITY CASCADE",
    );
    await fixture.insert(schema.organizations).values([
      { id: org, name: "Synthetic org" },
      { id: foreignOrg, name: "Other org" },
    ]);
    await fixture.insert(schema.users).values(
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
  const imageFile = async (
    access: Awaited<ReturnType<typeof conversationAccess>>,
    color = "#00ff00",
  ) => {
    const png = await sharp({
      create: { width: 30, height: 20, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    return uploadConversationAttachment(
      access,
      new Request("http://test.invalid", {
        method: "POST",
        headers: { "content-type": "image/png", "x-file-name": "snapshot.png" },
        body: new Uint8Array(png),
      }),
    );
  };
  const snapshotFixture = async () => {
    const { id } = await direct(),
      author = await conversationAccess("author", id);
    const original = await imageFile(author);
    const source = {
      href: "/dashboard?view=original",
      title: "Original drawing",
      capturedAt: "2026-10-09T22:00:00Z",
    };
    const sent = await sendConversationMessage(author, {
      conversationId: id,
      clientId: randomUUID(),
      body: "Original caption",
      attachmentIds: [original.id],
      source,
    });
    const snapshot = await savedConversationSnapshot(author, sent.id);
    return { id, author, original, snapshot };
  };
  it("lists only owned images in accessible conversations and searches literal text", async () => {
    const { id, author, snapshot } = await snapshotFixture();
    expect(
      (
        await listSavedSnapshots("author", { search: "Original drawing" })
      ).snapshots.map((v) => v.id),
    ).toEqual([snapshot.id]);
    expect(
      (await listSavedSnapshots("recipient", { search: "" })).snapshots,
    ).toEqual([]);
    expect(
      (await listSavedSnapshots("outsider", { search: "" })).snapshots,
    ).toEqual([]);
    expect(
      (await listSavedSnapshots("foreign", { search: "" })).snapshots,
    ).toEqual([]);
    expect(
      (await listSavedSnapshots("author", { search: "%" })).snapshots,
    ).toEqual([]);
    await expect(
      listSavedSnapshots("pending", { search: "" }),
    ).rejects.toThrow();
    const page = await listSavedSnapshots("author", { search: "" });
    expect(page.snapshots[0]?.imageUrl).toMatch(/^\/api\/chat\/attachments\//);
    // Multiple image attachments must still produce one entry per message.
    const extra = await imageFile(author);
    await fixture
      .update(schema.conversationAttachments)
      .set({ messageId: snapshot.id })
      .where(eq(schema.conversationAttachments.id, extra.id));
    expect(
      (await listSavedSnapshots("author", { search: "" })).snapshots,
    ).toHaveLength(1);
    await fixture
      .delete(schema.conversationMembers)
      .where(eq(schema.conversationMembers.conversationId, id));
    expect(
      (await listSavedSnapshots("author", { search: "" })).snapshots,
    ).toEqual([]);
  });
  it("pages older snapshots without duplicates and omits deleted and text-only posts", async () => {
    const { id, author } = await snapshotFixture();
    for (let i = 0; i < 21; i++) {
      const image = await imageFile(author);
      await sendConversationMessage(author, {
        conversationId: id,
        clientId: randomUUID(),
        body: `Saved ${i}`,
        attachmentIds: [image.id],
      });
    }
    await sendConversationMessage(author, {
      conversationId: id,
      clientId: randomUUID(),
      body: "Text only",
      attachmentIds: [],
    });
    const first = await listSavedSnapshots("author", { search: "" });
    expect(first.snapshots).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await listSavedSnapshots("author", {
      search: "",
      beforeSequence: first.nextCursor!,
    });
    expect(second.snapshots).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.snapshots, ...second.snapshots].map((v) => v.id)).size,
    ).toBe(22);
    await removeConversationMessage(author, first.snapshots[0]!.id);
    expect(
      (await listSavedSnapshots("author", { search: "" })).snapshots.map(
        (v) => v.id,
      ),
    ).not.toContain(first.snapshots[0]!.id);
  });
  it("replaces a snapshot in place and makes identical edit retries safe", async () => {
    const { id, author, original, snapshot } = await snapshotFixture();
    const before = (await conversationHistory(author, { limit: 50 }))
      .messages[0]!;
    const image = await imageFile(author, "#0000ff");
    const input = {
      conversationId: id,
      messageId: snapshot.id,
      clientId: randomUUID(),
      expectedRevision: 1,
      originalAttachmentId: original.id,
      attachmentId: image.id,
      body: "Updated caption",
      source: { ...snapshot.source!, href: "/dashboard?view=updated" },
    };
    const first = await editConversationSnapshot(author, input);
    expect(await editConversationSnapshot(author, input)).toEqual(first);
    expect(first).toMatchObject({ id: snapshot.id, revision: 2 });
    const after = (
      await conversationHistory(await conversationAccess("recipient", id), {
        limit: 50,
      })
    ).messages;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before.id,
      sequence: before.sequence,
      createdAt: before.createdAt,
      body: "Updated caption",
      revision: 2,
      source: input.source,
      attachments: [{ id: image.id }],
    });
    expect(after[0]!.editedAt).toBeInstanceOf(Date);
    await expect(
      readConversationAttachment("recipient", original.id),
    ).rejects.toThrow();
    expect(
      (await readConversationAttachment("recipient", image.id)).mimeType,
    ).toBe("image/png");
    await expect(
      editConversationSnapshot(author, { ...input, body: "Different retry" }),
    ).rejects.toThrow("different changes");
  });
  it("keeps an existing image when only the caption changes, including legacy snapshots without a source", async () => {
    const { id, author, original, snapshot } = await snapshotFixture();
    const result = await editConversationSnapshot(author, {
      conversationId: id,
      messageId: snapshot.id,
      clientId: randomUUID(),
      expectedRevision: 1,
      originalAttachmentId: original.id,
      attachmentId: original.id,
      body: "Caption only",
      source: null,
    });
    expect(result.revision).toBe(2);
    expect(await savedConversationSnapshot(author, snapshot.id)).toMatchObject({
      body: "Caption only",
      source: null,
      image: { id: original.id },
    });
    expect(
      (await readConversationAttachment("recipient", original.id)).mimeType,
    ).toBe("image/png");
  });
  it("rejects concurrent stale changes without consuming the pending replacement", async () => {
    const { id, author, original, snapshot } = await snapshotFixture();
    const one = await imageFile(author),
      two = await imageFile(author);
    const input = {
      conversationId: id,
      messageId: snapshot.id,
      expectedRevision: 1,
      originalAttachmentId: original.id,
      body: "Update",
      source: snapshot.source,
    };
    const edits = await Promise.allSettled([
      editConversationSnapshot(author, {
        ...input,
        clientId: randomUUID(),
        attachmentId: one.id,
      }),
      editConversationSnapshot(author, {
        ...input,
        clientId: randomUUID(),
        attachmentId: two.id,
      }),
    ]);
    expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const conflict = edits.find((r) => r.status === "rejected");
    const reason: unknown =
      conflict?.status === "rejected" ? conflict.reason : null;
    expect(reason).toBeInstanceOf(Error);
    expect((reason as Error).message).toContain("changed elsewhere");
    const [pending] =
      await conn`select count(*)::int as count from kublai_conversation_attachment where "conversationId"=${id} and "messageId" is null`;
    expect(pending!.count).toBe(1);
  });
  it("does not let recipients edit an author's snapshot or restore a deleted one", async () => {
    const { id, author, original, snapshot } = await snapshotFixture();
    const recipient = await conversationAccess("recipient", id);
    const input = {
      conversationId: id,
      messageId: snapshot.id,
      clientId: randomUUID(),
      expectedRevision: 1,
      originalAttachmentId: original.id,
      attachmentId: original.id,
      body: "Changes",
      source: snapshot.source,
    };
    await expect(
      savedConversationSnapshot(recipient, snapshot.id),
    ).rejects.toThrow("own snapshots");
    await expect(editConversationSnapshot(recipient, input)).rejects.toThrow(
      "unavailable",
    );
    await removeConversationMessage(author, snapshot.id);
    await expect(editConversationSnapshot(author, input)).rejects.toThrow(
      "unavailable",
    );
  });
  it("rejects replacement theft and revalidates organization access before saving", async () => {
    const { id, author, original, snapshot } = await snapshotFixture();
    const replacement = await imageFile(
      await conversationAccess("recipient", id),
    );
    const input = {
      conversationId: id,
      messageId: snapshot.id,
      clientId: randomUUID(),
      expectedRevision: 1,
      originalAttachmentId: original.id,
      attachmentId: replacement.id,
      body: "Changes",
      source: snapshot.source,
    };
    await expect(editConversationSnapshot(author, input)).rejects.toThrow(
      "replacement image is unavailable",
    );
    expect(
      (await savedConversationSnapshot(author, snapshot.id)).revision,
    ).toBe(1);
    await conn`update kublai_user set "organizationAccessStatus"='rejected' where id='author'`;
    await expect(
      editConversationSnapshot(author, { ...input, attachmentId: original.id }),
    ).rejects.toThrow("Approved organization");
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
  it("stores snapshot source links, keeps retries immutable and hides sources on deletion", async () => {
    const { id } = await direct(),
      access = await conversationAccess("author", id);
    const source = {
      href: "/dashboard/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/documents?document=cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Specification · v2 · page 3",
      capturedAt: "2026-10-09T20:00:00Z",
    };
    const input = {
      conversationId: id,
      clientId: randomUUID(),
      body: "Snapshot",
      attachmentIds: [],
      source,
    };
    const sent = await sendConversationMessage(access, input);
    expect(await sendConversationMessage(access, input)).toEqual(sent);
    expect(
      (await conversationHistory(access, { limit: 50 })).messages[0]?.source,
    ).toEqual(source);
    await expect(
      sendConversationMessage(access, {
        ...input,
        source: { ...source, href: "/dashboard" },
      }),
    ).rejects.toThrow("different contents");
    await removeConversationMessage(access, sent.id);
    expect(
      (await conversationHistory(access, { limit: 50 })).messages[0]?.source,
    ).toBeNull();
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
  const devices = async (
    names = [
      "author",
      "recipient",
      "third",
      "outsider",
      "foreign",
      "pending",
      "disabled",
      "recipient-second",
    ],
  ) => {
    await fixture.insert(schema.chatPushSubscriptions).values(
      names.map((name) => ({
        userId: name === "recipient-second" ? "recipient" : name,
        endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${name}`,
        p256dh: "fake",
        auth: "fake",
        revokeTokenHash: "0".repeat(64),
      })),
    );
  };
  const post = async (id: string, body = "Private payload") => {
    const access = await conversationAccess("author", id);
    const input = {
      conversationId: id,
      clientId: randomUUID(),
      body,
      attachmentIds: [],
    };
    const result = await sendConversationMessage(access, input);
    return { access, input, result };
  };
  const queued = async () =>
    fixture.select().from(schema.conversationPushOutbox);

  it("queues every recipient device for direct and group chats, never coworkers or the author; retries deduplicate", async () => {
    await devices();
    const { id } = await createConversation("author", {
      kind: "group",
      name: "Private group",
      recipientIds: ["recipient", "third"],
    });
    const sent = await post(id);
    expect(await sendConversationMessage(sent.access, sent.input)).toEqual(
      sent.result,
    );
    const rows = await queued();
    expect(rows.map((r) => r.recipientId).sort()).toEqual([
      "recipient",
      "recipient",
      "third",
    ]);
    await db.transaction((tx) =>
      enqueueConversationPush(tx, {
        organizationId: org,
        conversationId: id,
        messageId: rows[0]!.messageId,
        senderId: "author",
        sequence: rows[0]!.sequence,
      }),
    );
    expect(await queued()).toHaveLength(3);
    await drainConversationPush();
    expect(network.send).toHaveBeenCalledTimes(3);
    expect(
      (await queued()).every(
        (r) => r.outcome === "sent" && r.completedAt && !r.leaseToken,
      ),
    ).toBe(true);
    for (const call of network.send.mock.calls) {
      expect(JSON.parse(call[1] as string) as unknown).toMatchObject({
        type: "conversation-chat",
        url: `/dashboard/chat?conversation=${id}`,
      });
      expect(call[1]).not.toContain("Private payload");
      expect(call[1]).not.toContain("Private group");
    }
    const directRoom = await direct();
    await post(directRoom.id);
    expect(
      (await queued())
        .filter((r) => r.conversationId === directRoom.id)
        .map((r) => r.recipientId),
    ).toEqual(["recipient", "recipient"]);
  });
  it("rechecks unread status, membership, organization and permissions before delivery", async () => {
    await devices(["recipient"]);
    const { id } = await direct();
    await post(id);
    const [row] = await queued();
    await markConversationRead(
      await conversationAccess("recipient", id),
      row!.sequence,
    );
    await drainConversationPush();
    expect((await queued())[0]!.outcome).toBe("skipped");
    await post(id);
    await conn`delete from kublai_conversation_member where "conversationId"=${id} and "userId"='recipient'`;
    await drainConversationPush();
    expect(network.send).not.toHaveBeenCalled();
    await fixture
      .insert(schema.conversationMembers)
      .values({ conversationId: id, userId: "recipient" });
    for (const changes of [
      { organizationAccessStatus: "rejected" },
      { organizationId: foreignOrg },
      {
        permissionConfig: {
          version: 2,
          permissions: { "tab.dashboard": false },
        },
      },
    ]) {
      await post(id);
      await fixture
        .update(schema.users)
        .set(changes)
        .where(eq(userColumns.id, "recipient"));
      await drainConversationPush();
      await conn`update kublai_user set "organizationAccessStatus"='approved', "organizationId"=${org}, "permissionConfig"=null where id='recipient'`;
    }
    expect(network.send).not.toHaveBeenCalled();
    expect(network.lookup).not.toHaveBeenCalled();
    expect((await queued()).every((r) => r.outcome === "skipped")).toBe(true);
  });
  it("does not send deleted messages or devices rebound to another account", async () => {
    await devices(["recipient"]);
    const { id } = await direct();
    const sent = await post(id);
    await removeConversationMessage(sent.access, sent.result.id);
    await drainConversationPush();
    await post(id);
    await conn`update kublai_chat_push_subscription set "userId"='outsider'`;
    await drainConversationPush();
    expect(network.send).not.toHaveBeenCalled();
    expect((await queued()).every((r) => r.outcome === "skipped")).toBe(true);
  });
  it("recovers expired leases, retries provider failures and claims safely across concurrent workers", async () => {
    await devices(["recipient"]);
    const { id } = await direct();
    await post(id);
    network.send.mockRejectedValueOnce({ statusCode: 429 });
    await drainConversationPush();
    expect((await queued())[0]).toMatchObject({
      outcome: "retry",
      attempts: 1,
      completedAt: null,
    });
    await drainConversationPush();
    expect(network.send).toHaveBeenCalledTimes(1);
    await conn`update kublai_conversation_push_outbox set "availableAt"='2000-01-01', "leasedUntil"='2000-01-01', "leaseToken"=${randomUUID()}`;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    network.send.mockImplementation(async () => {
      await barrier;
      return { statusCode: 201 };
    });
    const first = drainConversationPush();
    await vi.waitFor(() => expect(network.send).toHaveBeenCalledTimes(2));
    await drainConversationPush();
    expect(network.send).toHaveBeenCalledTimes(2);
    release();
    await first;
    expect((await queued())[0]).toMatchObject({
      outcome: "sent",
      attempts: 2,
      leaseToken: null,
    });
  });
  it("caps attempts and expires obsolete provider subscriptions", async () => {
    await devices(["recipient"]);
    const { id } = await direct();
    await post(id);
    await conn`update kublai_conversation_push_outbox set attempts=6`;
    await drainConversationPush();
    expect(network.send).not.toHaveBeenCalled();
    expect((await queued())[0]!.outcome).toBe("expired");
    await post(id);
    network.send.mockRejectedValueOnce({ statusCode: 410 });
    await drainConversationPush();
    expect(
      await fixture.select().from(schema.chatPushSubscriptions),
    ).toHaveLength(0);
    expect(await queued()).toHaveLength(0);
  });
  it("notification enqueue rolls back when the transaction fails", async () => {
    await devices(["recipient"]);
    const { id } = await direct();
    await expect(
      db.transaction(async (tx) => {
        const [m] = await tx
          .insert(schema.conversationMessages)
          .values({
            conversationId: id,
            authorId: "author",
            clientId: randomUUID(),
            requestHash: "a".repeat(64),
            body: "Must roll back",
          })
          .returning();
        await enqueueConversationPush(tx, {
          organizationId: org,
          conversationId: id,
          messageId: m!.id,
          senderId: "author",
          sequence: m!.sequence,
        });
        throw Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    expect(await queued()).toHaveLength(0);
    expect(
      (
        await conversationHistory(await conversationAccess("recipient", id), {
          limit: 50,
        })
      ).messages,
    ).toHaveLength(0);
  });
});
