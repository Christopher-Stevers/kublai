# Job chat

The Chat card opens a persistent lobby for each job. Approved users in the job's
organization with Jobs/dashboard access can read and join it. The job creator,
foreman, and users whose current job matches are included as participants before
they explicitly join. Opening the lobby adds a durable membership; per-job mute
and read position are stored per account. This follows the application's existing
organization-wide job access; it does not introduce a separate private-job ACL.

Messages support replies, images/PDFs, edit/delete, older-history pagination and
unread counts. Authors can change their own messages; Executive Accounts can
moderate. Deletion leaves a visible tombstone and blocks attachment downloads.
Message retries reuse a client UUID and require an identical payload; duplicate
network submissions produce one message and one transactional notification enqueue.
A job advisory lock orders commits before sequence allocation. Read cursors only
advance and cannot skip future messages by submitting an arbitrarily large number.

Every request re-reads account approval, organization and dashboard permission.
SSE streams contain invalidation metadata only, recheck access before every poll,
and use persistent event rows to recover edits/deletions across process restarts.
Local events provide immediate wake-ups; a five-second database poll works across
processes. Streams close on request abort, cancellation, SIGTERM/SIGINT and after
four minutes for renewal. Each account can open at most five streams.

Attachments live outside `public/`, at `uploads/job-chat/<random UUID>`, and are
served only through authenticated routes. Pending files are visible to the uploader
only; sent files are visible to authorized members until their message is deleted.
The server validates image formats and dimensions, rejects SVG/HTML, and serves
PDFs as attachments with a restrictive content security policy. Limits: 10 MiB/file,
five files/message, 10 pending uploads, 100 uploads/200 MiB per uploader per day,
and 60 seconds to receive a body. Rejected uploads are removed. Pending uploads
expire after 24 hours; hourly Node instrumentation removes up to 100 expired records
and blobs per pass. Job/account deletion can leave unreferenced private blobs;
those require administrative storage cleanup and are never anonymously accessible.
Include this private directory in normal server backups. Message sends are limited
to 30 per author per minute across jobs.

## Deploy and verify

1. Configure Web Push as documented in `JOB_CHAT_PUSH.md` (the notification controls
   report availability; chat itself works without push credentials).
2. Run `pnpm exec tsx scripts/migrate-job-chat.ts` with the deployment database
   environment. This applies only migrations 0042/0043, uses the existing deployment
   advisory lock, and atomically records exact hashes in Drizzle's migration journal.
3. Build and restart the Node app. Instrumentation starts the persistent outbox
   worker and pending-attachment cleanup. Service-worker push handling uses the
   existing app worker and never caches chat APIs or attachment responses.
4. Users explicitly enable notifications on each device. Do not send test chat
   messages or pushes to real recipients without authorization.

Focused checks:

```sh
pnpm exec vitest run src/server/chat/attachments.test.ts src/app/api/job-chat/events/route.test.ts
bash scripts/test-job-chat-db.sh
pnpm exec tsc --noEmit
```

The database test creates an isolated temporary PostgreSQL cluster with Unix socket
only and synthetic `example.invalid` members; it never reads `DATABASE_URL` or sends
pushes. Set `JOB_CHAT_PG_BIN` if PostgreSQL lives elsewhere. The tests cover concurrent
idempotency, outbox rollback, tenant isolation, changed permissions, pagination,
read cursors, moderation, private uploads/downloads, upload expiration and quotas.

The isolated harness also runs the actual push enqueue/drain SQL in a separate
`chat_push_integration` database, with only DNS/provider transport stubbed. It checks
eligible devices, deduplication, mute/read/revocation/rebinding checks, concurrent
leases, durable backoff, lease recovery, attempt caps and expired subscriptions.
