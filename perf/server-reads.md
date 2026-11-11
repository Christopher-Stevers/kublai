# Non-streaming server-read observations

`server-reads.mjs` is a separate supplemental measurement tool. It never edits
the eight-journey method, baseline reports, budgets or activation decisions.
Two supplemental captures ran on 2026-11-11 against the source-bound Phase 0
synthetic application. They are observations, not an accepted repeated baseline.

The existing route wrapper begins before tRPC identity/context creation. For a
non-streaming JSON response its `app` header ends after the response is created,
including response serialization. For streamed JSONL that same header stops
early. This tool rejects JSONL and partial/ambiguous timing headers instead of
calling those headers a completed read. Next middleware and response transport
remain outside the measurement. Identity is stubbed in this synthetic lab.

After the journey capture has ended, use an independently started disposable lab
with its exact source evidence, compiled build, private PostgreSQL socket and
passed 14-endpoint preflight:

```sh
PERF_BASE_URL=http://127.0.0.1:3482 \
PERF_SERVER_READ_ROOT=/tmp/foremanhq-speed-app-EXAMPLE \
PERF_LAB_SOCKET=/tmp/foremanhq-perf-pg.EXAMPLE \
PERF_SERVER_PID=CO_STARTED_NEXT_SERVER_PID \
PERF_BUILD=ACTUAL_LAB_BUILD_ID \
PERF_SERVER_READ_OUTPUT=/tmp/server-read-capture-1.json \
node perf/server-reads.mjs
```

The tool accepts only loopback HTTP with an explicit port. It requires the lab
marker, synthetic fixture, matching preflight and served compiled manifest. It
checks the co-started Linux server's working directory and private database
environment before and after capture, consuming environment values locally
without logging them. Supply the loopback port of that same process; the tool
does not independently map kernel listening sockets to process IDs. It refuses
a database with ERROR/FATAL records. It invokes a fixed allowlist of read
endpoints, records one warm-up for each, then records ten rounds with a rotating
endpoint order. Nothing is written to production and no write journey is run.
The output contains procedure names, numeric durations and source/method hashes;
it omits request inputs, account IDs, database URLs and response contents.
An existing output file cannot be overwritten.

All measured samples and warm-ups remain in the report. Nearest-rank p95 is
reported both by procedure and in aggregate; the aggregate weights each endpoint
equally in complete captures and is not the real production traffic distribution.
Partial failed captures retain all completed samples but can have unequal endpoint
counts; their summaries are descriptive only. Database waits can
sum above total elapsed time because queries can overlap. A separate capture is
needed to assess repeatability. Neither one capture nor its p95 establishes the
complete Phase 0 gate, live sign-in latency or browser tap-to-paint speed.

The parser/summary checks use synthetic numeric inputs only:

```sh
node --test perf/server-reads.test.mjs
```

## Observed on 2026-11-11

Three parser/summary tests and both syntax checks passed. With other agents'
test/build work paused, a fresh private database and the existing compiled
Phase 0 snapshot passed all fourteen endpoint preflights. Two complete captures
at 05:48 UTC each retained 140 measured reads and fourteen warm-ups. Both had
zero database ERROR/FATAL records, matching process/source/manifest checks, and
an unchanged tool hash. Live services and normal OS background work continued.

| Capture | Route-wrapper median | Route-wrapper p95 | Summed database p95 |
| --- | ---: | ---: | ---: |
| First | 2.7 ms | 7.3 ms | 8.8 ms |
| Second | 2.3 ms | 5.7 ms | 6.7 ms |

The aggregate p95 changes by 21.9%, so these captures do **not** meet a 10%
repeatability requirement. All endpoints and samples remain in
`artifacts/server-reads-nonstream-2026-11-11-{1,2}.json`. Neither capture
establishes production authentication latency, the full Phase 0 gate or a
candidate improvement. The fixed synthetic endpoint weights and small samples
remain limitations, even though both observed p95 values are below 20 ms.
