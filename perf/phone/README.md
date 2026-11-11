# Separate physical-phone visited-read evidence

Prepared source only. Do not run during the lab baseline CPU quiet window. Root owns Android pairing/ADB setup and runtime attestation after the lab. This runner is **not** in `HARNESS_FILES`, does not import or modify frozen `perf/run.mjs`/`journeys.mjs`, and cannot be reported as accepted `ready-then-pinch-v2` or an eight-journey/three-link matrix.

The initial scope is two repeats of three **visited read** journeys: open job, open the job's material-list tab, and open a material list. Selectors mirror the existing adapter, but input is separately implemented page-CDP touch start/end. It warms each destination through the actual UI, returns via that new tab's history, then times the second opening. No quantity, receipt, order, chat, recognition, drawing edit or production write journey is executed. Natural device CPU is used: no four-times slowdown or CPU override, viewport emulation or link shaping. Heating/refresh rate are not inferred from the model name.

## Runtime needs, to arrange after quiet

- Android developer options and **Wireless debugging** paired by root on the trusted LAN, with an authorized `adb` device shown as connected. USB is an explicit alternative, not assumed. Phone unlocked, Chrome open and screen awake; user supplies battery/thermal/refresh-setting observations if available. Do not change personal account/session settings.
- A source-frozen synthetic lab app on host loopback, backed by the private `/tmp/foremanhq-perf-pg.*` PostgreSQL fixture; existing endpoint preflight passed against the exact lab artifact/source fingerprint. Root must confirm running server PID/cwd/build maps to that lab directory and the private fixture, not production. `/api/perf-lab` must say `isolated-seeded-app`, `productionDatabase:false`, `stubbed-seeded-user`, and `perf-lab-user`.
- Root establishes a **dedicated phone loopback origin** with `adb -s DEVICE reverse tcp:43991 tcp:HOST_LAB_PORT`. Phone `http://127.0.0.1:43991/` then reaches only the synthetic host app. ADB over Wi-Fi carries that forwarding traffic; this is unshaped lab transport, not a Site/Basement network profile.
- Root establishes `adb -s DEVICE forward tcp:49222 localabstract:chrome_devtools_remote`. Socket names vary by Chrome channel; if unavailable, stop and resolve the correct channel with root. Do not list or inspect existing browser targets. Do not use `am start --force-stop`, reset Chrome, or change global connectivity.
- Target creation mode is explicit: default `PERF_PHONE_TARGET_CREATION=http-new` uses PUT `/json/new?about:blank`. For Android endpoints rejecting HTTP creation, root approved `PERF_PHONE_TARGET_CREATION=browser-create-target`: read only `/json/version` metadata, connect its browser WebSocket, send **only** `Target.createTarget({url:"about:blank"})`, close that control connection and attach directly to the returned page ID. No auto-attach/discovery/list operation is enabled. Mode is recorded in each report; unsupported creation fails without an automatic fallback or existing-tab attachment.
- Node with built-in `fetch`/`WebSocket` (current host Node 26 is sufficient), exact lab `source-evidence.json`, `preflight.json`, `perf/fixtures.json`, private database schema inventory and clean error log. No new npm install or phone app is needed.

Example **for root after explicit clearance**, replacing paths/ports/build from the already verified lab:

```sh
PERF_PHONE_CONTROL_TRANSPORT=adb-wifi \
PERF_PHONE_DEVICE_MODEL='Google Pixel 9 Pro XL (user confirmed)' \
PERF_PHONE_HOST_BASE=http://127.0.0.1:HOST_LAB_PORT/ \
PERF_PHONE_BASE=http://127.0.0.1:43991/ \
PERF_PHONE_CDP=http://127.0.0.1:49222/ \
PERF_PHONE_LAB_ROOT=/absolute/verified/synthetic/lab \
PERF_LAB_SOCKET=/tmp/foremanhq-perf-pg.EXACT \
PERF_BUILD=EXACT_PREFLIGHT_BUILD \
PERF_PHONE_OUTPUT=/absolute/evidence/phone-reads.json \
node perf/phone/run.mjs
```

Set `PERF_PHONE_CONTROL_TRANSPORT=adb-usb` only for an actual USB control connection. Optional `PERF_PHONE_RUNS` is bounded 1–5; `PERF_PHONE_THERMAL_NOTE` is a non-sensitive human observation. Output contains no ADB serial, cookies, unrelated page URLs or account data. Root removes only the specific forward/reverse mappings they created after the session; do not use `--remove-all`.

## Browser isolation and timing meaning

