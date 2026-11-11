// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LiveHub } from "./hub";
import { frameParser, sourceHint } from "./frames";
describe("bounded live invalidation resume", () => {
  it("replays only the same authenticated scope and resets after a gap or server restart", () => {
    const hub = new LiveHub(2),
      first = hub.publish("org:a", { topic: "material", key: "list" });
    hub.publish("org:b", { topic: "material", key: "private" });
    const next = hub.publish("org:a", {
      topic: "chat",
      key: "job",
      version: 42,
    });
    expect(hub.resume("org:a", first.id)).toEqual({
      reset: false,
      frames: [next],
    });
    hub.publish("org:a", { topic: "catalogue" });
    expect(hub.resume("org:a", first.id).reset).toBe(true);
    expect(new LiveHub().resume("org:a", next.id).reset).toBe(true);
  });
  it("deduplicates equivalent versioned hints from multiple same-account sources without suppressing a new revision", () => {
    const hub = new LiveHub(),
      observer = vi.fn();
    hub.subscribe(observer);
    for (let i = 0; i < 5; i++)
      hub.publish("org:a", { topic: "chat", key: "job", version: 42 });
    expect(observer).toHaveBeenCalledOnce();
    hub.publish("org:a", { topic: "chat", key: "job", version: 43 });
    expect(observer).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++)
      hub.publish("org:a", { topic: "conversations" }, "revision-one");
    expect(observer).toHaveBeenCalledTimes(3);
    hub.publish("org:a", { topic: "conversations" }, "revision-two");
    expect(observer).toHaveBeenCalledTimes(4);
  });
  it("parses fragmented SSE including split CRLF and strips all chat/conversation contents", () => {
    const frames: any[] = [],
      parse = frameParser((frame) => frames.push(frame));
    parse("event: chat-updated\r");
    parse(
      '\ndata: {"jobId":"job","sequence":9,"changes":[{"message":"SECRET"}]}\r\n\r',
    );
    parse("\n");
    expect(frames).toHaveLength(1);
    expect(sourceHint(frames[0])).toEqual({
      topic: "chat",
      key: "job",
      version: 9,
    });
    expect(
      sourceHint({
        event: "conversations-updated",
        id: "",
        data: '{"changes":[{"private":"SECRET"}]}',
      }),
    ).toEqual({ topic: "conversations" });
    expect(JSON.stringify(sourceHint(frames[0]))).not.toContain("SECRET");
  });
  it("ignores unknown frames and bounds an unterminated source frame", () => {
    expect(sourceHint({ event: "unknown", id: "", data: "{}" })).toBeNull();
    const parse = frameParser(() => {});
    expect(() => parse("x".repeat(256 * 1024 + 1))).toThrow("Oversized");
  });
});
