// @vitest-environment node
import { readFile } from "node:fs/promises";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import { notifyTimesheetChange } from "./notify";
it.each([false, true])(
  "creates only bounded transactional invalidation metadata (org=%s)",
  async (organizationWide) => {
    const execute = vi.fn(async (_query: SQL) => undefined);
    await notifyTimesheetChange(
      { execute } as unknown as Parameters<typeof notifyTimesheetChange>[0],
      "org",
      "actor",
      organizationWide,
    );
    const query = new PgDialect().sqlToQuery(
      execute.mock.calls[0]![0] as never,
    );
    expect(query.sql).toContain("pg_notify('foremanhq_change'");
    const envelope = JSON.parse(query.params[0] as string) as {
      hint: Record<string, unknown>;
    };
    expect(Object.keys(envelope.hint).sort()).toEqual(
      (organizationWide
        ? ["topic", "organizationId", "scope", "eventId"]
        : ["topic", "organizationId", "scope", "eventId", "userId"]
      ).sort(),
    );
    expect(envelope.hint.scope).toBe(
      organizationWide ? "organization" : "personal",
    );
  },
);
it("all eight mutation producers use the transactional durable-event funnel", async () => {
  const source = await readFile(
    new URL("../api/routers/timesheets.ts", import.meta.url),
    "utf8",
  );
  const names = [
    "saveEntry",
    "deleteEntry",
    "submit",
    "withdraw",
    "review",
    "settings",
    "clockStart",
    "clockAction",
  ];
  for (const name of names) {
    const start = source.indexOf(`  ${name}:`);
    const end = source.indexOf("\n  ", start + 3);
    // Router declarations are two-space indented; their body is deeper.
    const next = source.slice(start + 3).search(/\n  \w+:/);
    const body = source.slice(
      start,
      next < 0 ? source.length : start + 3 + next,
    );
    expect(body, name).toContain("ctx.db.transaction");
    expect(body, name).toContain("await event(");
    expect(end).toBeGreaterThan(start);
  }
  expect(source).toContain(
    "await notifyTimesheetChange(tx, actor.organizationId, userId, organizationWide)",
  );
});