Local Playwright 1.59.1 `connectOverCDP` initializes the browser and calls `Target.setAutoAttach`; it may discover/attach personal targets. This runner therefore uses **only the new target's direct WebSocket**, not browser-wide Playwright connection, target listing, context routing, cookie APIs, context cleanup or `Browser.close`. It closes only its created tab. The optional, explicitly authorized browser creation connection sends just `Target.createTarget` and is closed before the direct page session; it never lists or attaches existing targets. The validated created target is closed even on WebSocket validation/open failure. If the create request itself times out before returning its ID, a new blank lab tab may remain for the user/root to close; do not inspect other tabs to recover it.

The same private loopback app is attested from the host and a page-local same-origin fetch (with redirect rejection, status check and timeout) before visiting synthetic screens; Chrome JSON-viewer body text is never parsed. Host HTTP/CDP setup and WebSocket open are bounded to ten seconds. Early setup failures write a `setup-failed`/`smoke-setup-failed` artifact with a bounded phase/error class and no accepted samples; unknown target creation outcomes are not recovered by discovery. Source build and fingerprint must match the passed preflight, and fixture provenance/database flags must be synthetic. Only that new page's DOM/runtime is queried. Existing device cookies are neither read nor cleared. The dedicated loopback origin must not be reused for personal browsing. No network interception, offline toggle or network condition command is sent; later link experiments, if separately approved, must stay page-scoped and belong to another explicit method.

`browserDurationMs` starts at the page's actual pointerdown event and ends after destination DOM readiness plus two rAF opportunities. `gestureHoldMs` records pointerdown-to-pointerup, which can include Wi-Fi ADB command turnaround. `driverWallclockMs` separately includes all host/control/CDP latency. Bounded raw page-local frame gaps and existing allowlisted app measures are retained; they are not a physical pixel/compositor presentation timestamp. The open-job/tab/list readiness checks are not universal screen completeness.

Chrome `Tracing.start` may collect browser-wide activity including personal tabs, so it is deliberately not used. The JSON raw rAF/mark samples are page-local diagnostics, **not a Chrome trace or physical frame proof**. A browser-wide Perfetto/DevTools trace would require a separately approved isolated browser/device setup. No screenshot or screen recording is taken. Physical CPU throttling, thermal state, refresh rate, link calibration, repeatability, production bytes/auth startup and full matrix gates remain open.

## Verification status

Source was prepared during the baseline quiet window. After explicit release, formatting and `node --check perf/phone/run.mjs` passed. This agent has not executed phone commands, created a target/browser session, run this method, or built an app. Root owns the separate local smoke and physical session. Before hardware use, root should review and run a separate local synthetic smoke check of this new runner after clearance, especially Android `/json/new` support and page-only CDP touch behavior. Unsupported connection/input capabilities must fail explicitly, not be worked around by inspecting personal tabs.

For a separately launched disposable local Chromium smoke check, require both
`PERF_PHONE_SMOKE=1` and `PERF_PHONE_CONTROL_TRANSPORT=local-smoke`. All lab
attestation/isolation checks stay enabled. Reports use method
`local-smoke-visited-reads-page-cdp-v1`, status `smoke-only`/`smoke-failed`, and
`physicalPhoneEvidence:false`; those results must never be presented as phone
evidence. Root owns launching that disposable browser and the later phone run.

## Connection diagnostics and the first attempt

The explicit browser-create mode was added after Android Chrome rejected HTTP
`PUT /json/new`. It reads metadata from `/json/version` and sends only the
browser command `Target.createTarget` for `about:blank`; it never enables target
discovery or automatic attachment. The owned page then receives
`Page.bringToFront` before navigation, recorded as `activate-new-page`.

The exact-text selector includes the app's `div[data-slot="card-title"]` and
rejects ancestor matches when a visible child has the same text. This matches
the frozen adapter's generic text locator without accidentally timing a hidden
retained panel. Reports identify bounded phases (attestation, navigate,
source-ready, warmread, back and visitedread) plus journey/run. Failed runs retain
completed samples only as diagnostics. Early setup failures also produce an
artifact, with setup phase/error class and known source/creation context rather
than an uncaught setup timeout. No discovery fallback is used to recover an
unknown target creation outcome.

Cleanup records whether the exact created target's HTTP close was acknowledged,
with status/error class. HTTP acknowledgment is not an independently observed
compositor or process-lifecycle result. No other target is closed or inspected.

Root reports that the separate local smoke passed all three visited-read cases
using browser-create plus bring-to-front. The physical Pixel attempt created and
activated its own tab but timed out at attestation navigation; it produced **zero
journey timings**. The owned tab close returned HTTP 200, forwards were removed,
and the user was released. These diagnostics do not establish physical target
performance, a completed phone benchmark, or an accepted matrix. No additional
phone commands are part of this source follow-up.

