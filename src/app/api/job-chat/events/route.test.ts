// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const state = vi.hoisted(() => ({
  access: vi.fn(),
  identity: vi.fn(),
  rows: [] as { sequence: number; messageId: string; type: string }[],
  listener: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("~/server/chat/access", () => ({ assertChatAccess: state.access }));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: state.identity,
}));
vi.mock("~/server/chat/events", () => ({
  subscribeChatEvents: (_jobId: string, listener: () => void) => {
    state.listener = listener;
    return state.unsubscribe;
  },
}));
vi.mock("~/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              const rows = state.rows;
              state.rows = [];
              return rows;
            },
          }),
        }),
      }),
    }),
  },
}));
import { GET } from "./route";
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
async function open(headers?: HeadersInit) {
  const response = await GET(
    new Request(`http://local.invalid/api/job-chat/events?jobId=${job}`, {
      headers,
    }),
  );
  const reader = response.body!.getReader();
  readers.push(reader);
  return { response, reader };
}
const decode = (chunk: ReadableStreamReadResult<Uint8Array>) =>
  chunk.value ? new TextDecoder().decode(chunk.value) : "";
beforeEach(() => {
  vi.useFakeTimers();
  state.access.mockReset().mockResolvedValue({});
  state.identity.mockReset().mockResolvedValue({ userId: "synthetic-user" });
  state.rows = [];
  state.listener = undefined;
  state.unsubscribe.mockReset();
});
afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel();
  vi.useRealTimers();
});

describe("authenticated job chat event stream", () => {
  it("rejects malformed jobs/cursors and unauthenticated requests", async () => {
    expect(
      (
        await GET(
          new Request("http://local.invalid/api/job-chat/events?jobId=wrong"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(`http://local.invalid/api/job-chat/events?jobId=${job}`, {
            headers: { "last-event-id": "-1" },
          }),
        )
      ).status,
    ).toBe(400);
    state.access.mockRejectedValue(new TRPCError({ code: "UNAUTHORIZED" }));
    expect(
      (
        await GET(
          new Request(`http://local.invalid/api/job-chat/events?jobId=${job}`),
        )
      ).status,
    ).toBe(401);
  });
  it("sends only durable invalidation metadata and resumes from a supplied cursor", async () => {
    state.rows = [{ sequence: 9, messageId: "message-id", type: "edited" }];
    const { response, reader } = await open({ "last-event-id": "8" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(decode(await reader.read())).toContain("event: connected");
    const chunk = decode(await reader.read());
    expect(chunk).toContain("id: 9\nevent: chat-updated");
    expect(chunk).toContain('"type":"edited"');
    expect(chunk).not.toContain('"body"');
    expect(state.access).toHaveBeenCalledWith("synthetic-user", job);
  });
  it("reauthorizes on polls and closes when access is revoked", async () => {
    const { reader } = await open();
    await reader.read();
    await reader.read(); // connected + first keepalive
    state.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await reader.read()).done).toBe(true);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removes timers/subscribers on abort and can open a fresh connection", async () => {
    const abort = new AbortController();
    const response = await GET(
      new Request(`http://local.invalid/api/job-chat/events?jobId=${job}`, {
        signal: abort.signal,
      }),
    );
    const reader = response.body!.getReader();
    readers.push(reader);
    await reader.read();
    await reader.read();
    abort.abort();
    expect((await reader.read()).done).toBe(true);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const reopened = await open();
    expect(reopened.response.status).toBe(200);
  });
  it("bounds simultaneous connections per user and releases slots on disconnect", async () => {
    for (let index = 0; index < 5; index++)
      expect((await open()).response.status).toBe(200);
    expect(
      (
        await GET(
          new Request(`http://local.invalid/api/job-chat/events?jobId=${job}`),
        )
      ).status,
    ).toBe(429);
    await readers.shift()!.cancel();
    expect((await open()).response.status).toBe(200);
  });
});
