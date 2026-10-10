// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/seed-organization", () => ({
  seedOrganization: vi.fn(),
}));
import { organizationRouter } from "./organization";
import type { createTRPCContext } from "~/server/api/trpc";
import {
  organizationPermissionPresets,
  organizationReportingLines,
  users,
} from "~/server/db/schema";
import {
  assertCan,
  resolvePermissions,
  toStoredConfig,
} from "~/server/auth/permissions";
import { PERMISSION_PRESETS } from "~/lib/permission-catalog";

const userIdColumn = (users as unknown as { id: AnyPgColumn }).id;

// Explicit opt-in only. Each test creates an isolated schema and rolls back
// every DDL/data change. No real organization or member is ever modified.
describe.skipIf(process.env.RUN_PERMISSION_PRESET_DB_TESTS !== "1")(
  "live presets with PostgreSQL",
  () => {
    async function isolated(
      run: (fixture: {
        caller: ReturnType<typeof organizationRouter.createCaller>;
        db: ReturnType<typeof drizzle>;
        organizationId: string;
        otherOrganizationId: string;
        actor: Record<string, unknown>;
      }) => Promise<void>,
      actorIsAdmin = true,
    ) {
      dotenv.config({ quiet: true });
      if (!process.env.DATABASE_URL)
        throw new Error("DATABASE_URL required for isolated integration tests");
      const client = postgres(process.env.DATABASE_URL, {
        max: 1,
        onnotice: () => undefined,
      });
      const db = drizzle(client);
      const rollback = new Error("ROLLBACK_TEST_FIXTURE");
      try {
        await db.transaction(async (tx) => {
          const namespace = `preset_test_${randomUUID().replaceAll("-", "")}`;
          await tx.execute(sql.raw(`CREATE SCHEMA ${namespace}`));
          await tx.execute(
            sql.raw(`SET LOCAL search_path TO ${namespace}, public`),
          );
          await tx.execute(
            sql.raw(
              `CREATE TABLE kublai_organization (id uuid PRIMARY KEY, name varchar(255) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now()); CREATE TABLE kublai_user (LIKE public.kublai_user INCLUDING DEFAULTS); ALTER TABLE kublai_user DROP COLUMN IF EXISTS "permissionPresetId"; ALTER TABLE kublai_user DROP COLUMN IF EXISTS "department"; ALTER TABLE kublai_user ADD PRIMARY KEY (id); CREATE TABLE kublai_location (LIKE public.kublai_location INCLUDING DEFAULTS); CREATE TABLE kublai_organization_invite (LIKE public.kublai_organization_invite INCLUDING DEFAULTS)`,
            ),
          );
          await tx.execute(
            sql.raw(
              await readFile(
                "drizzle/0057_live_permission_presets.sql",
                "utf8",
              ),
            ),
          );
          await tx.execute(
            sql.raw(
              await readFile(
                "drizzle/0058_member_departments_reporting.sql",
                "utf8",
              ),
            ),
          );
          const organizationId = randomUUID();
          const otherOrganizationId = randomUUID();
          await tx.execute(
            sql`INSERT INTO kublai_organization (id,name) VALUES (${organizationId},'Test org'), (${otherOrganizationId},'Other org')`,
          );
          const managerConfig = toStoredConfig({
            "tab.organization": true,
            "org.members": true,
          });
          await tx.insert(users).values([
            {
              id: "actor",
              email: "actor@example.test",
              organizationId,
              role: actorIsAdmin ? "admin" : "user",
              permissionConfig: managerConfig,
            },
            { id: "alice", email: "alice@example.test", organizationId },
            { id: "bob", email: "bob@example.test", organizationId },
            {
              id: "foreign",
              email: "foreign@example.test",
              organizationId: otherOrganizationId,
            },
          ]);
          const [actor] = await tx
            .select()
            .from(users)
            .where(eq(userIdColumn, "actor"));
          if (!actor) throw new Error("Missing actor fixture");
          const caller = organizationRouter.createCaller({
            db: tx,
            userId: "actor",
            user: actor,
            headers: new Headers(),
          } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
          await run({
            caller,
            db: tx as unknown as ReturnType<typeof drizzle>,
            organizationId,
            otherOrganizationId,
            actor,
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      } finally {
        await client.end();
      }
    }
    const journeyman = PERMISSION_PRESETS.find(
      (preset) => preset.id === "journeyman",
    )!.permissions;
    const memberInput = (
      userId: string,
      permissionPresetId?: string | null,
    ) => ({
      userId,
      permissionPresetId,
      accessStatus: "approved" as const,
      permissions: journeyman,
    });

    it("applies separate drawing permissions to everyone using a live preset", async () =>
      isolated(async ({ caller, db, organizationId }) => {
        const [legacy] = await db
          .insert(organizationPermissionPresets)
          .values({
            organizationId,
            name: "Legacy drawings",
            permissionConfig: {
              version: 2,
              permissions: { "drawings.manage": true },
            },
          })
          .returning();
        if (!legacy) throw new Error("Missing preset fixture");
        await caller.updateOrganizationMember(memberInput("alice", legacy.id));
        await caller.updateOrganizationMember(memberInput("bob", legacy.id));
        await caller.savePermissionPreset({
          id: legacy.id,
          revision: 1,
          name: "Legacy drawings",
          permissions: {
            "drawings.view": true,
            "drawings.upload": true,
            "drawings.delete": false,
          },
        });
        for (const id of ["alice", "bob"]) {
          const [member] = await db
            .select()
            .from(users)
            .where(eq(userIdColumn, id));
          if (!member) throw new Error("Missing member fixture");
          expect(resolvePermissions(member)["drawings.view"]).toBe(true);
          expect(resolvePermissions(member)["drawings.upload"]).toBe(true);
          expect(() => assertCan(member, "drawings.delete")).toThrow();
        }
      }));

    it("updates all linked members, preserves detached members, and enforces the latest permissions", async () =>
      isolated(async ({ caller, db }) => {
        const preset = await caller.savePermissionPreset({
          name: "Journeyman",
          permissions: journeyman,
        });
        await caller.updateOrganizationMember(memberInput("alice", preset.id));
        await caller.updateOrganizationMember(memberInput("bob", preset.id));
        await caller.savePermissionPreset({
          id: preset.id,
          revision: 1,
          name: "Journeyman",
          permissions: { ...journeyman, "orders.send": true },
        });
        for (const id of ["alice", "bob"]) {
          const [member] = await db
            .select()
            .from(users)
            .where(eq(userIdColumn, id));
          if (!member) throw new Error("Missing member fixture");
          expect(member.permissionPresetId).toBe(preset.id);
          expect(resolvePermissions(member)["orders.send"]).toBe(true);
          expect(() => assertCan(member, "orders.send")).not.toThrow();
        }
        // Older clients and incidental writes cannot customize a linked member.
        await caller.updateOrganizationMember(memberInput("alice"));
        const [stillLinked] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "alice"));
        if (!stillLinked) throw new Error("Missing stillLinked fixture");
        expect(resolvePermissions(stillLinked)["orders.send"]).toBe(true);
        await caller.updateOrganizationMember({
          ...memberInput("bob", null),
          permissions: { ...journeyman, "orders.send": true },
        });
        await caller.savePermissionPreset({
          id: preset.id,
          revision: 2,
          name: "Journeyman",
          permissions: journeyman,
        });
        const [alice] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "alice"));
        if (!alice) throw new Error("Missing alice fixture");
        const [bob] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "bob"));
        if (!bob) throw new Error("Missing bob fixture");
        expect(() => assertCan(alice, "orders.send")).toThrow();
        expect(bob.permissionPresetId).toBeNull();
        expect(resolvePermissions(bob)["orders.send"]).toBe(true);
        await expect(
          caller.deletePermissionPreset({ id: preset.id }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await caller.updateOrganizationMember(memberInput("alice", null));
        await expect(
          caller.deletePermissionPreset({ id: preset.id }),
        ).resolves.toEqual({ deleted: true });
      }));

    it("rejects foreign preset/member access, duplicate names, and stale saves", async () =>
      isolated(async ({ caller, db, otherOrganizationId }) => {
        const [foreign] = await db
          .insert(organizationPermissionPresets)
          .values({
            organizationId: otherOrganizationId,
            name: "Foreign",
            permissionConfig: toStoredConfig(journeyman),
          })
          .returning();
        if (!foreign) throw new Error("Missing foreign fixture");
        await expect(
          caller.updateOrganizationMember(memberInput("alice", foreign.id)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          caller.savePermissionPreset({
            id: foreign.id,
            revision: 1,
            name: "Foreign",
            permissions: journeyman,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          caller.deletePermissionPreset({ id: foreign.id }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const preset = await caller.savePermissionPreset({
          name: "Journeyman",
          permissions: journeyman,
        });
        await expect(
          caller.updateOrganizationMember(memberInput("foreign", preset.id)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          caller.savePermissionPreset({
            name: " journeyman ",
            permissions: journeyman,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await caller.savePermissionPreset({
          id: preset.id,
          revision: 1,
          name: "Journeyman",
          permissions: journeyman,
        });
        await expect(
          caller.savePermissionPreset({
            id: preset.id,
            revision: 1,
            name: "Old",
            permissions: {},
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        // The DB constraint protects non-tRPC writers too. Use a savepoint so the
        // intentionally failed SQL does not abort the parent fixture transaction.
        await expect(
          db.transaction(async (tx) =>
            tx
              .update(users)
              .set({ permissionPresetId: foreign.id })
              .where(eq(userIdColumn, "alice")),
          ),
        ).rejects.toMatchObject({ cause: { code: "23514" } });
      }));

    it("prevents self lockout when assigning or editing a live preset", async () =>
      isolated(async ({ caller, db, actor }) => {
        const workerPreset = await caller.savePermissionPreset({
          name: "Journeyman",
          permissions: journeyman,
        });
        await expect(
          caller.updateOrganizationMember(
            memberInput("actor", workerPreset.id),
          ),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        const manager = await caller.savePermissionPreset({
          name: "Manager",
          permissions: { "org.members": true, "tab.organization": true },
        });
        await caller.updateOrganizationMember(memberInput("actor", manager.id));
        await expect(
          caller.savePermissionPreset({
            id: manager.id,
            revision: 1,
            name: "Manager",
            permissions: journeyman,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        const [member] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "actor"));
        if (!member) throw new Error("Missing member fixture");
        expect(resolvePermissions(member)["org.members"]).toBe(true);
        const denied = organizationRouter.createCaller({
          db,
          userId: "actor",
          user: { ...actor, permissionConfig: null },
          headers: new Headers(),
        } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
        await expect(
          denied.savePermissionPreset({
            name: "Unauthorized",
            permissions: {},
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }, false));

    it("preserves Executive entitlement and refuses preset assignments to protected accounts", async () =>
      isolated(async ({ caller }) => {
        const preset = await caller.savePermissionPreset({
          name: "Journeyman",
          permissions: journeyman,
        });
        await expect(
          caller.updateOrganizationMember(memberInput("actor", preset.id)),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }));

    it("saves a department and several reporting lines, reloads them, and preserves them for older clients", async () =>
      isolated(async ({ caller, db }) => {
        const preset = await caller.savePermissionPreset({
          name: "Journeyman",
          permissions: journeyman,
        });
        await caller.updateOrganizationMember({
          ...memberInput("alice", preset.id),
          department: "  Electrical  ",
          reportsToUserIds: ["actor", "bob", "bob"],
        });
        const settings = await caller.getOrganizationSettings();
        expect(
          settings.members.find((person) => person.id === "alice"),
        ).toMatchObject({
          department: "Electrical",
          reportsToUserIds: ["actor", "bob"],
          permissionPresetId: preset.id,
        });
        expect(
          settings.members.find((person) => person.id === "foreign"),
        ).toBeUndefined();
        await caller.updateOrganizationMember(memberInput("alice"));
        const [alice] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "alice"));
        if (!alice) throw new Error("Missing alice fixture");
        expect(alice.department).toBe("Electrical");
        expect(await db.select().from(organizationReportingLines)).toHaveLength(
          2,
        );
        await caller.updateOrganizationMember({
          ...memberInput("alice"),
          department: "",
          reportsToUserIds: [],
        });
        const cleared = await caller.getOrganizationSettings();
        expect(
          cleared.members.find((person) => person.id === "alice"),
        ).toMatchObject({
          department: null,
          reportsToUserIds: [],
          permissionPresetId: preset.id,
        });
      }));

    it("rejects foreign people, missing people, self-reporting and indirect reporting loops atomically", async () =>
      isolated(async ({ caller, db }) => {
        await caller.updateOrganizationMember({
          ...memberInput("alice"),
          department: "Electrical",
          reportsToUserIds: ["bob"],
        });
        for (const managers of [["foreign"], ["missing"], ["alice"]]) {
          await expect(
            caller.updateOrganizationMember({
              ...memberInput("alice"),
              department: "Wrong",
              reportsToUserIds: managers,
            }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        }
        await caller.updateOrganizationMember({
          ...memberInput("bob"),
          reportsToUserIds: ["actor"],
        });
        await expect(
          caller.updateOrganizationMember({
            ...memberInput("actor"),
            permissions: {},
            reportsToUserIds: ["alice"],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        const [alice] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "alice"));
        if (!alice) throw new Error("Missing alice fixture");
        expect(alice.department).toBe("Electrical");
        expect(await db.select().from(organizationReportingLines)).toHaveLength(
          2,
        );
      }));

    it("allows organization details for protected members without changing their permissions", async () =>
      isolated(async ({ caller, db }) => {
        const [before] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "actor"));
        if (!before) throw new Error("Missing actor fixture");
        await caller.updateOrganizationMember({
          ...memberInput("actor"),
          permissions: resolvePermissions(before),
          department: "Management",
          reportsToUserIds: ["bob"],
        });
        const [after] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "actor"));
        if (!after) throw new Error("Missing actor fixture");
        expect(after.department).toBe("Management");
        expect(after.permissionConfig).toEqual(before.permissionConfig);
        expect(resolvePermissions(after)["org.members"]).toBe(true);
      }));

    it("enforces organization boundaries in SQL and clears old assignments when a person leaves", async () =>
      isolated(async ({ caller, db, organizationId, otherOrganizationId }) => {
        await expect(
          db.transaction(async (tx) => {
            await tx.insert(organizationReportingLines).values({
              organizationId,
              userId: "alice",
              reportsToUserId: "foreign",
            });
          }),
        ).rejects.toThrow();
        await caller.updateOrganizationMember({
          ...memberInput("alice"),
          department: "Electrical",
          reportsToUserIds: ["bob"],
        });
        await db
          .update(users)
          .set({ organizationId: otherOrganizationId })
          .where(eq(userIdColumn, "bob"));
        expect(await db.select().from(organizationReportingLines)).toHaveLength(
          0,
        );
        await db
          .update(users)
          .set({ organizationId: otherOrganizationId })
          .where(eq(userIdColumn, "alice"));
        const [alice] = await db
          .select()
          .from(users)
          .where(eq(userIdColumn, "alice"));
        if (!alice) throw new Error("Missing alice fixture");
        expect(alice.department).toBeNull();
      }));
  },
);
