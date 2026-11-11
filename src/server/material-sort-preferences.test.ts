import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { saveMaterialSortPreferences } from "./material-sort-preferences";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
import type { db } from "~/server/db";
const dialect = new PgDialect();
function fixture(changed = true, fail = false) {
  const statements: ReturnType<typeof dialect.sqlToQuery>[] = [];
  let committed = false;
  const database = {
    transaction: vi.fn(async (run: (tx: unknown) => Promise<void>) => {
      await run({
        execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
          const statement = dialect.sqlToQuery(query);
          statements.push(statement);
          if (statement.sql.includes("pg_notify")) {
            if (fail) throw Error("notify unavailable");
            return [];
          }
          return changed ? [{ scope: "crew" }] : [];
        },
      });
      committed = true;
    }),
  };
  return {
    database: database as unknown as typeof db,
    statements,
    committed: () => committed,
  };
}
it("writes and notifies inside one transaction with a content-free personal audience", async () => {
  const f = fixture();
  await saveMaterialSortPreferences(
    f.database,
    "org",
    "crew",
    defaultMaterialSortSettings,
    true,
  );
  expect(f.committed()).toBe(true);
  expect(f.statements).toHaveLength(2);
  const envelope = JSON.parse(f.statements[1]!.params[0] as string) as {
    hint: Record<string, unknown>;
  };
  expect(envelope.hint).toEqual({
    topic: "preferences",
    organizationId: "org",
    scope: "personal",
    userId: "crew",
    eventId: expect.any(String) as unknown,
  });
  expect(JSON.stringify(envelope)).not.toContain("sortMode");
});
it("does not notify on an initialize-only conflict", async () => {
  const f = fixture(false);
  await saveMaterialSortPreferences(
    f.database,
    "org",
    "executive",
    defaultMaterialSortSettings,
    false,
    true,
  );
  expect(f.statements).toHaveLength(1);
  expect(f.statements[0]!.sql).toContain("do nothing");
});
it("propagates notify failure so the enclosing transaction cannot commit", async () => {
  const f = fixture(true, true);
  await expect(
    saveMaterialSortPreferences(
      f.database,
      "org",
      "executive",
      defaultMaterialSortSettings,
      false,
    ),
  ).rejects.toThrow("notify unavailable");
  expect(f.committed()).toBe(false);
  expect(
    (JSON.parse(f.statements[1]!.params[0] as string) as { hint: unknown })
      .hint,
  ).not.toHaveProperty("userId");
});
