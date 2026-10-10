import { sql } from "drizzle-orm";
import { enqueueMaterialNotification } from "./materials";
import { drainMaterialPush } from "./material-push-worker";
import { readFile } from "node:fs/promises";
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { RequestUser } from "~/server/utils/get-request-identity";
import {
  assertNotificationAccount,
  notificationAccount,
  notificationOverview,
  notificationPage,
  readNotifications,
  jobNotificationSettings,
  setJobNotificationSettings,
} from "./service";
import {
  notificationCursor,
  notificationReadTarget,
} from "~/lib/app-notifications";
const org = randomUUID(),
  foreignOrg = randomUUID(),
  job = randomUUID(),
  otherJob = randomUUID(),
  privateRoom = randomUUID(),
  groupRoom = randomUUID(),
  secretRoom = randomUUID(),
  sheet = randomUUID(),
  entity = randomUUID(),
  alert = randomUUID();
const user = {
  id: "recipient",
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "user",
  currentJobId: null,
} as RequestUser;

describe("notification account boundaries", () => {
  it("requires approval, current organization, dashboard access and matching account", () => {
    expect(notificationAccount(null)).toBeNull();
    for (const denied of [
      { ...user, organizationAccessStatus: "pending" },
      { ...user, organizationId: null },
      {
        ...user,
        permissionConfig: {
          version: 2,
          permissions: { "tab.dashboard": false },
        },
      },
    ])
      expect(notificationAccount(denied)).toBeNull();
    expect(() =>
      assertNotificationAccount(user, `recipient:${foreignOrg}`),
    ).toThrow("Your account changed");
    expect(() =>
      assertNotificationAccount(user, `recipient:${org}`),
    ).not.toThrow();
    expect(
      notificationReadTarget.safeParse({
        kind: "job-chat",
        id: job,
        sequence: -1,
      }).success,
    ).toBe(false);
    expect(
      notificationCursor.safeParse({
        createdAt: "2026-10-09T12:00:00.123456Z",
        id: `drawing:${alert}`,
      }).success,
    ).toBe(true);
  });
});

