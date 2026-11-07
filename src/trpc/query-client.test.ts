// @vitest-environment node
import { expect, it } from "vitest";
import { MutationObserver } from "@tanstack/react-query";
import { createQueryClient } from "./query-client";

it("invalidates the bell and history after reading or changing any notification source", async () => {
  const client = createQueryClient();
  const overview = [
    ["notifications", "overview"],
    { input: { accountKey: "user:org" }, type: "query" },
  ];
  const list = [
    ["notifications", "list"],
    { input: { accountKey: "user:org" }, type: "infinite" },
  ];
  for (const router of ["chat", "conversations", "drawingsWorkspace"]) {
    client.setQueryData(overview, { unreadCount: 2 });
    client.setQueryData(list, { items: [] });
    const mutation = new MutationObserver(client, {
      mutationKey: [[router, "markRead"]],
      mutationFn: () => Promise.resolve({ ok: true }),
    });
    await mutation.mutate();
    expect(client.getQueryState(overview)?.isInvalidated).toBe(true);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
  }
  client.clear();
});
it("leaves notifications cached after unrelated or failed mutations", async () => {
  const client = createQueryClient();
  const key = [["notifications", "overview"]];
  client.setQueryData(key, { unreadCount: 2 });
  const unrelated = new MutationObserver(client, {
    mutationKey: [["catalogue", "save"]],
    mutationFn: () => Promise.resolve(),
  });
  await unrelated.mutate();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  const failed = new MutationObserver(client, {
    mutationKey: [["chat", "markRead"]],
    mutationFn: () => Promise.reject(Error("Offline")),
  });
  await expect(failed.mutate()).rejects.toThrow("Offline");
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});
