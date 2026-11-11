// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  material: vi.fn(),
  conversations: vi.fn(),
  chat: vi.fn(),
}));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: mocks.identity }));
vi.mock("~/app/api/material-lists/events/route", () => ({
  GET: mocks.material,
}));
vi.mock("~/app/api/conversations/events/route", () => ({
  GET: mocks.conversations,
}));
vi.mock("~/app/api/job-chat/events/route", () => ({ GET: mocks.chat }));
import { GET } from "./route";
import { liveHub } from "~/server/live/hub";
type Source = {
  request: Request;
  send: (value: string) => void;
  closed: boolean;
};
let sources: Source[] = [],
  readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
function source(request: Request) {
  const item: Source = { request, send: () => {}, closed: false };
  sources.push(item);
  let close = () => {},
    timer: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      close = () => {
        if (item.closed) return;
        item.closed = true;
        clearInterval(timer);
        request.signal.removeEventListener("abort", close);
        try {
          output.close();
        } catch {}
      };
      item.send = (value) => output.enqueue(new TextEncoder().encode(value));
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      timer = setInterval(() => {}, 5000);
    },
    cancel() {
      close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  sources = [];
  mocks.identity.mockReset().mockResolvedValue({
    user: {
      id: "user",
      organizationId: "org",
      organizationAccessStatus: "approved",
    },
  });
  for (const fn of [mocks.material, mocks.conversations, mocks.chat])
    fn.mockReset().mockImplementation(source);
});
afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel();
  vi.useRealTimers();
});
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
async function open(query = "") {
  const response = await GET(new Request("http://local/api/live" + query));
  const reader = response.body!.getReader();
  readers.push(reader);
  return { response, reader };
}
const text = (value: ReadableStreamReadResult<Uint8Array>) =>
  new TextDecoder().decode(value.value);
describe("authorized compatibility live multiplexing", () => {
  it("rejects malformed topics and unauthenticated users before opening child streams", async () => {
    expect(
      (await GET(new Request("http://local/api/live?jobs=bad"))).status,
    ).toBe(400);
    mocks.identity.mockResolvedValue({ user: null });
    expect((await GET(new Request("http://local/api/live"))).status).toBe(401);
    expect(sources).toHaveLength(0);
  });
  it("forwards auth to each real source, preserves durable chat cursors, strips private contents, and aborts all sources", async () => {
    const request = new Request(
      `http://local/api/live?conversations=1&jobs=${job}:42&after=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:8`,
      {
        headers: {
          cookie: "session=opaque",
          "last-event-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:8",
        },
      },
    );
    const response = await GET(request),
      reader = response.body!.getReader();
    readers.push(reader);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(text(await reader.read())).toContain("event: connected");
    expect(sources).toHaveLength(3);
    for (const input of sources) {
      expect(input.request.headers.get("cookie")).toBe("session=opaque");
      expect(input.request.headers.get("last-event-id")).toBeNull();
    }
    expect(new URL(sources[2]!.request.url).searchParams.get("after")).toBe(
      "42",
    );
    sources[2]!.send(
      `id: 43\nevent: chat-updated\ndata: ${JSON.stringify({ jobId: job, sequence: 43, changes: [{ message: "SECRET" }] })}\n\n`,
    );
    const frame = text(await reader.read());
    expect(frame).toContain("event: live");
    expect(frame).toContain('"version":43');
    expect(frame).not.toContain("SECRET");
    await reader.cancel();
    readers = [];
    expect(
      sources.every((input) => input.closed && input.request.signal.aborted),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never bypasses a child access denial and closes previously opened sources", async () => {
    mocks.chat.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const response = await GET(
      new Request(`http://local/api/live?jobs=${job}:0`),
    );
    expect(response.status).toBe(403);
    expect(sources.every((input) => input.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("five same-user source copies produce one versioned broker hint", async () => {
    const observer = vi.fn(),
      stop = liveHub.subscribe((frame) => {
        if (frame.hint.key === "amplification-test") observer(frame);
      });
    try {
      for (let i = 0; i < 5; i++) {
        const { reader } = await open();
        await reader.read();
      }
      expect((await GET(new Request("http://local/api/live"))).status).toBe(
        429,
      );
      for (const input of sources)
        input.send(
          'event: material-list-updated\ndata: {"materialListId":"amplification-test","type":"updated","version":9374}\n\n',
        );
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(observer).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });
  it("keeps one 25-second browser heartbeat and closes on request abort", async () => {
    const controller = new AbortController(),
      response = await GET(
        new Request("http://local/api/live", { signal: controller.signal }),
      ),
      reader = response.body!.getReader();
    readers.push(reader);
    await reader.read();
    vi.advanceTimersByTime(25000);
    expect(text(await reader.read())).toContain(": keepalive");
    controller.abort();
    await Promise.resolve();
    expect(sources.every((input) => input.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
