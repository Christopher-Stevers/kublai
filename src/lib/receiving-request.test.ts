import { afterEach, expect, it, vi } from "vitest";
import { receivingRequest, receivingResponse } from "./receiving-request";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("retries a gateway interruption with exactly the same mutation", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("<!DOCTYPE html>Bad Gateway", { status: 502 }))
    .mockResolvedValueOnce(Response.json({ success: true }));
  vi.stubGlobal("fetch", fetcher);
  const init = { method: "POST", body: JSON.stringify({ action: "createPart", requestId: "same-id" }) };
  const pending = receivingRequest("/queue", init);
  await vi.runAllTimersAsync();
  expect(await receivingResponse(await pending)).toEqual({ success: true });
  expect(fetcher.mock.calls).toEqual([["/queue", init], ["/queue", init]]);
});
it("does not retry a business validation error", async () => {
  const response = Response.json({ error: "Choose a catalogue" }, { status: 400 });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  expect(await receivingRequest("/queue", { method: "POST" })).toBe(response);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports HTML responses without exposing a JSON syntax error", async () => {
  await expect(receivingResponse(new Response("<!DOCTYPE html>Unavailable", { status: 503 })))
    .rejects.toThrow("Use Retry request");
});
it("explains an expired sign-in", async () => {
  await expect(receivingResponse(Response.json({ error: { code: "SIGNED_OUT" } }, { status: 401 })))
    .rejects.toThrow("Sign in again");
});
