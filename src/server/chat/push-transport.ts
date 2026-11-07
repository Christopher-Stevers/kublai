import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import webpush from "web-push";
import { withPushBadge } from "~/server/notifications/push-badge";
import {
  isAllowedPushEndpoint,
  isPublicPushAddress,
  PUSH_TTL_SECONDS,
} from "./push-policy";
export async function sendPushPayload(
  delivery: { endpoint: string; p256dh: string; auth: string; recipientId?: string },
  configuration: { publicKey: string; privateKey: string; subject: string },
  payload: string,
) {
  if (!isAllowedPushEndpoint(delivery.endpoint))
    throw Object.assign(new Error("Invalid push provider"), {
      statusCode: 400,
    });
  payload = await withPushBadge(payload, delivery.recipientId);
  const hostname = new URL(delivery.endpoint).hostname;
  let lookupTimer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => {
      lookupTimer = setTimeout(
        () => reject(new Error("Push DNS timeout")),
        3000,
      );
    }),
  ]).finally(() => clearTimeout(lookupTimer));
  if (
    !addresses.length ||
    addresses.some((address) => !isPublicPushAddress(address.address))
  ) {
    throw Object.assign(new Error("Invalid push provider address"), {
      statusCode: 400,
    });
  }
  // Pin the validated DNS answer. Do not resolve again between validation and HTTPS.
  const address = addresses[0]!;
  const agent = new Agent({
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, address.address, address.family);
    },
  });
  const deadline = setTimeout(() => agent.destroy(), 12000);
  try {
    await webpush.sendNotification(
      {
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      },
      payload,
      {
        vapidDetails: configuration,
        TTL: PUSH_TTL_SECONDS,
        timeout: 8000,
        urgency: "normal",
        agent,
      },
    );
  } finally {
    clearTimeout(deadline);
    agent.destroy();
  }
}
