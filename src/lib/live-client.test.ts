import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveClient } from "./live-client";
import { setAppPageActive } from "./app-page-activity";
vi.mock("./offline-test", () => ({ isOfflineTestEnabled: () => false }));
class Source extends EventTarget {
  static all: Source[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    super();
    Source.all.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown = {}, id = "") {
    this.dispatchEvent(
      new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id }),
    );
  }
}
let manager: LiveClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Source);
  Source.all = [];
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  setAppPageActive(true);
  manager = new LiveClient();
});
afterEach(() => {
  manager.dispose();
  setAppPageActive(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
describe("single authenticated live document transport", () => {
  it("coalesces material/chat/conversation subscribers into one source and fans out only their topics", () => {
    manager.setAccount("org:user");
    const material = vi.fn(),
      chat = vi.fn(),
      conversations = vi.fn();
    manager.subscribe({}, { hint: material });
    manager.subscribe({ jobIds: [job] }, { hint: chat });
    manager.subscribe({ conversations: true }, { hint: conversations });
    vi.advanceTimersByTime(0);
    expect(Source.all).toHaveLength(1);
    expect(Source.all[0]!.url).toContain("/api/live?");
    expect(Source.all[0]!.url).toContain("conversations=1");
    Source.all[0]!.emit("live", { topic: "chat", key: job, version: 9 });
    expect(chat).toHaveBeenCalledOnce();
    expect(conversations).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    Source.all[0]!.emit("live", { topic: "replicache", version: 10 });
    expect(material).toHaveBeenCalledOnce();
  });
  it("immediately catches up a subscriber joining an already-connected topic without opening another socket", () => {
    manager.setAccount("org:user");
    manager.subscribe({ conversations: true }, { hint: vi.fn() });
    vi.advanceTimersByTime(0);
    Source.all[0]!.emit("connected");
    const status = vi.fn(),
      catchUp = vi.fn();
    manager.subscribe(
      { conversations: true },
      { hint: vi.fn(), status, catchUp },
    );
    vi.advanceTimersByTime(0);
    expect(Source.all).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith(true);
    expect(catchUp).toHaveBeenCalledOnce();
  });
  it("sends an authoritative catch-up on every connect and resumes with both epoch and durable chat cursor", () => {
    const catchUp = vi.fn(),
      status = vi.fn();
    manager.setAccount("org:user");
    manager.subscribe({ jobIds: [job] }, { hint: vi.fn(), catchUp, status });
    vi.advanceTimersByTime(0);
    const first = Source.all[0]!,
      id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:7";
    first.emit("connected");
    first.emit("live", { topic: "chat", key: job, version: 42 }, id);
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(status).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(1000);
    expect(Source.all).toHaveLength(2);
    const next = new URL(Source.all[1]!.url, "http://local");
    expect(next.searchParams.get("after")).toBe(id);
    expect(next.searchParams.get("jobs")).toBe(`${job}:42`);
    Source.all[1]!.emit("connected");
    expect(catchUp).toHaveBeenCalledTimes(2);
  });
  it("pauses hidden or retained pages after a grace period and immediately offline, then catches up", () => {
    const catchUp = vi.fn();
    manager.setAccount("org:user");
    manager.subscribe({}, { hint: vi.fn(), catchUp });
    vi.advanceTimersByTime(0);
    Source.all[0]!.emit("connected");
    setAppPageActive(false);
    vi.advanceTimersByTime(14999);
    expect(Source.all[0]!.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(Source.all[0]!.closed).toBe(true);
    setAppPageActive(true);
    vi.advanceTimersByTime(0);
    Source.all[1]!.emit("connected");
    expect(catchUp).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    window.dispatchEvent(new Event("offline"));
    expect(Source.all[1]!.closed).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(Source.all).toHaveLength(2);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(0);
    expect(Source.all).toHaveLength(3);
  });
  it("suppresses hint delivery and catch-up immediately while an inactive page keeps its grace connection", () => {
    const hint = vi.fn(),
      catchUp = vi.fn(),
      status = vi.fn();
    manager.setAccount("org:user");
    manager.subscribe({}, { hint, catchUp, status });
    vi.advanceTimersByTime(0);
    const source = Source.all[0]!;
    source.emit("connected");
    expect(catchUp).toHaveBeenCalledOnce();
    setAppPageActive(false);
    source.emit("live", { topic: "material", version: 20 });
    source.emit("connected");
    expect(source.closed).toBe(false);
    expect(hint).not.toHaveBeenCalled();
    expect(catchUp).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith(false);
    setAppPageActive(true);
    expect(Source.all).toHaveLength(1);
    expect(catchUp).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith(true);
  });
  it("never grants identity from subscriptions and isolates old listeners/cursors on account change", () => {
    const old = vi.fn(),
      next = vi.fn();
    manager.subscribe({}, { hint: old });
    vi.advanceTimersByTime(0);
    expect(Source.all).toHaveLength(0);
    manager.setAccount("org:a");
    vi.advanceTimersByTime(0);
    Source.all[0]!.emit(
      "live",
      { topic: "material", key: "a", version: 3 },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:3",
    );
    expect(old).toHaveBeenCalledOnce();
    manager.setAccount(null);
    manager.subscribe({}, { hint: next });
    manager.setAccount("org:b");
    vi.advanceTimersByTime(0);
    expect(Source.all[1]!.url).not.toContain("after=");
    Source.all[1]!.emit("live", { topic: "material", key: "b", version: 4 });
    expect(old).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
  it("cancels retries after the final subscriber leaves and ignores stale/malformed frames", () => {
    const hint = vi.fn();
    manager.setAccount("org:user");
    const stop = manager.subscribe({}, { hint });
    vi.advanceTimersByTime(0);
    const source = Source.all[0]!;
    source.emit("live", { topic: "private-unrecognized", version: 1 });
    expect(hint).not.toHaveBeenCalled();
    source.onerror?.();
    stop();
    vi.advanceTimersByTime(60000);
    expect(Source.all).toHaveLength(1);
    source.emit("live", { topic: "material", version: 2 });
    expect(hint).not.toHaveBeenCalled();
  });
});
it("opts preference delivery in, preserves chat cursors and fences an old account generation", () => {
  manager.setAccount("org:user");
  const prefs = vi.fn(),
    ordinary = vi.fn();
  manager.subscribe(
    { preferences: true, expectedAccount: "org:user" },
    { hint: prefs },
  );
  manager.subscribe({}, { hint: ordinary });
  vi.advanceTimersByTime(0);
  expect(Source.all[0]!.url).toContain("preferences=1");
  Source.all[0]!.emit("live", {
    topic: "preferences",
    kind: "settings",
    version: 1,
  });
  expect(prefs).toHaveBeenCalledOnce();
  expect(ordinary).not.toHaveBeenCalled();
  manager.setAccount("org:other");
  manager.setAccount("org:user");
  vi.advanceTimersByTime(0);
  expect(Source.all).toHaveLength(1);
  expect(Source.all[0]!.closed).toBe(true);
});
it("binds a new scoped subscriber mounted before the bootstrap account transition", () => {
  manager.setAccount("org:old");
  const hint = vi.fn();
  manager.subscribe(
    { preferences: true, expectedAccount: "org:new" },
    { hint },
  );
  vi.advanceTimersByTime(0);
  expect(Source.all).toHaveLength(0);
  manager.setAccount("org:new");
  vi.advanceTimersByTime(0);
  expect(Source.all).toHaveLength(1);
  Source.all[0]!.emit("live", { topic: "preferences", version: 1 });
  expect(hint).toHaveBeenCalledOnce();
});
