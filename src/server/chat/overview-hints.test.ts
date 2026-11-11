// @vitest-environment node
import { expect, it, vi } from "vitest";
import { notifyChatOverviewChange } from "./overview-hints";
import type { ChatTransaction } from "./types";
import type { ChatAccess } from "./access";
const access = {
  job: { id: "job", organizationId: "org" },
  user: { id: "actor" },
} as ChatAccess;
it("executes optional NOTIFY inside a nested transaction, never on the outer transaction", async () => {
  const execute = vi.fn().mockResolvedValue([]),
    outerExecute = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
    callback({ execute }),
  );
  await notifyChatOverviewChange(
    { transaction, execute: outerExecute } as unknown as ChatTransaction,
    access,
  );
  expect(transaction).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
  expect(outerExecute).not.toHaveBeenCalled();
});
it("does not reject the business callback when the savepoint rolls back a hint error", async () => {
  const order: string[] = [];
  const tx = {
    transaction: async (callback: (tx: unknown) => Promise<void>) => {
      order.push("savepoint");
      try {
        await callback({
          execute: async () => {
            throw Error("notify failed");
          },
        });
      } catch (error) {
        order.push("rollback-savepoint");
        throw error;
      }
    },
  };
  await expect(
    (async () => {
      order.push("business-write");
      await notifyChatOverviewChange(tx as unknown as ChatTransaction, access);
      order.push("outer-commit");
    })(),
  ).resolves.toBeUndefined();
  expect(order).toEqual([
    "business-write",
    "savepoint",
    "rollback-savepoint",
    "outer-commit",
  ]);
});
