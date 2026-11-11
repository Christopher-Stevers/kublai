// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  rows: [] as unknown[],
  notify: vi.fn(),
  transactions: 0,
}));
vi.mock("./overview-hints", () => ({ notifyChatOverviewChange: mock.notify }));
vi.mock("./push", () => ({ enqueueChatPush: vi.fn() }));
vi.mock("~/server/db", () => {
  const chain = () =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "then"
            ? (yes: (v: unknown) => unknown, no: (v: unknown) => unknown) => {
                const value = mock.rows.shift();
                return value instanceof Error
                  ? Promise.reject(value).then(yes, no)
                  : Promise.resolve(value).then(yes, no);
              }
            : () => chain(),
      },
    );
  const tx = {
    insert: chain,
    select: chain,
    update: chain,
    execute: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      ...tx,
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        mock.transactions++;
        return callback(tx);
      },
    },
  };
});
import { joinChat, markChatRead, setChatNotifications } from "./service";
import type { ChatAccess } from "./access";
const access = {
  job: { id: "job", organizationId: "org", name: "Job" },
  user: { id: "actor" },
  canModerate: false,
} as ChatAccess;
beforeEach(() => {
  mock.rows = [];
  mock.notify.mockReset();
  mock.transactions = 0;
});
it.each([true, false])(
  "join invalidates only actual insertion (%s)",
  async (changed) => {
    mock.rows = [
      changed ? [{ userId: "actor" }] : [],
      [],
      [{ value: 0 }],
      [{ sequence: 0 }],
    ];
    await joinChat(access);
    expect(mock.notify).toHaveBeenCalledTimes(changed ? 1 : 0);
  },
);
it.each([
  [false, 5, 5, 0],
  [false, 5, 8, 1],
  [true, 0, 0, 1],
])(
  "read cursor invalidates only advance or new membership",
  async (joined, previous, next, count) => {
    mock.rows = [
      [{ sequence: 20 }],
      joined ? [{ userId: "actor" }] : [],
      [{ lastReadSequence: previous }],
      [{ lastReadSequence: next }],
    ];
    await expect(markChatRead(access, next)).resolves.toEqual({
      lastReadSequence: next,
    });
    expect(mock.notify).toHaveBeenCalledTimes(count);
  },
);
it.each([true, false])(
  "notification change uses transaction and returning-row no-op detection (%s)",
  async (changed) => {
    mock.rows = [changed ? [{ userId: "actor" }] : []];
    await expect(setChatNotifications(access, true)).resolves.toEqual({
      muted: true,
    });
    expect(mock.transactions).toBe(1);
    expect(mock.notify).toHaveBeenCalledTimes(changed ? 1 : 0);
  },
);
it("business write failure does not publish an invalidation", async () => {
  mock.rows = [new Error("write failed")];
  await expect(setChatNotifications(access, true)).rejects.toThrow(
    "write failed",
  );
  expect(mock.notify).not.toHaveBeenCalled();
});
