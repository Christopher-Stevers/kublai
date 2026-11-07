# Job chat notifications

Web Push is an optional device opt-in. Chat messages remain saved even when push
providers, device permissions, or network delivery fail. No paid notification
service is required by this implementation.

## Deployment

Apply migrations `0042_job_chat.sql` and `0043_job_chat_push.sql` using
`scripts/migrate-job-chat.ts` before deploying the application. Configure the
following server-only environment variables and restart the Node service:

- `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY`: generate one persistent pair
  with `web-push.generateVAPIDKeys()`. Keep the private key out of Git and logs.
  Preserve this pair across deployments; replacing it requires devices to opt in again.
- `WEB_PUSH_SUBJECT`: `https://foremanhq.stellarator.work` (the public deployment
  origin), or a valid contact `mailto:` address.

The public key is returned to authenticated eligible users by `push.identity`.
The private key is never returned. A missing or malformed configuration produces
an honest "not configured" state. It does not claim notifications are enabled.
`src/instrumentation.ts` starts the durable outbox drain in the Node runtime on
startup and every 15 seconds. Static build execution does not start it. An hourly
maintenance task removes expired unused chat attachments independently of push
configuration. A purely serverless host needs a scheduled invocation of the drain;
an in-memory timer is not a reliable scheduler in a suspended process.

## Device behavior and privacy

Users click **Enable device notifications** inside a chat, then accept the browser's
permission prompt. Notifications are not automatically enabled. Each browser
endpoint belongs to one account at a time. Sign-out/account changes clear the
service-worker account binding, unsubscribe the browser endpoint and revoke the
server record. A device-scoped revocation capability is retained locally if a
network failure prevents server removal; it grants no message-reading authority.
Signing out still proceeds if notification cleanup fails.

Push content is generic: no job title, person name, message body or attachment
appears on the lock screen. The worker checks the signed-in account fingerprint
and opens only a validated same-origin `/dashboard/jobs/<UUID>/chat` destination.
Private chat attachments bypass both navigation/image caches and image warmers.
The shell cache version is bumped so the new worker removes old image caches.

Only approved organization members with dashboard access receive notifications.
The sender is excluded. Recipients are the job creator, assigned foreman, members
with this as their current job, and people who have explicitly joined/followed the
chat. Job mutes and read positions are checked both while queueing and immediately
before delivery. Joining a chat is separate from enabling device notifications.

## Delivery guarantees and limits

- Every eligible device receives a transactional outbox row, unique per message
  and subscription. The message and outbox commit atomically; provider failures
  happen afterward and never roll back a saved message.
- Workers claim up to eight rows with `FOR UPDATE SKIP LOCKED`, a two-minute lease,
  and a fresh lease token. Restarts retry abandoned leases. A process-wide guard
  avoids overlapping drains within one Node worker.
- Transport failures and HTTP 408/429/5xx retry with bounded exponential backoff,
  at most six attempts. HTTP 404/410 removes the expired subscription. Other 4xx
  responses stop that delivery. Queued notifications expire after one day; finished
  outbox rows are removed after seven days.
- Only known browser push-service HTTPS hosts are allowed. DNS results must be
  public addresses and are pinned for the request. HTTP has both an eight-second
  socket timeout and a twelve-second absolute deadline, plus a three-second DNS
  deadline. Endpoint URLs and browser encryption keys must not be logged.
- A crash after provider acceptance but before database acknowledgement can retry
  a delivery. This is at-least-once delivery; the per-job notification tag replaces
  older visible notifications. Web Push cannot guarantee immediate delivery:
  browser/OS settings, offline devices and battery optimization remain factors.
- Tests use fabricated devices and mocked transport. No real user notifications
  were sent during development. Browser delivery must be checked through an
  explicitly opted-in device in normal use.

## Primary references checked October 2, 2026

- [MDN PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe):
  secure context, user gesture, application server key, and `userVisibleOnly`.
- [Official web-push Node library](https://github.com/web-push-libs/web-push):
  VAPID key generation, encrypted payloads, provider responses, and the important
  distinction between its socket timeout and an absolute request deadline.
- [WebKit: Web Push on iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/):
  supported Home Screen web apps and permission requested from direct interaction.