describe.skipIf(!process.env.NOTIFICATIONS_TEST_SOCKET)(
  "unified notifications against isolated PostgreSQL",
  () => {
    const conn = postgres({
      host:
        process.env.NOTIFICATIONS_TEST_SOCKET ?? "/tmp/no-notification-cluster",
      port: 55451,
      database: "notifications_test",
      max: 4,
    });
    const ctx = { db: drizzle(conn), user, userId: user.id };
    beforeAll(async () => {
      if (
        !process.env.NOTIFICATIONS_TEST_SOCKET?.startsWith(
          "/tmp/foremanhq-notification-pg.",
        )
      )
        throw Error("Refusing non-isolated socket");
      const [scope] = await conn`select current_database() as name`;
      expect(scope!.name).toBe("notifications_test");
      // The actual projection uses all source tables; this isolated cluster never
      // reads or modifies the application's database or uploaded files.
      await conn.unsafe(`
      create table kublai_user (id text primary key,name text,email text,"organizationId" uuid,"organizationAccessStatus" text default 'approved',role text default 'user',"permissionConfig" jsonb,department text);
      create table kublai_organization (id uuid primary key);
      create table kublai_material_list (id uuid primary key,"organizationId" uuid,"jobId" uuid,name text,kind text default 'materials');
      create table kublai_organization_reporting_line ("organizationId" uuid,"userId" text,"reportsToUserId" text,primary key("organizationId","userId","reportsToUserId"));
      create table kublai_organization_department (id uuid primary key,"organizationId" uuid,name text);
      create table kublai_organization_department_lead ("departmentId" uuid,"organizationId" uuid,"userId" text,primary key("departmentId","userId"));
      create table kublai_chat_push_subscription (id uuid primary key,"userId" text,endpoint text,p256dh text,auth text);
      create table kublai_job (id uuid primary key,"organizationId" uuid,name text,"createdByUserId" text,"foremanUserId" text);
      create table kublai_job_chat_member ("jobId" uuid,"userId" text,muted boolean default false,"lastReadSequence" bigint default 0,primary key("jobId","userId"));
      create table kublai_job_chat_message (id uuid primary key,sequence bigserial,"jobId" uuid,"authorId" text,body text,"createdAt" timestamptz default now(),"deletedAt" timestamptz);
      create table kublai_conversation (id uuid primary key,"organizationId" uuid,kind text,name text);
      create table kublai_conversation_member ("conversationId" uuid,"userId" text,"lastReadSequence" bigint default 0,primary key("conversationId","userId"));
      create table kublai_conversation_message (id uuid primary key,sequence bigserial,"conversationId" uuid,"authorId" text,body text,"createdAt" timestamptz default now(),"deletedAt" timestamptz);
      create table kublai_job_drawing_sheet (id uuid primary key,"organizationId" uuid,"jobId" uuid,"setId" uuid,name text);
      create table kublai_drawing_workspace_entity (id uuid primary key,"sheetId" uuid,entity jsonb);
      create table kublai_drawing_workspace_watch ("sheetId" uuid,"userId" text);
      create table kublai_drawing_notification (id uuid primary key,"sheetId" uuid,"entityId" uuid,"recipientId" text,"senderId" text,reason text,"createdAt" timestamptz default now(),"readAt" timestamptz);
    `);
      await conn.unsafe(
        await readFile(
          new URL(
            "../../../drizzle/0060_material_notifications.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    });
    beforeEach(async () => {
      await conn.unsafe(
        "TRUNCATE kublai_user,kublai_job,kublai_job_chat_member,kublai_job_chat_message,kublai_conversation,kublai_conversation_member,kublai_conversation_message,kublai_job_drawing_sheet,kublai_drawing_workspace_entity,kublai_drawing_workspace_watch,kublai_drawing_notification,kublai_organization,kublai_material_list,kublai_organization_reporting_line,kublai_organization_department,kublai_organization_department_lead,kublai_chat_push_subscription,kublai_material_notification,kublai_material_push_outbox RESTART IDENTITY CASCADE",
      );
      await conn`insert into kublai_user (id,name,email) values ('recipient','Recipient','recipient@example.invalid'),('sender','Sender','sender@example.invalid'),('outsider','Outsider','outsider@example.invalid')`;
      await conn`insert into kublai_organization values (${org}),(${foreignOrg})`;
      await conn`update kublai_user set "organizationId"=case when id='outsider' then ${foreignOrg}::uuid else ${org}::uuid end`;
      await conn`insert into kublai_job values (${job},${org},'Job site','sender','recipient'),(${otherJob},${foreignOrg},'Secret site','sender','outsider')`;
      for (const [id, organizationId, kind, name] of [
        [privateRoom, org, "direct", ""],
        [groupRoom, org, "group", "Review group"],
        [secretRoom, org, "group", "Secret group"],
      ] as const)
        await conn`insert into kublai_conversation values (${id},${organizationId},${kind},${name})`;
      await conn`insert into kublai_conversation_member ("conversationId","userId") values (${privateRoom},'recipient'),(${privateRoom},'sender'),(${groupRoom},'recipient'),(${groupRoom},'sender'),(${secretRoom},'sender')`;
      await conn`insert into kublai_job_chat_message (id,"jobId","authorId",body) values (${randomUUID()},${job},'sender','Job message'),(${randomUUID()},${job},'recipient','Own message'),(${randomUUID()},${otherJob},'sender','Foreign message')`;
      for (const id of [privateRoom, groupRoom, secretRoom])
        await conn`insert into kublai_conversation_message (id,"conversationId","authorId",body) values (${randomUUID()},${id},'sender',${id === secretRoom ? "Confidential" : "Private message"})`;
      await conn`insert into kublai_job_drawing_sheet values (${sheet},${org},${job},${randomUUID()},'M-101')`;
      await conn`insert into kublai_drawing_workspace_entity values (${entity},${sheet},${JSON.stringify({ kind: "issue", visibility: "published", data: { assigneeId: "recipient", title: "Check equipment" } })})`;
      await conn`insert into kublai_drawing_notification (id,"sheetId","entityId","recipientId","senderId",reason) values (${alert},${sheet},${entity},'recipient','sender','assignment')`;
    });
    const list = randomUUID();
    const department = randomUUID();
    async function materialFixture() {
      await conn`insert into kublai_material_list (id,"organizationId","jobId",name) values (${list},${org},${job},'Room supplies')`;
      await conn`update kublai_user set department=' plumbing ' where id='sender'`;
      await conn`insert into kublai_organization_department values (${department},${org},'Plumbing')`;
      await conn`insert into kublai_organization_department_lead values (${department},${org},'recipient')`;
      await conn`insert into kublai_chat_push_subscription values (${randomUUID()},'recipient','https://fcm.googleapis.com/test-material','key','auth')`;
    }
    const change = {
      organizationId: org,
      materialListId: list,
      senderId: "sender",
      action: "added" as const,
      eventKey: "test-change",
    };
    const pushConfig = {
      publicKey: "test",
      privateKey: "test",
      subject: "mailto:test@example.invalid",
    };
    it("routes material additions to the department lead in the bell and reads them", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      const page = await notificationPage(ctx, { unreadOnly: true, limit: 30 });
      const item = page.items.find((n) => n.kind === "material-list")!;
      expect(item.title).toBe("Sender added material");
      expect(item.context).toBe("Job site · Room supplies");
      expect(item.url).toBe(`/dashboard/material-lists/${list}`);
      expect((await notificationOverview(ctx)).unreadCount).toBe(5);
      await readNotifications(ctx, [item.target]);
      expect((await notificationOverview(ctx)).unreadCount).toBe(4);
      const sent: string[] = [];
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: async (_d, _c, p) => {
          sent.push(p);
        },
      });
      expect(sent).toEqual([]);
    });
    it("uses department leads instead of reporting managers and excludes self alerts", async () => {
      await materialFixture();
      await conn`update kublai_user set "organizationId"=${org} where id='outsider'`;
      await conn`insert into kublai_organization_reporting_line values (${org},'sender','outsider')`;
      await conn`insert into kublai_organization_department_lead values (${department},${org},'sender')`;
      await enqueueMaterialNotification(ctx.db, change);
      expect(
        (
          await conn`select "recipientId" from kublai_material_notification`
        ).map((row) => row.recipientId),
      ).toEqual(["recipient"]);
    });
    it("does not fall back to reporting managers when there is no department or lead", async () => {
      await materialFixture();
      await conn`insert into kublai_organization_reporting_line values (${org},'sender','recipient')`;
      await conn`update kublai_user set department=null where id='sender'`;
      await enqueueMaterialNotification(ctx.db, change);
      expect(
        await conn`select * from kublai_material_notification`,
      ).toHaveLength(0);
      await conn`update kublai_user set department='Plumbing' where id='sender'`;
      await conn`delete from kublai_organization_department_lead`;
      await enqueueMaterialNotification(ctx.db, change);
      expect(
        await conn`select * from kublai_material_notification`,
      ).toHaveLength(0);
    });
    it("hides and skips a queued alert when the employee changes departments", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      await conn`update kublai_user set department='Electrical' where id='sender'`;
      expect(
        (
          await notificationPage(ctx, { unreadOnly: true, limit: 30 })
        ).items.some((n) => n.kind === "material-list"),
      ).toBe(false);
      let sends = 0;
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: async () => {
          sends++;
        },
      });
      expect(sends).toBe(0);
    });
    it("deduplicates replayed offline changes and delivers a private deep link once", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      await enqueueMaterialNotification(ctx.db, change);
      expect(
        (await conn`select * from kublai_material_notification`).length,
      ).toBe(1);
      expect(
        (await conn`select * from kublai_material_push_outbox`).length,
      ).toBe(1);
      const sent: string[] = [];
      const deps = {
        db: ctx.db as never,
        configuration: pushConfig,
        send: async (_d: unknown, _c: unknown, p: string) => {
          sent.push(p);
        },
      };
      await Promise.all([drainMaterialPush(deps), drainMaterialPush(deps)]);
      await drainMaterialPush(deps);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]!)).toMatchObject({
        type: "material-list",
        url: `/dashboard/material-lists/${list}`,
      });
      expect(sent[0]).not.toMatch(/Sender|Room supplies|recipient|unitCost/);
    });
    it("notifies all department leads, including one without a push subscription", async () => {
      await materialFixture();
      await conn`update kublai_user set "organizationId"=${org} where id='outsider'`;
      await conn`insert into kublai_organization_department_lead values (${department},${org},'outsider')`;
      await enqueueMaterialNotification(ctx.db, {
        ...change,
        action: "edited",
      });
      expect(
        (await conn`select * from kublai_material_notification`).length,
      ).toBe(2);
      expect(
        (await conn`select * from kublai_material_push_outbox`).length,
      ).toBe(1);
    });
    it("excludes foreign, pending and disabled accounts and tool lists", async () => {
      await materialFixture();
      for (const field of [
        sql`"organizationId"=${foreignOrg}::uuid`,
        sql`"organizationAccessStatus"='pending'`,
        sql`"permissionConfig"='{"version":2,"permissions":{"tab.dashboard":false}}'::jsonb`,
      ]) {
        await ctx.db.execute(
          sql`update kublai_user set ${field} where id='recipient'`,
        );
        await enqueueMaterialNotification(ctx.db, change);
        expect(
          (await conn`select * from kublai_material_notification`).length,
        ).toBe(0);
        await conn`update kublai_user set "organizationId"=${org},"organizationAccessStatus"='approved',"permissionConfig"=null where id='recipient'`;
      }
      await conn`update kublai_material_list set kind='tools' where id=${list}`;
      await enqueueMaterialNotification(ctx.db, change);
      expect(
        (await conn`select * from kublai_material_notification`).length,
      ).toBe(0);
    });
    it("rechecks department leads and device ownership before delivery", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      await conn`delete from kublai_organization_department_lead`;
      expect(
        (
          await notificationPage(ctx, { unreadOnly: true, limit: 30 })
        ).items.some((n) => n.kind === "material-list"),
      ).toBe(false);
      let sends = 0;
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: async () => {
          sends++;
        },
      });
      expect(sends).toBe(0);
      expect(
        (await conn`select outcome from kublai_material_push_outbox`)[0]!
          .outcome,
      ).toBe("skipped");
    });
    it("rolls back alerts with an unsuccessful edit transaction", async () => {
      await materialFixture();
      await expect(
        ctx.db.transaction(async (tx) => {
          await enqueueMaterialNotification(tx, change);
          throw Error("edit failed");
        }),
      ).rejects.toThrow("edit failed");
      expect(
        (await conn`select * from kublai_material_notification`).length,
      ).toBe(0);
      expect(
        (await conn`select * from kublai_material_push_outbox`).length,
      ).toBe(0);
    });
    it("does not deliver to a device signed into a different account", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      await conn`update kublai_chat_push_subscription set "userId"='sender'`;
      let sends = 0;
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: async () => {
          sends++;
        },
      });
      expect(sends).toBe(0);
    });
    it("retains alerts on a temporary push failure and retries successfully", async () => {
      await materialFixture();
      await enqueueMaterialNotification(ctx.db, change);
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: async () => {
          throw Object.assign(Error("temporary"), { statusCode: 503 });
        },
      });
      expect(
        (await conn`select "completedAt" from kublai_material_push_outbox`)[0]!
          .completedAt,
      ).toBeNull();
      expect(
        (await conn`select * from kublai_material_notification`).length,
      ).toBe(1);
      await conn`update kublai_material_push_outbox set "availableAt"=now()`;
      await drainMaterialPush({
        db: ctx.db as never,
        configuration: pushConfig,
        send: () => Promise.resolve(),
      });
      expect(
        (await conn`select outcome from kublai_material_push_outbox`)[0]!
          .outcome,
      ).toBe("sent");
    });
    afterAll(async () => {
      await conn.end();
    });

    it("includes drawings, implicit job participants, direct and group chats, with exact counts", async () => {
      const overview = await notificationOverview(ctx);
      expect(overview.unreadCount).toBe(4);
      expect(overview.readTargets).toHaveLength(4);
      const page = await notificationPage(ctx, {
        unreadOnly: false,
        limit: 30,
      });
      expect(page.items).toHaveLength(4);
      expect(new Set(page.items.map((r) => r.kind))).toEqual(
        new Set(["drawing", "job-chat", "conversation"]),
      );
      expect(JSON.stringify(page)).not.toMatch(
        /Confidential|Foreign message|Own message/,
      );
      expect(page.items.some((r) => r.context === "Sender")).toBe(true);
      expect(
        page.items.some(
          (r) => r.url === `/dashboard/chat?conversation=${groupRoom}`,
        ),
      ).toBe(true);
    });
    it("controls existing job mutes centrally and excludes foreign and unrelated jobs", async () => {
      const unrelatedJob = randomUUID();
      await conn`insert into kublai_job values (${unrelatedJob},${org},'Unrelated site','sender','sender')`;
      expect((await jobNotificationSettings(ctx)).jobs).toEqual([
        { id: job, name: "Job site", muted: false },
      ]);
      await setJobNotificationSettings(ctx, job, true);
      expect((await jobNotificationSettings(ctx)).jobs[0]?.muted).toBe(true);
      expect(
        (
          await notificationPage(ctx, { unreadOnly: true, limit: 30 })
        ).items.some((item) => item.kind === "job-chat"),
      ).toBe(false);
      await setJobNotificationSettings(ctx, job, false);
      expect(
        (
          await notificationPage(ctx, { unreadOnly: true, limit: 30 })
        ).items.some((item) => item.kind === "job-chat"),
      ).toBe(true);
      for (const deniedJob of [otherJob, unrelatedJob]) {
        await expect(
          setJobNotificationSettings(ctx, deniedJob, true),
        ).rejects.toThrow("Job chat not found");
      }
      const [member] =
        await conn`select muted from kublai_job_chat_member where "jobId"=${job} and "userId"='recipient'`;
      expect(member?.muted).toBe(false);
    });
    it("paginates equal and sub-millisecond timestamps without duplicates or omissions", async () => {
      await conn`update kublai_job_chat_message set "createdAt"='2026-10-09T12:00:00.123456Z'`;
      for (let i = 0; i < 7; i++)
        await conn`insert into kublai_job_chat_message (id,"jobId","authorId",body,"createdAt") values (${randomUUID()},${job},'sender',${`Older ${i}`},'2026-10-09T12:00:00.123456Z')`;
      const ids: string[] = [];
      let cursor: { createdAt: string; id: string } | null = null;
      do {
        const page = await notificationPage(ctx, {
          unreadOnly: false,
          limit: 2,
          cursor,
        });
        ids.push(...page.items.map((r) => r.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(11);
      expect(new Set(ids).size).toBe(11);
      expect((await notificationOverview(ctx)).unreadCount).toBe(11);
    });
    it("keeps read history and leaves new arrivals unread after marking a snapshot read", async () => {
      const snapshot = await notificationOverview(ctx);
      await conn`insert into kublai_job_chat_message (id,"jobId","authorId",body) values (${randomUUID()},${job},'sender','New job arrival')`;
      await conn`insert into kublai_conversation_message (id,"conversationId","authorId",body) values (${randomUUID()},${privateRoom},'sender','New private arrival')`;
      await conn`insert into kublai_drawing_notification (id,"sheetId","entityId","recipientId","senderId",reason) values (${randomUUID()},${sheet},${entity},'recipient','sender','assignment')`;
      await readNotifications(ctx, snapshot.readTargets);
      expect((await notificationOverview(ctx)).unreadCount).toBe(3);
      expect(
        (await notificationPage(ctx, { unreadOnly: true, limit: 30 })).items,
      ).toHaveLength(3);
      expect(
        (await notificationPage(ctx, { unreadOnly: false, limit: 30 })).items,
      ).toHaveLength(7);
      await readNotifications(
        ctx,
        (await notificationOverview(ctx)).readTargets,
      );
      await readNotifications(ctx, snapshot.readTargets);
      expect((await notificationOverview(ctx)).unreadCount).toBe(0);
    });
    it("applies an individual chat watermark, preserving later unread messages", async () => {
      const first = (
        await notificationPage(ctx, { unreadOnly: true, limit: 30 })
      ).items.find((r) => r.kind === "job-chat")!;
      await conn`insert into kublai_job_chat_message (id,"jobId","authorId",body) values (${randomUUID()},${job},'sender','Later')`;
      await readNotifications(ctx, [first.target]);
      expect((await notificationOverview(ctx)).unreadCount).toBe(4);
      const [member] =
        await conn`select "lastReadSequence" from kublai_job_chat_member where "jobId"=${job} and "userId"='recipient'`;
      expect(Number(member!.lastReadSequence)).toBe(first.target.sequence);
    });
    it("rejects forged read targets for foreign jobs and non-member private chats", async () => {
      await readNotifications(ctx, [
        { kind: "job-chat", id: otherJob, sequence: 999 },
        { kind: "conversation", id: secretRoom, sequence: 999 },
        { kind: "drawing", id: randomUUID() },
      ]);
      expect((await notificationOverview(ctx)).unreadCount).toBe(4);
      const [member] =
        await conn`select count(*)::int as count from kublai_job_chat_member where "jobId"=${otherJob}`;
      expect(member!.count).toBe(0);
      const outsiderCtx = {
        ...ctx,
        user: { ...user, id: "outsider", role: "admin" },
        userId: "outsider",
      };
      expect((await notificationOverview(outsiderCtx)).unreadCount).toBe(0);
    });
    it("honors mute, deletion, membership removal and organization changes immediately", async () => {
      await conn`insert into kublai_job_chat_member ("jobId","userId",muted) values (${job},'recipient',true)`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(3);
      await conn`update kublai_conversation_message set "deletedAt"=now() where "conversationId"=${privateRoom}`;
      await conn`delete from kublai_conversation_member where "conversationId"=${groupRoom} and "userId"='recipient'`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(1);
      const changedCtx = {
        ...ctx,
        user: { ...user, organizationId: foreignOrg },
      };
      expect((await notificationOverview(changedCtx)).unreadCount).toBe(0);
    });
    it("hides private, archived, reassigned and decided drawing alerts and honors watchers", async () => {
      for (const visibility of ["private", "archived"]) {
        await conn`update kublai_drawing_workspace_entity set entity=jsonb_set(entity,'{visibility}',${JSON.stringify(visibility)}) where id=${entity}`;
        expect((await notificationOverview(ctx)).unreadCount).toBe(3);
      }
      await conn`update kublai_drawing_workspace_entity set entity=${JSON.stringify({ kind: "review", visibility: "published", data: { reviewerId: "recipient", status: "pending" } })} where id=${entity}`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(4);
      await conn`insert into kublai_drawing_workspace_entity values (${randomUUID()},${sheet},${JSON.stringify({ kind: "review", visibility: "published", data: { requestId: entity, status: "approved" } })})`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(3);
      await conn`delete from kublai_drawing_workspace_entity where id<>${entity}`;
      await conn`update kublai_drawing_workspace_entity set entity=${JSON.stringify({ kind: "issue", visibility: "published", data: { assigneeId: "sender" } })} where id=${entity}`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(3);
      await conn`insert into kublai_drawing_workspace_watch values (${sheet},'recipient')`;
      expect((await notificationOverview(ctx)).unreadCount).toBe(4);
    });
    it("counts the entire unread backlog beyond a page and reads it without device subscriptions", async () => {
      await conn`insert into kublai_job_chat_message (id,"jobId","authorId",body) select gen_random_uuid(),${job},'sender','Backlog' from generate_series(1,120)`;
      expect(
        (await notificationPage(ctx, { unreadOnly: true, limit: 30 })).items,
      ).toHaveLength(30);
      const overview = await notificationOverview(ctx);
      expect(overview.unreadCount).toBe(124);
      await readNotifications(ctx, overview.readTargets);
      expect((await notificationOverview(ctx)).unreadCount).toBe(0);
    });
  },
);
