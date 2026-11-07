// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("~/server/api/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure };
});
vi.mock("~/server/auth/permissions", () => ({ getUserPermissions: vi.fn() }));

import { userRouter } from "./user";
import { users } from "~/server/db/schema";

const ownUserId = "user_worker";
const otherUserId = "user_other";
const finishedAt = new Date("2026-10-03T20:00:00.000Z");
type TutorialState = { completedAt: Date | null; outcome: "completed" | "skipped" | null };
const pending: TutorialState = { completedAt: null, outcome: null };
const dialect = new PgDialect();

function setup(state: TutorialState | null = pending, failure?: Error) {
  const tables: unknown[] = [];
  const predicates: SQL[] = [];
  const writes: Record<string, unknown>[] = [];
  const projections: unknown[] = [];
  const result = () => failure ? Promise.reject(failure) : Promise.resolve(state ? [state] : []);
  const db = {
    select: vi.fn((fields: unknown) => {
      projections.push(fields);
      return { from: (table: unknown) => {
        tables.push(table);
        return { where: (predicate: SQL) => {
          predicates.push(predicate);
          return { limit: result };
        } };
      } };
    }),
    update: vi.fn((table: unknown) => {
      tables.push(table);
      return { set: (fields: Record<string, unknown>) => {
        writes.push(fields);
        return { where: (predicate: SQL) => {
          predicates.push(predicate);
          return { returning: (fields: unknown) => { projections.push(fields); return result(); } };
        } };
      } };
    }),
  };
  return {
    db, tables, writes, projections,
    caller: userRouter.createCaller({ userId: ownUserId, user: { id: ownUserId, tutorialCompletedAt: null, tutorialOutcome: null }, db } as never),
    assertOwnUserOnly: () => {
      expect(tables.length).toBeGreaterThan(0);
      expect(tables.every((table) => table === users)).toBe(true);
      for (const predicate of predicates) {
        expect(dialect.sqlToQuery(predicate)).toMatchObject({ sql: '"kublai_user"."id" = $1', params: [ownUserId] });
      }
    },
  };
}

function sqlQuery(value: unknown) {
  // SQL expressions are examined directly; the database mock does not implement SQL.
  expect(value).toHaveProperty("queryChunks");
  return dialect.sqlToQuery(value as SQL);
}

describe("account tutorial progress", () => {
  it("reads current saved state for only this account, not the request's stale user snapshot", async () => {
    const saved: TutorialState = { completedAt: finishedAt, outcome: "completed" };
    const test = setup(saved);
    expect(await test.caller.getTutorialState()).toEqual({ ...saved, userId: ownUserId });
    test.assertOwnUserOnly();
    expect(test.writes).toEqual([]);
    expect(test.projections[0]).toHaveProperty("completedAt");
    expect(test.projections[0]).toHaveProperty("outcome");
  });

  it("existing accounts with no progress start pending", async () => {
    const test = setup();
    expect(await test.caller.getTutorialState()).toEqual({ ...pending, userId: ownUserId });
    test.assertOwnUserOnly();
  });

  it.each(["completed", "skipped"] as const)("persists %s without changing roles, permissions, or another user's data", async (outcome) => {
    const saved = { completedAt: finishedAt, outcome };
    const test = setup(saved);
    // Unknown keys supplied by an untrusted client cannot choose a target account.
    const input = { outcome, expectedUserId: ownUserId, userId: otherUserId, role: "admin" };
    expect(await test.caller.finishTutorial(input)).toEqual(saved);
    test.assertOwnUserOnly();
    expect(Object.keys(test.writes[0]!)).toEqual(["tutorialCompletedAt", "tutorialOutcome"]);
    const outcomeWrite = sqlQuery(test.writes[0]!.tutorialOutcome);
    expect(outcomeWrite.params).toEqual([outcome]);
  });

  it("finishing twice or from a second device keeps the first terminal timestamp/outcome until restart", async () => {
    const saved: TutorialState = { completedAt: finishedAt, outcome: "completed" };
    const test = setup(saved);
    expect(await test.caller.finishTutorial({ expectedUserId: ownUserId, outcome: "completed" })).toEqual(saved);
    expect(await test.caller.finishTutorial({ expectedUserId: ownUserId, outcome: "skipped" })).toEqual(saved);
    for (const write of test.writes) {
      expect(sqlQuery(write.tutorialCompletedAt).sql).toBe('coalesce("kublai_user"."tutorialCompletedAt", now())');
      expect(sqlQuery(write.tutorialOutcome).sql).toBe('case when "kublai_user"."tutorialCompletedAt" is null then $1 else "kublai_user"."tutorialOutcome" end');
    }
    test.assertOwnUserOnly();
  });

  it("restart clears only this account's progress and is safe to repeat", async () => {
    const test = setup();
    expect(await test.caller.restartTutorial({ expectedUserId: ownUserId })).toEqual(pending);
    expect(await test.caller.restartTutorial({ expectedUserId: ownUserId })).toEqual(pending);
    expect(test.writes).toEqual([
      { tutorialCompletedAt: null, tutorialOutcome: null },
      { tutorialCompletedAt: null, tutorialOutcome: null },
    ]);
    test.assertOwnUserOnly();
  });

  it("rejects unsupported outcomes before touching the database", async () => {
    const test = setup();
    // @ts-expect-error Untrusted clients can send invalid JSON despite client types.
    await expect(test.caller.finishTutorial({ expectedUserId: ownUserId, outcome: "abandoned" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(test.tables).toEqual([]);
  });

  it.each(["completed", "skipped"] as const)("rejects stale-account %s requests before any database access", async (outcome) => {
    const test = setup();
    await expect(test.caller.finishTutorial({ expectedUserId: otherUserId, outcome })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(test.tables).toEqual([]);
    expect(test.writes).toEqual([]);
  });

  it("rejects restart from a cached layout for a different account", async () => {
    const test = setup();
    await expect(test.caller.restartTutorial({ expectedUserId: otherUserId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(test.tables).toEqual([]);
    expect(test.writes).toEqual([]);
  });

  it("requires the expected account on both mutations", async () => {
    const test = setup();
    // @ts-expect-error A cached or untrusted client can omit the required guard.
    await expect(test.caller.finishTutorial({ outcome: "completed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error A cached or untrusted client can omit the required guard.
    await expect(test.caller.restartTutorial({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(test.tables).toEqual([]);
  });

  it("reports a deleted account rather than pretending completion saved", async () => {
    const test = setup(null);
    await expect(test.caller.getTutorialState()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(test.caller.finishTutorial({ expectedUserId: ownUserId, outcome: "completed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(test.caller.restartTutorial({ expectedUserId: ownUserId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    test.assertOwnUserOnly();
  });

  it("propagates persistence failures so clients can retry instead of losing progress", async () => {
    const test = setup(pending, new Error("database unavailable"));
    await expect(test.caller.finishTutorial({ expectedUserId: ownUserId, outcome: "skipped" })).rejects.toThrow("database unavailable");
    await expect(test.caller.restartTutorial({ expectedUserId: ownUserId })).rejects.toThrow("database unavailable");
  });
});
