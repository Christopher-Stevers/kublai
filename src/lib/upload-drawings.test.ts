import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadDrawings, UploadResponseError } from "./upload-drawings";
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const gateway = () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
const file = () => new File(["%PDF-test"], "test.pdf", { type: "application/pdf", lastModified: 123 });
beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    get length() { return values.size; },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("waits through a 90-second restart before starting the upload", async () => {
  const started = Date.now();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (Date.now() - started < 90_000) return gateway();
    if (!url.includes("?")) return reply({ uploadId: "upload-1" });
    if (init?.method === "POST") return reply({ received: 9 });
    return reply({ status: "ready" });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = uploadDrawings("job", file(), { drawingSetId: "set" });
  await vi.advanceTimersByTimeAsync(100_000);
  await expect(result).resolves.toEqual([]);
  expect(fetcher.mock.calls.filter(([url]) => url.includes("offset=0"))).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});
it("replays the same chunk after an outage without starting a second upload", async () => {
  const started = Date.now();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes("?")) return reply({ uploadId: "upload-2" });
    if (url.includes("offset=") && Date.now() - started < 90_000) return gateway();
    if (init?.method === "POST") return reply({ received: 9 });
    return reply({ status: "ready" });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = uploadDrawings("job", file(), { drawingSetId: "set" });
  await vi.advanceTimersByTimeAsync(100_000);
  await expect(result).resolves.toEqual([]);
  expect(fetcher.mock.calls.filter(([url]) => !url.includes("?"))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => url.includes("offset=")).every(([url]) => url.includes("uploadId=upload-2&offset=0"))).toBe(true);
});
it("stops on permission errors without retrying", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "Permission required" }), {status:403,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadDrawings("job", file(), { drawingSetId: "set" })).rejects.toThrow("Permission required");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops after three minutes and retains the upload id for a later resume", async () => {
  const fetcher = vi.fn(async (url: string) => !url.includes("?") ? reply({uploadId:"resume-me"}) : gateway());
  vi.stubGlobal("fetch", fetcher);
  const result = uploadDrawings("job", file(), { drawingSetId: "set" });
  const outcome = result.catch(error => error);
  await vi.advanceTimersByTimeAsync(181_000);
  expect(await outcome).toBeInstanceOf(UploadResponseError);
  expect(localStorage.getItem("drawing-upload:job:set-set:test.pdf:9:123")).toBe("resume-me");
  expect(fetcher.mock.calls.filter(([url]) => !url.includes("?"))).toHaveLength(1);
});
