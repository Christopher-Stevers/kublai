// @vitest-environment node
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
import { createHash } from "node:crypto";
import { getTableColumns, getTableName, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "~/server/db/schema";
import { users } from "~/server/chat/tables";
import type { RequestUser } from "~/server/utils/get-request-identity";

const identity = vi.hoisted(() => ({ actor: "executive" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: identity.actor }),
}));
vi.mock("~/server/utils/ensure-user", () => ({
  ensureUser: async (id: string) => {
    const { db } = await import("~/server/db");
    const { users } = await import("~/server/chat/tables");
    const { eq } = await import("drizzle-orm");
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  },
}));
vi.mock("~/server/utils/get-dev-bypass-user", () => ({
  getDevBypassUser: async () => null,
}));
vi.mock("~/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { default: postgres } = await import("postgres");
  const schema = await import("~/server/db/schema");
  const connection = postgres({
    host:
      process.env.SIMULATION_TEST_SOCKET ?? "/tmp/no-simulation-test-cluster",
    port: 55459,
    database: "simulation_integration",
    max: 8,
  });
  return { db: drizzle(connection, { schema }), __testConnection: connection };
});
import { db } from "~/server/db";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { createTRPCContext, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "~/server/api/routers/user";
import { GET, POST } from "~/app/api/account-simulation/route";
import {
  SIMULATION_COOKIE,
  SIMULATION_VIEW_HEADER,
} from "~/lib/employee-simulation";
import {
  startEmployeeSimulation,
  endEmployeeSimulation,
  resolveEmployeeSimulation,
  simulationHistory,
  assertEditorSimulation,
} from "./service";
import { canSimulateEmployees } from "./policy";

const testRouter = createTRPCRouter({ user: userRouter });
const socket = process.env.SIMULATION_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-simulation-test-cluster",
  port: 55459,
  database: "simulation_integration",
  max: 1,
});
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function person(id = identity.actor) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user as RequestUser;
}
async function start() {
  return startEmployeeSimulation(
    await person("executive"),
    "employee",
    new Headers(),
  );
}
function headers(token: string, view?: string) {
  return new Headers({
    cookie: `${SIMULATION_COOKIE}=${token}`,
    ...(view ? { [SIMULATION_VIEW_HEADER]: view } : {}),
  });
}
function request(
  body: unknown,
  h = new Headers(),
  origin = "https://app.example.test",
) {
  h.set("content-type", "application/json");
  h.set("origin", origin);
  return new Request("https://app.example.test/api/account-simulation", {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
}
describe.skipIf(!socket)(
  "employee simulation with real SQL in an isolated database",
  () => {
    beforeAll(async () => {
      if (!socket?.startsWith("/tmp/foremanhq-simulation-pg."))
        throw Error("Refusing non-isolated database");
      const [database] = await conn`select current_database() as name`;
      if (database?.name !== "simulation_integration")
        throw Error("Unexpected database");
      for (const table of [schema.organizations, schema.users]) {
        const columns = Object.values(getTableColumns(table as PgTable)).map(
          (col) => `"${col.name}" ${col.getSQLType()}`,
        );
        await conn.unsafe(
          `CREATE TABLE "${getTableName(table)}" (${columns.join(",")}, PRIMARY KEY ("id"))`,
        );
      }
      const migration = await readFile(
        new URL(
          "../../../drizzle/0055_employee_simulation.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await conn.unsafe(migration);
      await conn.unsafe(migration);
    });
    beforeEach(async () => {
      identity.actor = "executive";
      await conn.unsafe(
        'TRUNCATE "kublai_organization", "kublai_user", "kublai_employee_simulation_session", "kublai_employee_simulation_audit" CASCADE',
      );
      await db.insert(schema.organizations).values([
        { id: org, name: "Synthetic org" },
        { id: foreign, name: "Foreign org" },
      ]);
      for (const id of [
        "executive",
        "employee",
        "standard-manager",
        "other-executive",
        "admin",
        "foreign",
        "inactive",
      ]) {
        await db.insert(users).values({
          id,
          name: id,
          email: `${id}@example.invalid`,
          organizationId: id === "foreign" ? foreign : org,
          organizationAccessStatus: id === "inactive" ? "pending" : "approved",
          role:
            id === "admin"
              ? "admin"
              : id.includes("executive")
                ? "user"
                : "worker",
          stripeSubscriptionId: id.includes("executive") ? `sub-${id}` : null,
          subscriptionStatus: id.includes("executive") ? "active" : null,
          permissionConfig: {
            version: 2,
            permissions: {
              "financial.view": false,
              ...(id === "standard-manager"
                ? {
                    "tab.organization": true,
                    "organization.members.manage": true,
                  }
                : {}),
            },
          },
          tutorialCompletedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });
    afterAll(async () => {
      await conn.end();
      const databaseModule = (await import("~/server/db")) as unknown as {
        __testConnection: postgres.Sql;
      };
      await databaseModule.__testConnection.end();
    });

    it("binds an opaque hashed session to the executive and resolves the actual employee permissions", async () => {
      const started = await start();
      expect(started.token).toMatch(/^[\w-]{43}$/);
      const [session] = await db
        .select()
        .from(schema.employeeSimulationSessions);
      expect(session?.tokenHash).toBe(
        createHash("sha256").update(started.token).digest("hex"),
      );
      const resolved = await getRequestIdentity(
        headers(started.token, started.simulation.id),
      );
      expect(resolved.userId).toBe("employee");
      expect(resolved.actorUser?.id).toBe("executive");
      const role = await testRouter
        .createCaller(
          await createTRPCContext({
            headers: headers(started.token, started.simulation.id),
          }),
        )
        .user.getMyRole();
      expect(role.permissions.isManagingAccount).toBe(false);
      expect(role.permissions.can["financial.view"]).toBe(false);
      expect(canSimulateEmployees(await person("standard-manager"))).toBe(
        false,
      );
    });
    it.each(["foreign", "inactive", "executive", "admin"])(
      "rejects invalid target %s",
      async (target) => {
        await expect(
          startEmployeeSimulation(await person(), target, new Headers()),
        ).rejects.toThrow();
        expect(
          await db.select().from(schema.employeeSimulationSessions),
        ).toHaveLength(0);
      },
    );
    it("allows Executive peers but does not elevate an Executive to administrator", async () => {
      const started = await startEmployeeSimulation(
        await person(),
        "other-executive",
        new Headers(),
      );
      expect(
        (
          await getRequestIdentity(
            headers(started.token, started.simulation.id),
          )
        ).userId,
      ).toBe("other-executive");
      await expect(
        startEmployeeSimulation(await person(), "admin", new Headers()),
      ).rejects.toThrow("Only administrators");
    });
    it("rejects a standard member even with organization-management flags", async () => {
      await expect(
        startEmployeeSimulation(
          await person("standard-manager"),
          "employee",
          new Headers(),
        ),
      ).rejects.toThrow("Only Executive");
    });
    it("does not transfer a session to another signed-in executive", async () => {
      const started = await start();
      identity.actor = "other-executive";
      expect(
        await resolveEmployeeSimulation(headers(started.token), await person()),
      ).toBeNull();
      await expect(
        getRequestIdentity(headers(started.token, started.simulation.id)),
      ).rejects.toThrow("account view changed");
    });
    it("saves real employee changes and records the executive, action, time and outcome", async () => {
      const started = await start();
      const caller = testRouter.createCaller(
        await createTRPCContext({
          headers: headers(started.token, started.simulation.id),
        }),
      );
      await caller.user.updateProfile({ name: "Edited while simulated" });
      expect((await person("employee")).name).toBe("Edited while simulated");
      expect((await person("executive")).name).toBe("executive");
      const history = await simulationHistory(
        await person("executive"),
        "employee",
      );
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorName: "executive",
            action: "user.updateProfile",
            outcome: "succeeded",
          }),
        ]),
      );
      expect(
        history.every((entry) => Number.isFinite(Date.parse(entry.createdAt))),
      ).toBe(true);
    });
    it("records failed mutations without making the requested change", async () => {
      const started = await start();
      const caller = testRouter.createCaller(
        await createTRPCContext({
          headers: headers(started.token, started.simulation.id),
        }),
      );
      await expect(caller.user.updateProfile({ name: "" })).rejects.toThrow();
      expect((await person("employee")).name).toBe("employee");
      expect(await simulationHistory(await person(), "employee")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "user.updateProfile",
            outcome: "failed",
          }),
        ]),
      );
    });
    it("blocks edits when the audit store is unavailable", async () => {
      const started = await start();
      const ctx = await createTRPCContext({
        headers: headers(started.token, started.simulation.id),
      });
      await conn.unsafe(
        "ALTER TABLE kublai_employee_simulation_audit RENAME TO temporarily_unavailable_audit",
      );
      try {
        await expect(
          testRouter
            .createCaller(ctx)
            .user.updateProfile({ name: "Must not save" }),
        ).rejects.toThrow();
      } finally {
        await conn.unsafe(
          "ALTER TABLE temporarily_unavailable_audit RENAME TO kublai_employee_simulation_audit",
        );
      }
      expect((await person("employee")).name).toBe("employee");
    });
    it.each([
      "actor-permissions",
      "employee-access",
      "organization",
      "expired",
    ])(
      "revalidates %s on every request and rejects stale view writes",
      async (change) => {
        const started = await start();
        if (change === "actor-permissions")
          await db
            .update(users)
            .set({ subscriptionStatus: "canceled" })
            .where(eq(users.id, "executive"));
        if (change === "employee-access")
          await db
            .update(users)
            .set({ organizationAccessStatus: "pending" })
            .where(eq(users.id, "employee"));
        if (change === "organization")
          await db
            .update(users)
            .set({ organizationId: foreign })
            .where(eq(users.id, "employee"));
        if (change === "expired")
          await db
            .update(schema.employeeSimulationSessions)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(
              eq(schema.employeeSimulationSessions.id, started.simulation.id),
            );
        expect(
          await resolveEmployeeSimulation(
            headers(started.token),
            await person(),
          ),
        ).toBeNull();
        await expect(
          getRequestIdentity(headers(started.token, started.simulation.id)),
        ).rejects.toThrow("account view changed");
        await expect(
          assertEditorSimulation(started.simulation.id, "employee"),
        ).rejects.toThrow();
        await endEmployeeSimulation(await person(), headers(started.token));
        const [row] = await db.select().from(schema.employeeSimulationSessions);
        expect(row?.endedAt).toBeInstanceOf(Date);
      },
    );
    it("ends simulation and rejects queued requests from both previous account views", async () => {
      const started = await start();
      await expect(
        getRequestIdentity(headers(started.token, "account:executive")),
      ).rejects.toThrow("account view changed");
      await endEmployeeSimulation(await person(), headers(started.token));
      await expect(
        getRequestIdentity(headers(started.token, started.simulation.id)),
      ).rejects.toThrow("account view changed");
      expect((await getRequestIdentity(new Headers())).userId).toBe(
        "executive",
      );
      await expect(
        assertEditorSimulation(started.simulation.id, "employee"),
      ).rejects.toThrow("simulation ended");
    });
    it("replaces a previous session and preserves its audit history", async () => {
      const first = await start();
      const second = await startEmployeeSimulation(
        await person(),
        "employee",
        headers(first.token),
      );
      expect(
        await resolveEmployeeSimulation(headers(first.token), await person()),
      ).toBeNull();
      expect(
        (await resolveEmployeeSimulation(headers(second.token), await person()))
          ?.simulation.id,
      ).toBe(second.simulation.id);
      expect(await simulationHistory(await person(), "employee")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "Simulation replaced" }),
        ]),
      );
    });
    it("audits custom HTTP writes and never records secrets or request content", async () => {
      const started = await start();
      const h = headers(started.token, started.simulation.id);
      await getRequestIdentity(h, {
        request: new Request(
          "https://app.example.test/api/job-documents?access_token=secret",
          { method: "POST", headers: h, body: "private content" },
        ),
      });
      expect(await simulationHistory(await person(), "employee")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "POST /api/job-documents",
            outcome: "requested",
          }),
        ]),
      );
      expect(
        JSON.stringify(await simulationHistory(await person(), "employee")),
      ).not.toContain("secret");
    });
    it("uses secure HTTP-only cookies and enforces same-origin start/end requests", async () => {
      expect(
        (
          await POST(
            request(
              { action: "start", employeeId: "employee" },
              new Headers(),
              "https://evil.example.test",
            ),
          )
        ).status,
      ).toBe(403);
      const response = await POST(
        request({ action: "start", employeeId: "employee" }),
      );
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=lax/i);
      const token = /=([\w-]{43});/.exec(cookie)![1]!;
      expect(
        (
          await GET(
            new Request("https://app.example.test/api/account-simulation", {
              headers: headers(token),
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await POST(request({ action: "end" }, headers(token)))).status,
      ).toBe(200);
      expect(
        await resolveEmployeeSimulation(headers(token), await person()),
      ).toBeNull();
    });
    it("does not expose an employee's audit history outside the organization", async () => {
      await start();
      await expect(
        simulationHistory(await person("foreign"), "employee"),
      ).rejects.toThrow();
    });
  },
);
