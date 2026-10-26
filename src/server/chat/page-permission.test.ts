// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/conversations/push", () => ({
  enqueueConversationPush: vi.fn(),
}));
import { checkChatAccess } from "./access";
import { checkConversationUser } from "~/server/conversations/service";
import type { RequestUser } from "~/server/utils/get-request-identity";
const job = {
  id: "job",
  organizationId: "org",
  name: "Job",
  createdByUserId: null,
  foremanUserId: null,
};
function user(jobs: boolean, chat: boolean) {
  return {
    id: "member",
    organizationId: "org",
    role: "user",
    organizationAccessStatus: "approved",
    permissionConfig: {
      version: 2,
      permissions: { "tab.dashboard": jobs, "tab.chat": chat },
    },
  } as RequestUser;
}
it("keeps job chat and conversations accessible through Jobs when the main Chat page is disabled", () => {
  expect(checkChatAccess(user(true, false), job).job.id).toBe("job");
  expect(checkConversationUser(user(true, false)).id).toBe("member");
});
it("lets Chat-only members use conversations without granting job access", () => {
  expect(checkConversationUser(user(false, true)).id).toBe("member");
  expect(() => checkChatAccess(user(false, true), job)).toThrow();
  expect(() => checkConversationUser(user(false, false))).toThrow();
});
