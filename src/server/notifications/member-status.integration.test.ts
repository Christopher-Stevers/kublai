// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { describe, it, expect, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/chat/push", () => ({ getPushConfiguration: () => null }));
import {
  memberNotificationCounts,
  memberNotificationStatus,
} from "./member-status";
import { pushRouter } from "~/server/api/routers/push";
import type { createTRPCContext } from "~/server/api/trpc";

describe.skipIf(process.env.RUN_MEMBER_NOTIFICATION_DB_TESTS !== "1")(
  "organization push status isolation",
  () => {
    it("scopes counts to an organization, combines alert sources, and restricts metadata updates to the device owner", async () => {
      dotenv.config({ quiet: true });
      const client = postgres(process.env.DATABASE_URL!, {
        max: 1,
        onnotice: () => undefined,
      });
      const db = drizzle(client);
      const rollback = new Error("ROLLBACK_NOTIFICATION_FIXTURE");
      try {
        await db.transaction(async (tx) => {
          const namespace = `push_status_${randomUUID().replaceAll("-", "")}`;
          await tx.execute(
            sql.raw(`create schema ${namespace}; set local search_path to ${namespace}, public;
          create table kublai_user (id text primary key, "organizationId" uuid);
          create table kublai_chat_push_subscription (id uuid primary key, "userId" text, endpoint text, "deviceType" varchar(16) not null default 'unknown', "revokeTokenHash" text);
          create table kublai_job (id uuid primary key, "organizationId" uuid);
          create table kublai_job_chat_member ("jobId" uuid, "userId" text, muted boolean);
          create table kublai_job_drawing_sheet (id uuid primary key, "organizationId" uuid);
          create table kublai_drawing_notification (id uuid primary key, "sheetId" uuid, "recipientId" text);
          create table kublai_chat_push_outbox ("recipientId" text, "organizationId" uuid, "completedAt" timestamptz, outcome text, "createdAt" timestamptz default now());
          create table kublai_conversation_push_outbox (like kublai_chat_push_outbox including defaults);
          create table kublai_drawing_push_outbox ("notificationId" uuid, "completedAt" timestamptz, outcome text, "createdAt" timestamptz default now());`),
          );
          const org = randomUUID(),
            other = randomUUID(),
            job = randomUUID(),
            foreignJob = randomUUID(),
            sheet = randomUUID(),
            notification = randomUUID();
          const token = "r".repeat(43),
            hash = createHash("sha256").update(token).digest("hex"),
            endpoint = "https://fcm.googleapis.com/fcm/send/fixture";
          await tx.execute(
            sql`insert into kublai_user values ('alice',${org}::uuid),('bob',${org}::uuid),('foreign',${other}::uuid)`,
          );
          await tx.execute(
            sql`insert into kublai_chat_push_subscription values (${randomUUID()}::uuid,'alice',${endpoint},'phone',${hash}),(${randomUUID()}::uuid,'alice','https://fcm.googleapis.com/fcm/send/second','computer',${hash}),(${randomUUID()}::uuid,'foreign','https://fcm.googleapis.com/fcm/send/foreign','phone',${hash})`,
          );
          await tx.execute(
            sql`insert into kublai_job values (${job}::uuid,${org}::uuid),(${foreignJob}::uuid,${other}::uuid)`,
          );
          await tx.execute(
            sql`insert into kublai_job_chat_member values (${job}::uuid,'alice',true),(${foreignJob}::uuid,'alice',true)`,
          );
          await tx.execute(
            sql`insert into kublai_job_drawing_sheet values (${sheet}::uuid,${org}::uuid)`,
          );
          await tx.execute(
            sql`insert into kublai_drawing_notification values (${notification}::uuid,${sheet}::uuid,'alice')`,
          );
          await tx.execute(
            sql`insert into kublai_chat_push_outbox ("recipientId","organizationId","completedAt",outcome) values ('alice',${org}::uuid,now(),'sent'),('alice',${other}::uuid,now(),'failed')`,
          );
          await tx.execute(
            sql`insert into kublai_conversation_push_outbox ("recipientId","organizationId","completedAt",outcome) values ('alice',${org}::uuid,null,'retry')`,
          );
          await tx.execute(
            sql`insert into kublai_drawing_push_outbox values (${notification}::uuid,now(),'failed',now())`,
          );
          const counts = await memberNotificationCounts(
            tx as unknown as typeof db,
            org,
          );
          expect([...counts.keys()].sort()).toEqual(["alice", "bob"]);
          expect(counts.get("alice")).toMatchObject({
            devices: 2,
            phones: 1,
            computers: 1,
            mutedJobs: 1,
            pending: 1,
            failed: 1,
          });
          expect(counts.get("alice")?.lastSentAt).toBeTruthy();
          expect(counts.get("bob")?.devices).toBe(0);
          expect(JSON.stringify([...counts])).not.toContain("fcm.googleapis");
          expect(
            memberNotificationStatus(counts.get("alice"), false, true).state,
          ).toBe("access-blocked");
          expect(
            memberNotificationStatus(counts.get("alice"), true, false).state,
          ).toBe("server-unavailable");
          expect(
            memberNotificationStatus(counts.get("bob"), true, true).state,
          ).toBe("not-enabled");
          const caller = (userId: string) =>
            pushRouter.createCaller({
              db: tx,
              userId,
              user: {
                id: userId,
                organizationId: org,
                organizationAccessStatus: "approved",
                role: "admin",
              },
              actorUser: null,
              simulation: null,
              headers: new Headers(),
            } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
          expect(
            await caller("bob").reportDevice({
              endpoint,
              revokeToken: token,
              deviceType: "tablet",
            }),
          ).toEqual({ updated: false });
          expect(
            await caller("alice").reportDevice({
              endpoint,
              revokeToken: "x".repeat(43),
              deviceType: "tablet",
            }),
          ).toEqual({ updated: false });
          expect(
            await caller("alice").reportDevice({
              endpoint: "https://fcm.googleapis.com/fcm/send/missing",
              revokeToken: token,
              deviceType: "tablet",
            }),
          ).toEqual({ updated: false });
          expect(
            await caller("alice").reportDevice({
              endpoint,
              revokeToken: token,
              deviceType: "tablet",
            }),
          ).toEqual({ updated: true });
          const after = await memberNotificationCounts(
            tx as unknown as typeof db,
            org,
          );
          expect(after.get("alice")).toMatchObject({
            devices: 2,
            phones: 0,
            tablets: 1,
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      } finally {
        await client.end();
      }
    });
  },
);
