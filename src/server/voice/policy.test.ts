import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTool, mutationSchema, prohibitedRequest } from "./policy";
import {
  startSession,
  getSession,
  endSession,
  propose,
  takePending,
} from "./sessions";
import {
  quantityQuestion,
  newEvidence,
  rememberCandidates,
  selectFromAnswer,
  clarifyBeforeAction,
  completeNavigation,
} from "./clarification";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.useRealTimers());
describe("voice capabilities are an allowlist", () => {
  it.each([
    "deleteJob",
    "removeItem",
    "sendOrder",
    "markOrderSent",
    "clearList",
    "runSql",
    "fetch",
    "changePermissions",
  ])("rejects %s", (action) => {
    expect(() =>
      parseTool(
        JSON.stringify({ tool: "change", change: { action, jobId: a } }),
      ),
    ).toThrow();
  });
  it("rejects indirect deletion and extra mutation fields", () => {
    expect(() =>
      mutationSchema.parse({
        action: "setQuantity",
        materialListId: a,
        itemId: b,
        quantity: 0,
      }),
    ).toThrow();
    expect(() =>
      mutationSchema.parse({
        action: "renameJob",
        jobId: a,
        name: "Name",
        deleted: true,
      }),
    ).toThrow();
    expect(() =>
      parseTool('{"tool":"navigate","destination":"https://evil.test"}'),
    ).toThrow();
  });
  it("normalizes the observed native formats without adding capabilities", () => {
    expect(
      parseTool(
        "<tool_call><function=search><parameter=kind>jobs</parameter><parameter=query>Alma</parameter></function></tool_call>",
      ),
    ).toEqual({ tool: "search", kind: "jobs", query: "Alma" });
    expect(
      parseTool('{"tool":"change","action":"createJob","name":"New"}'),
    ).toEqual({ tool: "change", change: { action: "createJob", name: "New" } });
    expect(() =>
      parseTool(
        "<tool_call><function=deleteJob><parameter=id>" +
          a +
          "</parameter></function></tool_call>",
      ),
    ).toThrow();
    expect(() =>
      parseTool(
        "<tool_call><function=search><parameter=kind>jobs</parameter><parameter=kind>parts</parameter></function></tool_call>",
      ),
    ).toThrow();
  });
  it("asks natural follow-up questions without treating prose as an action", () => {
    expect(parseTool("Which size do you need?")).toEqual({
      tool: "reply",
      text: "Which size do you need?",
    });
    expect(parseTool("What is the job ID?").tool).toBe("reply");
    expect(() => parseTool("I deleted everything.")).toThrow();
  });
  it("refuses explicit prohibited requests before model inference", () => {
    expect(prohibitedRequest("Please send order 178 to Next")).toContain(
      "manually",
    );
    expect(prohibitedRequest("Remove every item")).toContain("can’t");
    expect(prohibitedRequest("Open the orders page")).toBeUndefined();
  });
});
describe("voice sessions and physical confirmation", () => {
  it("binds sessions to user and company", () => {
    const id = startSession("test", "company");
    expect(() => getSession(id, "other", "company")).toThrow();
    expect(() => getSession(id, "test", "other")).toThrow();
    expect(getSession(id, "test", "company").pending).toBeUndefined();
    endSession(id, "test", "company");
    expect(() => getSession(id, "test", "company")).toThrow();
  });
  it("requires exact, fresh, one-use preview token", () => {
    const id = startSession("test2", "company"),
      s = getSession(id, "test2", "company");
    const p = propose(
      s,
      { action: "createJob", name: "X" },
      "Create X",
      "fingerprint",
    );
    expect(() => takePending(s, "yes")).toThrow();
    expect(takePending(s, p.id).change.action).toBe("createJob");
    expect(() => takePending(s, p.id)).toThrow();
    const next = propose(
      s,
      { action: "createJob", name: "Y" },
      "Create Y",
      "fingerprint",
    );
    vi.useFakeTimers();
    vi.advanceTimersByTime(121000);
    expect(() => takePending(s, next.id)).toThrow();
  });
  it("expires and replaces sessions", () => {
    const id = startSession("test3", "company");
    startSession("test3", "company");
    expect(() => getSession(id, "test3", "company")).toThrow();
    const next = startSession("test3", "company");
    vi.useFakeTimers();
    vi.advanceTimersByTime(31 * 60000);
    expect(() => getSession(next, "test3", "company")).toThrow();
  });
});
describe("uncertain intentions require a question", () => {
  it("will not choose between two jobs and accepts a spoken follow-up", () => {
    const e = newEvidence();
    rememberCandidates(
      e,
      "jobs",
      [
        { id: a, name: "Alma Phase 1" },
        { id: b, name: "Alma Phase 2" },
      ],
      "Open Alma",
    );
    expect(
      clarifyBeforeAction(
        e,
        { tool: "navigate", destination: "drawings", jobId: b },
        "/jobs",
      ),
    ).toContain("Which job");
    selectFromAnswer(e, "the second one");
    expect(
      completeNavigation(
        e,
        { tool: "navigate", destination: "drawings" },
        "/jobs",
      ),
    ).toEqual({ tool: "navigate", destination: "drawings", jobId: b });
    expect(
      clarifyBeforeAction(
        e,
        { tool: "navigate", destination: "drawings", jobId: b },
        "/jobs",
      ),
    ).toBeUndefined();
  });
  it("never accepts an invented target ID", () => {
    expect(
      clarifyBeforeAction(
        newEvidence(),
        {
          tool: "change",
          change: { action: "renameJob", jobId: a, name: "Changed" },
        },
        "/jobs",
      ),
    ).toContain("look it up");
  });
  it("does not resolve two records with identical labels by label alone", () => {
    const e = newEvidence();
    rememberCandidates(
      e,
      "parts",
      [
        { id: a, name: "Cap" },
        { id: b, name: "Cap" },
      ],
      "Add Cap",
    );
    expect(e.selected).toEqual([]);
  });
  it("resolves an unambiguous named job and respects page context", () => {
    const e = newEvidence();
    rememberCandidates(
      e,
      "jobs",
      [
        { id: a, name: "Alma Phase 1" },
        { id: b, name: "Alma Phase 2" },
      ],
      "Open Alma Phase 2",
    );
    expect(
      completeNavigation(
        e,
        { tool: "navigate", destination: "rooms" },
        "/jobs",
      ),
    ).toMatchObject({ jobId: b });
    expect(
      completeNavigation(
        newEvidence(),
        { tool: "navigate", destination: "rooms" },
        "/jobs/" + a,
      ),
    ).toMatchObject({ jobId: a });
  });
});

