# Job-home chat badge refresh behind — focused verification

Excluded from frozen R18. Source/tests were authored during its quiet window;
validation ran only after explicit measurement cleanup/release.

JobsClient's existing `{jobId}` chat.getOverview observer now receives
useTierOneReadOptions with the same online/nonempty-job/options eligibility.
The helper adds active-page/visibility eligibility and refreshes a fresh cached
query on revisit/resume, after observer effects. The badge still reads data while
refreshing. Its 30-second poll and no-background interval setting remain unchanged.
There is no new observer, key, prefetch, timer, permission certificate, persistence
or history access. No global helper or denial policy changes. This is stale-badge
refresh coverage, not device-first chat/offline membership or latency completion.

The existing JobsClient tools fixture uses a real QueryClient and
real query observer for this endpoint, while rendering the existing badge prop as
an accessible output. A new deferred integration case starts with a fresh cached
badge on an inactive workspace option, revisits job options, asserts immediate
saved badge plus one pending request, accepts its new count, then checks internal
page pause/resume disables/revalidates the same observer. Other tools/receiving
assertions remain. The shared policy's existing tests cover cancellation, account
read-authority replacement and terminal-denial handling; those are not new proofs
of this application wiring. Validation results follow.


After release, the focused JobsClient tools and shared read-policy suites passed
**13 unique tests in two files**, one Vitest worker. This includes the new deferred
badge revisit/accepted replacement/internal-page pause-resume case and preserves
all prior tools/receiving assertions. Scoped ESLint passed both changed files;
the same two HEAD files also lint clean. git diff --check passed. Logs:
`/tmp/job-chat-badge-tests.log`, `/tmp/job-chat-badge-lint.log`, and corresponding
`*-head.log` files. Node module.register deprecation and two existing jsdom
scrollTo-not-implemented notices appeared; no assertion failure occurred.
No build, browser, database, timing, frozen-source change or activation ran. This
is narrow refresh coverage and makes no every-screen or performance-gate claim.
