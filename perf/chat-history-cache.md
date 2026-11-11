# Selected job chat: Phase 1 cached reads

Prepared 2026-11-11. This slice has not been activated. The focused run passed
59 tests across the reader, existing delivery fixtures and shared cache,
including manual-authority and real React Activity hide/show edges (three files,
one worker, 4.05 seconds). This is not an activation or physical-phone performance
pass.

The mounted real job-chat reader opts in only
`[["chat","history"], {input:{jobId,limit:50},type:"query"}]`, with a UUID job id
and explicit `deviceJobChatHistory: true` metadata. Existing acknowledged history
can then use the account/simulation-scoped SuperJSON device cache. Cursor pages,
prefetched/unvisited history, `conversations.*`, overview, member lists and all
mutations remain excluded. The shared 20 MB cap can evict this history; an empty
cache is not evidence of an empty conversation. Attachments retain their metadata
and authorized URLs, not offline file bytes.

`chat.getOverview`, `chat.history` and `chat.members` are denial authorities,
including imperative fetches through the tRPC denial link and QueryCache. The
existing account fence cancels reads, clears query memory and durable storage,
and locks the workspace after terminal read denials. Authenticated layout and
account-cache readiness still precede private paint. Nothing is shown before
sign-in confirmation, and existing account/generation fences are unchanged.

Saved rows do not establish membership or moderation rights. A fresh successful
overview for this account/job is required after opening or reactivation before
automatic join, mark-read, send, member display or message deletion can proceed.
The gate accepts only nonmanual successful fetch events in this active reader,
including responses whose timestamps match. Hydration and manual cache updates
cannot establish authority or replace the accepted permission object. A transient
overview failure retains the timeline and draft while keeping
these actions unavailable until another accepted overview. Existing join behavior
resumes only after fresh confirmation; no offline send or queue is introduced.

The first implementation missed React Activity's effect-only teardown: it retained
an accepted overview while a job panel was hidden without changing global page
activity. A real Activity reader test reproduced an enabled Send control before
the new overview response. The follow-up clears the live certificate synchronously
in layout cleanup and clears its retained render state. Mutation dispatch also
checks that live certificate, fencing old passive-effect closures during reveal.
The regression test changes the cached displayed sequence while hidden and proves
zero join, read-receipt or send calls and no stale moderation while the resumed
overview is pending. Saved rows and the draft remain visible; a fresh response
unlocks the reader again. This follow-up requires its own candidate build/evidence.

Recent saved rows paint while an older reading range is unavailable. Loaded older
message pages remain memory-only and can refresh once access is confirmed; exact
older scroll restoration across an offline restart is not claimed. Drafts remain
in their separate existing store with stable retry IDs. A successful send response
without a loaded history page displays that acknowledged row in memory; it does
not fabricate a persistable complete history page. With an existing history page,
acknowledged writes update its bounded latest 50 rows and preserve its older-page
cursor. Old-account responses cannot inject these updates into a newer binding.

Required focused proof is in `JobChatThread.cache.test.tsx` and the added
`device-query-cache.test.ts` cases: unresolved-authority cached paint, stale
moderation and membership, offline missing-range paint, cache misses, gateway
failure/reconnect, reactivation with equal timestamps, three read-authority
denials, imperative cursor denial, account transitions and delayed old responses,
send acknowledgment before history, exclusion of drafts/cursors/permission state,
and optimistic pending exclusions. Existing delivery/idempotency/scroll fixtures
remain in `JobChatThread.test.tsx`.

Scoped ESLint passes for the cache, authority helper and test files. The reader
still has its pre-existing `/jobs/chat` raw-anchor error and attachment-image
warning; with only the raw-anchor rule disabled it has zero errors. These
existing navigation/image concerns are outside this cache slice. No browser,
server, production-database or physical-device test was used for these checks.

After these checks pass, canonical compilation, byte ratchets, measured navigation
and physical-phone gates still apply before activation. This is Phase 1 Tier 1
cached reading. Durable full history, offline sending, upload queues and convergent
chat sync remain Phase 2. No schema, worker or production database change is used.
