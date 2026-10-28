// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  identity: vi.fn(),
  infer: vi.fn(),
  health: vi.fn(),
  search: vi.fn(),
  navigate: vi.fn(),
  prepare: vi.fn(),
  execute: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: m.identity,
}));
vi.mock("~/server/voice/provider", () => ({
  inferText: m.infer,
  voiceHealth: m.health,
  infer: vi.fn(),
}));
vi.mock("~/server/voice/tools", () => ({
  demand: vi.fn(),
  search: m.search,
  inspect: vi.fn(),
  navigate: m.navigate,
  prepareChange: m.prepare,
  executeChange: m.execute,
}));
vi.mock("node:fs/promises", () => ({ appendFile: m.audit, mkdir: vi.fn() }));
import { POST } from "./route";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
async function call(body: unknown, origin = "https://app.test") {
  const r = await POST(
    new Request("http://localhost:3000/api/voice", {
      method: "POST",
      headers: {
        origin,
        host: "app.test",
        "x-forwarded-proto": "https",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: r.status,
    ...((await r.json()) as {
      sessionId: string;
      error: string;
      text: string;
      proposal: { id: string };
      saved: boolean;
      href: string;
    }),
  };
}
async function start() {
  return (await call({ action: "start" })).sessionId;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.identity.mockResolvedValue({
    user: {
      id: "user",
      organizationId: "org",
      organizationAccessStatus: "approved",
    },
  });
  m.health.mockResolvedValue(true);
  m.prepare.mockResolvedValue({
    summary: "Create job Test",
    fingerprint: "fp",
  });
  m.execute.mockResolvedValue("Saved.");
  m.audit.mockResolvedValue(undefined);
});
it("accepts the reverse proxy origin but rejects cross-site requests", async () => {
  expect((await call({ action: "start" })).sessionId).toBeTruthy();
  expect((await call({ action: "start" }, "https://evil.test")).status).toBe(
    400,
  );
});
it("blocks unauthenticated and simulation sessions", async () => {
  m.identity.mockResolvedValue({ user: null });
  expect((await call({ action: "start" })).status).toBe(400);
  m.identity.mockResolvedValue({
    user: {
      id: "user",
      organizationId: "org",
      organizationAccessStatus: "approved",
    },
    simulation: {},
  });
  expect((await call({ action: "start" })).error).toContain("simulation");
});
it("refuses sending/deleting before reaching inference or action execution", async () => {
  const sessionId = await start();
  for (const text of ["Send order 175 to Next", "Delete the job"]) {
    const r = await call({ action: "turn", sessionId, text, page: "/jobs" });
    expect(r.text).toBeTruthy();
    expect(r.proposal).toBeUndefined();
  }
  expect(m.infer).not.toHaveBeenCalled();
  expect(m.execute).not.toHaveBeenCalled();
});
it("keeps write proposals separate from confirmation and rejects replay", async () => {
  const sessionId = await start();
  m.infer.mockResolvedValue(
    '{"tool":"change","action":"createJob","name":"Test"}',
  );
  const r = await call({
    action: "turn",
    sessionId,
    text: "Create job Test",
    page: "/jobs",
  });
  expect(r.proposal).toBeTruthy();
  expect(m.execute).not.toHaveBeenCalled();
  expect(
    (await call({ action: "confirm", sessionId, proposalId: r.proposal.id }))
      .saved,
  ).toBe(true);
  expect(
    (await call({ action: "confirm", sessionId, proposalId: r.proposal.id }))
      .status,
  ).toBe(400);
  expect(m.execute).toHaveBeenCalledOnce();
});
it("requires clarification before navigating to one of two jobs", async () => {
  const sessionId = await start();
  m.infer
    .mockResolvedValueOnce('{"tool":"search","kind":"jobs","query":"Alma"}')
    .mockResolvedValueOnce(
      JSON.stringify({ tool: "navigate", destination: "drawings", jobId: b }),
    );
  m.search.mockResolvedValue([
    { id: a, name: "Alma Phase 1" },
    { id: b, name: "Alma Phase 2" },
  ]);
  let r = await call({
    action: "turn",
    sessionId,
    text: "Open drawings for Alma",
    page: "/jobs",
  });
  expect(r.text).toContain("Which job");
  expect(m.navigate).not.toHaveBeenCalled();
  m.infer.mockResolvedValue('{"tool":"navigate","destination":"drawings"}');
  m.navigate.mockResolvedValue("/jobs/" + b + "/drawings");
  r = await call({
    action: "turn",
    sessionId,
    text: "The second one",
    page: "/jobs",
  });
  expect(r.href).toContain(b);
});
it("does not accept client-supplied mutation payloads on confirm", async () => {
  const sessionId = await start();
  expect(
    (
      await call({
        action: "confirm",
        sessionId,
        proposalId: "a".repeat(48),
        change: { action: "sendOrder" },
      })
    ).status,
  ).toBe(400);
  expect(m.execute).not.toHaveBeenCalled();
});
