// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: null as null | { id: string; organizationAccessStatus: string },
  pull: vi.fn(),
  push: vi.fn(),
}));
vi.mock("~/server/api/trpc", () => ({
  createTRPCContext: async () => ({ user: state.user }),
}));
vi.mock("~/server/replicache/catalogue-sync", () => ({
  handleCatalogueReplicachePull: state.pull,
}));
vi.mock("~/server/replicache/material-list-sync", () => ({
  ReplicacheOwnershipError: class extends Error {},
  handleMaterialListReplicachePull: state.pull,
  handleMaterialListReplicachePush: state.push,
}));
import { POST as cataloguePull } from "~/app/api/replicache/catalogue/pull/route";
import { POST as listPull } from "~/app/api/replicache/material-lists/pull/route";
import { POST as listPush } from "~/app/api/replicache/material-lists/push/route";
import { POST as cataloguePush } from "~/app/api/replicache/catalogue/push/route";
beforeEach(() => {
  state.user = null;
  vi.clearAllMocks();
  state.pull.mockResolvedValue({ patch: [] });
  state.push.mockResolvedValue({});
});
it("checks fresh membership before reusing views or accepting queued edits", async () => {
  for (const route of [cataloguePull, listPull, listPush, cataloguePush]) {
    const request = () =>
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ pullVersion: 1, pushVersion: 1 }),
      });
    state.user = null;
    expect((await route(request())).status).toBe(401);
    state.user = { id: "one", organizationAccessStatus: "approved" };
    expect((await route(request())).status).toBe(200);
    state.user.organizationAccessStatus = "rejected";
    const pulls = state.pull.mock.calls.length,
      pushes = state.push.mock.calls.length;
    expect((await route(request())).status).toBe(403);
    expect(state.pull).toHaveBeenCalledTimes(pulls);
    expect(state.push).toHaveBeenCalledTimes(pushes);
  }
});
