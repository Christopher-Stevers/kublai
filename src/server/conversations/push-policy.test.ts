// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  eligibleForConversationPush,
  conversationPushPayload,
} from "./push-policy";
const candidate = {
  user: {
    id: "recipient",
    organizationId: "org",
    organizationAccessStatus: "approved",
    role: "worker",
  },
  organizationId: "org",
  senderId: "sender",
  sequence: 9,
  subscriptionUserId: "recipient",
  member: { lastReadSequence: 8 },
};
describe("private chat push eligibility", () => {
  it("requires an unread message and approved conversation membership on the subscribed account", () => {
    expect(eligibleForConversationPush(candidate)).toBe(true);
    for (const change of [
      { member: null },
      { member: { lastReadSequence: 9 } },
      { senderId: "recipient" },
      { subscriptionUserId: "other" },
      { organizationId: "other" },
    ])
      expect(eligibleForConversationPush({ ...candidate, ...change })).toBe(
        false,
      );
    for (const change of [
      { organizationAccessStatus: "pending" },
      { organizationId: null },
      {
        permissionConfig: {
          version: 2,
          permissions: { "tab.dashboard": false },
        },
      },
    ])
      expect(
        eligibleForConversationPush({
          ...candidate,
          user: { ...candidate.user, ...change },
        }),
      ).toBe(false);
  });
  it("deep links to the conversation and contains no private names or message contents", () => {
    const payload = JSON.parse(
      conversationPushPayload(
        "11111111-1111-4111-8111-111111111111",
        "recipient",
      ),
    ) as { account: string; type: string; url: string };
    expect(payload).toMatchObject({
      type: "conversation-chat",
      url: "/dashboard/chat?conversation=11111111-1111-4111-8111-111111111111",
    });
    expect(payload.account).toMatch(/^[a-f0-9]{64}$/);
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("title");
  });
});
