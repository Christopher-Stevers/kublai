import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { LiveHint } from "./live-protocol";
const observer = vi.hoisted(() => ({
  callback: undefined as ((hint: LiveHint) => void) | undefined,
  stop: vi.fn(),
}));
vi.mock("./live-client", () => ({
  observeLiveHints: (callback: (hint: LiveHint) => void) => {
    observer.callback = callback;
    return observer.stop;
  },
}));
import { bindChatOverviewInvalidation } from "./chat-overview-invalidation";
it("invalidates the shared exact overview key, not another job, input or history", () => {
  const client = new QueryClient();
  const key = (jobId: string) =>
    [["chat", "getOverview"], { input: { jobId }, type: "query" }] as const;
  const selected = key("a"),
    other = key("b"),
    history = [["chat", "history"], { input: { jobId: "a" }, type: "query" }],
    extra = [...key("a"), "other-input"];
  for (const k of [selected, other, history, extra])
    client.setQueryData(k, { unreadCount: 1 });
  const stop = bindChatOverviewInvalidation(client, key);
  observer.callback!({ topic: "chat", key: "a", version: 1 });
  expect(client.getQueryState(selected)?.isInvalidated).toBe(false);
  observer.callback!({ topic: "chat-overview", key: "a", version: 2 });
  expect(client.getQueryState(selected)?.isInvalidated).toBe(true);
  for (const k of [other, history, extra])
    expect(client.getQueryState(k)?.isInvalidated).toBe(false);
  stop();
  expect(observer.stop).toHaveBeenCalledOnce();
  client.clear();
});
