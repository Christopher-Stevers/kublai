import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { userCan } from "~/server/auth/permissions";

export const MAX_PUSH_ATTEMPTS = 6;
export const PUSH_TTL_SECONDS = 86400;

/** Only browser-operated HTTPS push endpoints. No arbitrary URLs, redirects or ports. */
export function isAllowedPushEndpoint(value: string) {
  try {
    if (value.length > 4096) return false;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return false;
    const host = url.hostname;
    return (
      host === "fcm.googleapis.com" ||
      host === "web.push.apple.com" ||
      host === "updates.push.services.mozilla.com" ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

/** Resolve and pin a public address when sending, rather than trusting endpoint syntax alone. */
export function isPublicPushAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) &&
      !(a === 192 && b === 0) &&
      !(a === 192 && b === 0 && c === 2) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113)
    );
  }
  // Global unicast only; this also rejects IPv4-mapped loopback/private addresses.
  return (
    family === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:0*db8:/i.test(address) &&
    !/^2001:0*:/i.test(address) &&
    !/^2002:/i.test(address)
  );
}

export type PushRecipient = {
  id: string;
  organizationId: string | null;
  organizationAccessStatus: string | null;
  role?: string | null;
  permissionConfig?: unknown;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: Date | string | null;
  currentJobId?: string | null;
};
export function eligibleForChatPush(input: {
  user: PushRecipient;
  organizationId: string;
  jobId: string;
  senderId: string;
  sequence: number;
  subscriptionUserId: string;
  createdById: string | null;
  foremanId: string | null;
  member: { muted: boolean; lastReadSequence: number } | null;
}) {
  const { user, member } = input;
  return (
    user.id === input.subscriptionUserId &&
    user.id !== input.senderId &&
    user.organizationId === input.organizationId &&
    user.organizationAccessStatus === "approved" &&
    userCan(user, "tab.dashboard") &&
    (member !== null ||
      user.id === input.createdById ||
      user.id === input.foremanId ||
      user.currentJobId === input.jobId) &&
    !member?.muted &&
    (member?.lastReadSequence ?? 0) < input.sequence
  );
}

export function pushFailure(
  error: unknown,
  attempt: number,
): { permanent: boolean; outcome: string; retryMs: number } {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  const gone = status === 404 || status === 410;
  const permanent =
    gone ||
    (status >= 400 && status < 500 && ![408, 429].includes(status)) ||
    attempt >= MAX_PUSH_ATTEMPTS;
  return {
    permanent,
    outcome: gone ? "expired" : permanent ? "failed" : "retry",
    retryMs: Math.min(1800000, 30000 * 2 ** Math.max(0, attempt - 1)),
  };
}

/** A trimmed name, or the fallback when it is missing or blank. */
export function nameOr(value: string | null | undefined, fallback: string) {
  const name = value?.trim();
  if (name) return name;
  return fallback;
}

/** One short line of message text for a notification, like a messaging app. */
export function messagePreview(body: string | null | undefined) {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Sent an attachment";
  return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
}

export type ChatPushPreview = {
  chatName: string | null;
  senderName: string | null;
  body: string | null;
};

export function chatPushPayload(
  jobId: string,
  recipientId: string,
  preview?: ChatPushPreview,
) {
  return JSON.stringify({
    type: "job-chat",
    url: `/dashboard/jobs/${jobId}/chat`,
    account: createHash("sha256").update(recipientId).digest("hex"),
    tag: `job-chat-${jobId}`,
    ...(preview && {
      title: nameOr(preview.chatName, "Job chat"),
      body: `${nameOr(preview.senderName, "Someone")}: ${messagePreview(preview.body)}`,
    }),
  });
}
