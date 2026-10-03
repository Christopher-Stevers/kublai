// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  chatPushPayload,
  eligibleForChatPush,
  isAllowedPushEndpoint,
  isPublicPushAddress,
  pushFailure,
} from "./push-policy";

const recipient = {
  user: {
    id: "worker",
    organizationId: "org",
    organizationAccessStatus: "approved",
    currentJobId: "job",
    role: "worker",
  },
  organizationId: "org",
  jobId: "job",
  senderId: "sender",
  sequence: 3,
  subscriptionUserId: "worker",
  createdById: null,
  foremanId: null,
  member: null,
};
describe("push recipient eligibility", () => {
  it("notifies a current job user, creator, foreman or explicit follower", () => {
    expect(eligibleForChatPush(recipient)).toBe(true);
    const noCurrent = {
      ...recipient,
      user: { ...recipient.user, currentJobId: null },
    };
    expect(eligibleForChatPush(noCurrent)).toBe(false);
    expect(eligibleForChatPush({ ...noCurrent, createdById: "worker" })).toBe(
      true,
    );
    expect(eligibleForChatPush({ ...noCurrent, foremanId: "worker" })).toBe(
      true,
    );
    expect(
      eligibleForChatPush({
        ...noCurrent,
        member: { muted: false, lastReadSequence: 0 },
      }),
    ).toBe(true);
  });
  it("never notifies senders, reassigned devices, denied members or another organization", () => {
    expect(eligibleForChatPush({ ...recipient, senderId: "worker" })).toBe(
      false,
    );
    expect(
      eligibleForChatPush({ ...recipient, subscriptionUserId: "different" }),
    ).toBe(false);
    for (const status of [null, "pending", "denied"])
      expect(
        eligibleForChatPush({
          ...recipient,
          user: { ...recipient.user, organizationAccessStatus: status },
        }),
      ).toBe(false);
    expect(eligibleForChatPush({ ...recipient, organizationId: "other" })).toBe(
      false,
    );
    expect(
      eligibleForChatPush({
        ...recipient,
        user: {
          ...recipient.user,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        },
      }),
    ).toBe(false);
  });
  it("honors mute and read position even for implicit participants", () => {
    expect(
      eligibleForChatPush({
        ...recipient,
        member: { muted: true, lastReadSequence: 0 },
      }),
    ).toBe(false);
    expect(
      eligibleForChatPush({
        ...recipient,
        member: { muted: false, lastReadSequence: 3 },
      }),
    ).toBe(false);
    expect(
      eligibleForChatPush({
        ...recipient,
        member: { muted: false, lastReadSequence: 4 },
      }),
    ).toBe(false);
    expect(
      eligibleForChatPush({
        ...recipient,
        member: { muted: false, lastReadSequence: 2 },
      }),
    ).toBe(true);
  });
});
describe("push transport boundaries", () => {
  it("only accepts browser-owned HTTPS providers", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/Q/x",
      "https://wns2-bl2p.notify.windows.com/w/?token=x",
    ])
      expect(isAllowedPushEndpoint(url), url).toBe(true);
    for (const url of [
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://fcm.googleapis.com:9443/x",
      "https://fcm.googleapis.com@evil.test/x",
      "https://user@fcm.googleapis.com/x",
      "https://web.push.apple.com/x#fragment",
      "bad",
    ])
      expect(isAllowedPushEndpoint(url), url).toBe(false);
  });
  it("blocks private, loopback, link local, reserved and mapped addresses before HTTP", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "2002:7f00:1::",
      "bad",
    ])
      expect(isPublicPushAddress(address), address).toBe(false);
    expect(isPublicPushAddress("142.250.1.1")).toBe(true);
    expect(isPublicPushAddress("2607:f8b0:4000::1")).toBe(true);
  });
  it("expires gone endpoints and retries transport/rate limits with bounded backoff", () => {
    expect(pushFailure({ statusCode: 410 }, 1).outcome).toBe("expired");
    expect(pushFailure({ statusCode: 404 }, 1).outcome).toBe("expired");
    expect(pushFailure({ statusCode: 403 }, 1).permanent).toBe(true);
    expect(pushFailure({ statusCode: 429 }, 2)).toEqual({
      permanent: false,
      outcome: "retry",
      retryMs: 60000,
    });
    expect(pushFailure(new Error("timeout"), 6).permanent).toBe(true);
    expect(pushFailure({ statusCode: 503 }, 1).permanent).toBe(false);
  });
  it("keeps message bodies, sender names and job names out of lockscreen payloads", () => {
    const payload: Record<string, unknown> = JSON.parse(
      chatPushPayload("job", "recipient"),
    ) as Record<string, unknown>;
    expect(payload.url).toBe("/dashboard/jobs/job/chat");
    expect(payload.account).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(payload).sort()).toEqual([
      "account",
      "tag",
      "type",
      "url",
    ]);
    expect(JSON.stringify(payload)).not.toContain("recipient");
  });
});
