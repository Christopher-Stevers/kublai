// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({
  context: vi.fn(),
  identity: vi.fn(),
  chatAccess: vi.fn(),
  snapshot: vi.fn(),
  subscribe: vi.fn(),
  off: vi.fn(),
}));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: spies.context }));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: spies.identity,
}));
vi.mock("~/server/chat/access", () => ({ assertChatAccess: spies.chatAccess }));
vi.mock("~/server/chat/events", () => ({
  subscribeChatEvents: spies.subscribe,
}));
vi.mock("~/server/conversations/events", () => ({
  conversationEventSnapshot: spies.snapshot,
  subscribeConversationEvents: spies.subscribe,
}));
vi.mock("~/server/material-list-events", () => ({
  subscribeToMaterialListEvents: spies.subscribe,
  subscribeToOrganizationMaterialListEvents: spies.subscribe,
  subscribeToOrganizationReplicachePokes: spies.subscribe,
  subscribeToOrganizationCatalogueEvents: spies.subscribe,
}));
vi.mock("~/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "list" }],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  },
}));
import { GET as material } from "~/app/api/material-lists/events/route";
import { GET as list } from "~/app/api/material-lists/[id]/events/route";
import { GET as conversations } from "~/app/api/conversations/events/route";
import { GET as chat } from "~/app/api/job-chat/events/route";
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sources = [
  ["material", material],
  [
    "list",
    (request: Request) => list(request, { params: Promise.resolve({ id }) }),
  ],
  ["conversations", conversations],
  ["chat", chat],
] as const;
beforeEach(() => {
  vi.useFakeTimers();
  spies.context
    .mockReset()
    .mockResolvedValue({ user: { id: "user", organizationId: "org" } });
  spies.identity
    .mockReset()
    .mockResolvedValue({ userId: "user", user: { organizationId: "org" } });
  spies.chatAccess.mockReset().mockResolvedValue({});
  spies.snapshot.mockReset().mockResolvedValue(new Map());
  spies.off.mockReset();
  spies.subscribe.mockReset().mockImplementation(() => spies.off);
});
afterEach(() => vi.useRealTimers());
describe("legacy source cleanup used by the multiplexer", () => {
  for (const [name, get] of sources) {
    it(`${name} never allocates subscriptions/timers for an already-aborted request`, async () => {
      const controller = new AbortController();
      controller.abort();
      const response = await get(
        new Request(`http://local/api/source?jobId=${id}`, {
          signal: controller.signal,
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.body!.getReader().read()).done).toBe(true);
      expect(spies.subscribe).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
    it(`${name} releases subscriptions/timers and connection slots on cancel`, async () => {
      for (let run = 0; run < 6; run++) {
        const response = await get(
          new Request(`http://local/api/source?jobId=${id}`),
        );
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
      }
      expect(spies.off).toHaveBeenCalled();
    });
  }
});