it("asks for missing quantities without confusing a part size with an amount", () => {
  const tool = {
    tool: "change" as const,
    change: {
      action: "addItem" as const,
      materialListId: a,
      partId: b,
      quantity: 2,
    },
  };
  expect(quantityQuestion(tool, ["Add two inch elbows"])).toContain(
    "What quantity",
  );
  expect(quantityQuestion(tool, ["Add two elbows"])).toBeUndefined();
  expect(
    quantityQuestion({ ...tool, change: { ...tool.change, quantity: 25 } }, [
      "Add twenty five two inch elbows",
    ]),
  ).toBeUndefined();
});

it("does not fall back to the current job when a named job is ambiguous", () => {
  const e = newEvidence();
  rememberCandidates(
    e,
    "jobs",
    [
      { id: a, name: "Alma 1" },
      { id: b, name: "Alma 2" },
    ],
    "Open Alma",
  );
  expect(
    completeNavigation(
      e,
      { tool: "navigate", destination: "drawings" },
      "/jobs/" + a,
    ),
  ).not.toHaveProperty("jobId");
  expect(
    completeNavigation(
      e,
      { tool: "navigate", destination: "drawings" },
      "/jobs/" + a,
      "Open this job's drawings",
    ),
  ).toMatchObject({ jobId: a });
});
