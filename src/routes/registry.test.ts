import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  query: vi.fn(),
  readJob: vi.fn(),
  code: vi.fn(),
}));
vi.mock("~/lib/replicache-material-list", () => ({
  tryGetMaterialListReplicache: () => ({ query: calls.query }),
}));
vi.mock("~/hooks/use-replicache-jobs", () => ({
  readJobDetail: calls.readJob,
}));
vi.mock("~/components/jobs/JobWorkspaceOptions", () => {
  calls.code();
  return {};
});
vi.mock("~/components/materialLists/MaterialListScreen", () => ({}));
vi.mock("~/components/jobs/JobChatView", () => ({}));
import { journeyRegistry, prepareJourney } from "./registry";
beforeEach(() => {
  calls.query.mockReset();
  calls.readJob.mockReset();
  calls.query.mockImplementation(async (fn) => fn({}));
});
describe("shared journey preparation", () => {
  it("maps all eight actual lab starting screens", () => {
    const parameters = {
      jobId: "job id",
      materialListId: "list id",
      orderId: "order id",
    };
    expect(Object.keys(journeyRegistry)).toEqual([
      "coldstart",
      "openjob",
      "switchjobtabs",
      "openmateriallist",
      "changeqty",
      "receiveline",
      "opensheetpinch",
      "sendchat",
    ]);
    expect(journeyRegistry.openjob.sourceHref()).toBe("/jobs");
    expect(journeyRegistry.switchjobtabs.sourceHref(parameters)).toBe(
      "/jobs/job%20id",
    );
    expect(journeyRegistry.openmateriallist.sourceHref(parameters)).toBe(
      "/jobs/job%20id/material-lists",
    );
    expect(journeyRegistry.receiveline.sourceHref(parameters)).toBe(
      "/jobs/material-lists/list%20id?orderId=order%20id",
    );
  });
  it("uses the existing lightweight local job reader with no item scan", async () => {
    await prepareJourney(
      "openjob",
      { jobId: "job" },
      new AbortController().signal,
    );
    expect(calls.query).toHaveBeenCalledOnce();
    expect(calls.readJob).toHaveBeenCalledWith({}, "job", false);
  });
  it("aborting before or during module preparation skips local data work", async () => {
    const first = new AbortController();
    first.abort();
    await prepareJourney("openjob", { jobId: "job" }, first.signal);
    expect(calls.query).not.toHaveBeenCalled();
    const second = new AbortController(),
      pending = prepareJourney("openjob", { jobId: "job" }, second.signal);
    second.abort();
    await pending;
    expect(calls.query).not.toHaveBeenCalled();
  });
  it("preparing a chat screen never sends a message or fetches private remote content", async () => {
    await prepareJourney(
      "sendchat",
      { jobId: "job" },
      new AbortController().signal,
    );
    expect(calls.query).not.toHaveBeenCalled();
  });
});