## Manual bounded protocol diagnostic

`diagnose.mjs` is a separate **source-prepared, device-unexecuted** investigation tool.
It does not run ADB, launch Chrome, alter forwarding, discover existing targets,
or run automatically from any package script. A future phone session needs a
new explicit user window and root's verified synthetic lab/forwarding setup.
The previous physical attempt still provides **zero journey timings**.

The diagnostic requires the same source/preflight/fixture/private-database
evidence and loopback origins as `run.mjs`, plus the explicit opt-in
`PERF_PHONE_DIAGNOSTIC=owned-target-only`. Root manually invokes
`node perf/phone/diagnose.mjs` with those environment variables and may set
`PERF_PHONE_DIAGNOSTIC_OUTPUT` to an evidence filename. There is no automatic
launch, retained-browser mode, fallback, navigation retry or target recovery by listing.
`PERF_PHONE_BROWSER_LIFETIME`, if supplied, must be `close-after-create`.

The complete CLI has a **60-second hard process limit**: work is limited to
50 seconds, leaving up to eight seconds for exact-ID cleanup and the remaining
time for the report. Every fetch, socket opening and CDP command is bounded to
at most five seconds and the remaining work budget. Root should keep the
synthetic app isolated and available throughout this short manual window.

The sequence is fixed:

1. Attest the host lab, read `/json/version`, then issue exactly one browser
   command: `Target.createTarget({url:"about:blank",forTab:false})`.
2. Close the creation WebSocket, preserving the original runner's lifetime
   choice, and connect only to `/devtools/page/<returned-ID>`. Enable Page and
   Runtime, then bring only that created page to the front.
3. Evaluate three booleans on the blank page: expected blank URL, complete
   document and visibility. An unexpected or incomplete blank page stops work;
   visibility is recorded without forcing additional UI actions.
4. Navigate once to a fixed, network-free synthetic `data:text/html` document,
   then wait up to five seconds for its expected URL and fixed probe element.
5. Navigate once to the dedicated loopback `/api/perf-lab` endpoint, wait for
   that expected URL and return only a boolean from its same-origin attestation
   fetch. The Chrome JSON-viewer body is never parsed.
6. Stop at the first failure and close only the known created target using
   `/json/close/<returned-ID>`. Record the HTTP acknowledgment; this does not
   independently prove target destruction. Unknown creation outcomes are not
   recovered through discovery and may leave a blank tab for manual cleanup.

Reports contain stage/command names, numeric CDP error codes, socket close/error
observations with elapsed time, whitelisted event **names and counts only**,
and the specific boolean checks. Event payloads, raw protocol errors, close
reasons, private URLs, console messages, DOM text, cookies, screenshots and
target IDs are not written. Browser-wide tracing, auto-attach and target
listing remain excluded. Reports always set `accepted:false`,
`physicalPhoneEvidence:false` and `completedSamples:[]`; even success is only
`diagnostic-only`. This tool cannot supply physical performance evidence.

Blank-runtime failure narrows attention to initial renderer/session readiness;
network-free success followed by loopback failure narrows attention to Chrome's
request/navigation path. Socket close/error observations distinguish a
disconnect from an unanswered navigation. None alone establishes a root cause.

Exact Chromium **157.0.8103.46** source supports preserving the current target
and lifetime choices: [Android target creation](https://chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.46/chrome/browser/devtools/protocol/target_handler_android.cc#65)
defaults `forTab` to false and returns the page/frame host; [TabModel ownership](https://chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.46/chrome/browser/ui/android/tab_model/tab_model_jni_bridge.cc#341)
passes WebContents lifetime to Java. [Page.navigate](https://chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.46/content/browser/devtools/protocol/page_handler.cc#995)
can await navigation-request transfer/reset rather than full document load.
These sources do not prove which condition caused the earlier timeout.

The shared `cdp-transport.mjs` rejects all pending commands immediately on a
post-open socket close/error, clears their timers and preserves numeric CDP
error codes without raw error text. The visited-read runner keeps its existing
30-second command/10-second opening limits and timing method; it records the
transport's source hash alongside the runner hash. It does not enable event
logging. `cdp-transport.test.mjs` uses only an in-memory mock socket and fake
timers to check disconnects, errors, timeouts, sanitized observations and cleanup.
After root released the quiet window, all **six mock transport tests passed**
(zero failures), and `node --check` passed for the diagnostic, shared transport,
transport test and visited-read runner. These tests use no HTTP/network,
browser or Android actions. The new diagnostic remains unexecuted against a
browser/device; no new phone timing samples or physical evidence were produced.
