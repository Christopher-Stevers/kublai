// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("./trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  return { hasDashboardAccess: initTRPC.create().procedure };
});
import { initTRPC } from "@trpc/server";
import { retiredOfflineMutation } from "./retired-offline-sync";
it("never acknowledges old edits, writes to the DB or returns a permanent bad-request error", async () => {
  const transaction = vi.fn();
  const caller = initTRPC
    .create()
    .router({ sync: retiredOfflineMutation })
    .createCaller({ db: { transaction } });
  await expect(
    caller.sync({ mutations: [{ clientMutationId: "unsent", quantity: 4 }] }),
  ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(transaction).not.toHaveBeenCalled();
});
