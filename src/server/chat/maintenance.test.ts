// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ job: vi.fn(), conversation: vi.fn() }));
vi.mock("./attachments", () => ({ cleanupExpiredChatAttachments: mock.job }));
vi.mock("../conversations/attachments", () => ({
  cleanupExpiredConversationAttachments: mock.conversation,
}));
import { cleanupChatAttachments } from "./maintenance";
beforeEach(() => {
  vi.clearAllMocks();
  mock.job.mockResolvedValue(1);
  mock.conversation.mockResolvedValue(2);
});
it("maintains both job and direct/group attachments", async () => {
  await cleanupChatAttachments();
  expect(mock.job).toHaveBeenCalledOnce();
  expect(mock.conversation).toHaveBeenCalledOnce();
});
it("still cleans conversations when job cleanup fails, without hiding the failure", async () => {
  mock.job.mockRejectedValue(new Error("Retry job cleanup"));
  await expect(cleanupChatAttachments()).rejects.toThrow(
    "maintenance will retry",
  );
  expect(mock.conversation).toHaveBeenCalledOnce();
});
