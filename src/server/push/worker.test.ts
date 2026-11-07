// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { db } from "~/server/db";
import { deliverAuthorizedPush, pushSettler, startPushWorker } from "./worker";
const delivery = {
  id: "delivery",
  leaseToken: "lease",
  attempts: 1,
  subscriptionId: "subscription",
  recipientId: "recipient",
  endpoint: "https://push.example.test",
};
afterEach(() => {
  vi.useRealTimers();
});
it("settles only the matching lease and deletes only the owned expired endpoint", async () => {
  const execute = vi.fn(async (_statement: SQL) => []);
  const database = { execute } as unknown as Pick<typeof db, "execute">;
  const settle = pushSettler(database, "kublai_material_push_outbox");
  await deliverAuthorizedPush(database, delivery, settle, async () => {
    throw Object.assign(new Error("Expired endpoint"), { statusCode: 410 });
  });
  const dialect = new PgDialect();
  const deleted = dialect.sqlToQuery(execute.mock.calls[0]![0]);
  expect(deleted.sql).toContain('"userId"=');
  expect(deleted.sql).toContain("endpoint=");
  expect(deleted.params).toEqual([
    "subscription",
    "recipient",
    "https://push.example.test",
  ]);
  execute.mockClear();
  await deliverAuthorizedPush(
    database,
    delivery,
    settle,
    async () => undefined,
  );
  const update = dialect.sqlToQuery(execute.mock.calls[0]![0]);
  expect(update.sql).toContain("where id=");
  expect(update.sql).toContain('and "leaseToken"=');
  expect(update.params).toContain("lease");
  expect(update.params).toContain("sent");
});
it("does not overlap drains or start a duplicate timer", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const drain = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const key = `test-${crypto.randomUUID()}`;
  startPushWorker(key, drain, "test");
  startPushWorker(key, drain, "test");
  expect(drain).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(45000);
  expect(drain).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(15000);
  expect(drain).toHaveBeenCalledTimes(2);
  finish();
  vi.clearAllTimers();
});
