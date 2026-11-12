# ForemanHQ Speed Plan

Written 2026-11-10; approved by Tim. Release policy amended 2026-11-12.

Tim’s [dev-lane amendment](DEV_LANE.md) takes precedence over earlier activation language: merged changes deploy to Omarchy after scoped tests/type checks and a canonical build, with serialized switching, health checks, automatic health rollback and old assets retained. Timing and byte reviews follow in batches through `perf/REVIEW_QUEUE.md`; production promotion retains the full gate. Database/schema changes, worker releases, autopilot activation and data/file deletion still need explicit approval each time.

Every number marked "measured" was taken on this date from the live build, the public site or the repo. Every number marked "estimate" is unproven and has a step in the plan that proves or kills it.

## 1. The short version

The goal is an app where the screen answers before the finger lifts, on a phone, in a basement.

Three rules carry the whole plan.

1. Nothing a person does waits on the network.
2. Nothing the device already has is shown blurry, late or behind a spinner.
3. Production promotion passes the measured gate; dev deploys are reviewed afterwards.

There are seven workstreams, one per idea. They run on three tracks that do not block each other.

| Track | Workstreams | What a person feels |
| --- | --- | --- |
| Shell | 3 Answer before the tap, 4 Open like a native app, 7 Speed law | Presses answer at once. The app opens at once. |
| Data | 2 No network on any tap, 5 Shrink every byte, 6 Work at save time | Changes show at once. The app works with no signal. |
| Drawings | 1 Drawings that never blur | A sheet is sharp in every frame of a pinch. |

Four findings from the grounding work are cheap to fix and large. They go first.

- A deploy that switches between a Codex build and one of my builds renames 251 of 252 script files. Each phone downloads 2.74 MB again. On a 50 KB/s link that is 55 seconds. Measured.
- After any deploy, script files from the build before it return 404 from the server. A person with the app open can hit a screen that cannot load. Measured.
- Every screen change waits on a network round trip, also for a screen seen ten seconds ago. The service worker asks the network first, and the router keeps nothing. Measured in `public/sw.js`.
- Script goes out as gzip. Brotli would cut it by an estimated 15 to 20 percent with no code change. Measured header, estimated saving.

## 2. Targets

Reference phone: a mid-range Android phone, or desktop Chrome with a 4x processor slowdown.

Reference links:

- Basement: 50 KB/s, 400 ms delay.
- Site: 300 KB/s, 150 ms delay.
- Office: fast.

| Measure | Today | Target |
| --- | --- | --- |
| Press shows on the control | not measured | same frame as finger down |
| Tap to next screen painted, for a screen seen before | one network round trip, every time | under 100 ms at p95, on any link, and with no signal |
| A change shows after a write | instant for 13 synced list actions and 1 other; all other writes wait on the server | same frame |
| App icon to last screen visible, repeat visit | not measured | under 300 ms, no network needed |
| App icon to working, repeat visit | not measured | under 1 s |
| First ever visit on the Site link, to working | not measured; shared script alone takes 1.3 s | under 3 s |
| Shared script on every screen | 390 KB gzip, 1.2 MB raw | 120 KB gzip |
| Heaviest screen, receiving | 552 KB gzip | 180 KB gzip |
| Sheet seen before, sharp after a pinch | 0.32 s | sharp in every frame, no sharpen step |
| New sheet on the Basement link, readable | 10.6 s | 3 s, if the spike in section 11 passes |
| New sheet on the Basement link, fully sharp | 24.1 s | 8 s, if the spike passes |
| Pan and zoom frame time, p99 | not measured | 16.7 ms, and 8.3 ms on 120 Hz screens |
| Script downloaded after a deploy | 0.05 to 0.50 MB gzip, or 2.74 MB on a pipeline switch | under 100 KB typical, never the whole app |
| Requests while the app sits idle | about 29 polling queries at 2 to 60 s, plus 4 streams | one stream, no polls |
| Server time for a read, p95 | not measured; health check is 2 ms | under 20 ms |
| Interaction to next paint in the field, p75 | not measured | under 50 ms |

The field numbers do not exist yet. Phase 0 creates them.

## 3. Where the app is today

All measured on 2026-11-10.

**Server and edge**

- The server is not the bottleneck. `/api/health` answers in 2 ms. `/sign-in` starts in 7 ms.
- The site sits behind Cloudflare through a tunnel to one machine.
- HTTP/3 is already on at the edge.
- Script files are cached at the edge for a year and marked immutable. Good.
- Script files go out as gzip. Pages go out as zstd.

**Script**

- 11.2 MB of script in 252 files.
- Almost every screen loads about 1.2 MB raw, 390 KB gzip, before its own code.
- Receiving loads 1,734 KB raw, 552 KB gzip. A material list loads 1,478 and 462.
- The 3.7 MB chunk is loaded on demand. No screen lists it up front. Good.
- 48 pages. 297 of 356 component files are client components. 6 files load code on demand.
- The jobs layout wraps every screen in about 20 providers.

**Deploys**

- Two of my builds in a row share 228 to 243 of 252 files. Good.
- Two Codex builds in a row share 190 of 252.
- A Codex build and my build of nearly the same code share 1 of 252.
- Old script files return 404 right after a deploy.

**Data**

- 26 routers with about 133 reads and 185 writes.
- The largest are drawings workspace at 44, catalogue 36, assets 31, material list 20, estimating 18 and rooms 17.
- The client has 177 `useQuery` and 200 `useMutation` calls. One of them updates the screen before the server answers.
- Read data is kept for 30 seconds in memory. Nothing is kept across a restart.
- Replicache 15.2.1 is in the repo and already syncs material lists, jobs, suppliers and the catalogue. It has 13 client mutators. The server side is in `src/server/replicache/` and uses client view records.
- 4 event streams and about 29 polling queries. 24 files also run their own timers.

**Presses and movement**

- 1,250 `onClick` handlers against 23 `onPointerDown`.
- About 1,800 uses of the shared `Button` and about 600 raw `button` elements.
- One `router.prefetch` in the whole app, at `src/app/jobs/JobsClient.tsx:138`.
- No View Transitions. 75 skeleton uses and 69 spinner uses.

**Service worker**

- `public/sw.js`, 799 lines. Pages and route payloads go to the network first. The cache is the fallback when the network fails.

**Drawings**

- After commit 0b3a8ef6: on 50 KB/s a new sheet is readable 10.6 s after a pinch and sharp at 24.1 s. A sheet seen before is sharp in 0.32 s with no request.
- On a real 77 page set, the per-sheet PDF has a median of 610 KB. The sheet image has a median of 271 KB.
- The repo already walks PDF drawing operators to pull out lines, in `src/lib/pdf-line-geometry.ts` and its neighbours.
- Rust crates exist in `native/`. The Rust toolchain is not installed on this machine.

**Measurement**

- No timings come back from real phones. `src/lib/drawing-performance.ts` keeps 100 samples on the device and sends nothing.

## 4. What "a pleasure to use" means here

Speed is one part. These rules cover the rest, and each has a check in the speed law.

- **The press is acknowledged in the frame it happens.** The control changes under the finger before anything else.
- **Content never waits for motion.** An animation plays over content that is already there. It can always be interrupted by the next touch.
- **No spinner for work the device can do itself.** Spinners remain only for work that is truly remote, such as reading a packing slip.
- **Undo replaces "Are you sure?"** for everything that can be undone. Confirmation stays for money and deletion.
- **Nothing jumps.** Every image and row has its size before it loads.
- **Input is never lost.** A tap during loading is honoured. Typed text survives a crash, a reload and a dead signal.
- **The app is honest and quiet about sync.** One small mark says "on this device" or "sent". It never blocks.
- **Going back is instant and exact.** Same scroll position, same open panels.
- **Updates never interrupt.** A new version arrives in the background and takes over at the next quiet moment.

## 5. Effort sizes

Sizes are for focused agent work with verification. They are rough.

- S: a day or less.
- M: two to four days.
- L: one to two weeks.
- XL: three weeks or more.

## 6. Phase 0. Measure before changing anything

This is the first half of idea 7, pulled to the front. Without it no later claim can be proved.

**Steps**

1. **Field timing.** Add the `web-vitals` library and four marks of our own: tap to next paint, write to paint, app start to last screen, sheet open to sharp. Send them with `sendBeacon` to a new `/api/perf` route. Tag each with the build, the screen kind, a device class and a link class. No names, no ids, no content. Store as daily files on the server at first, so no database change is needed. Size S.
2. **Server timing.** Add a `Server-Timing` header to tRPC and sync responses with database time and total time. Size S.
3. **A lab that does not touch live data.** The test server uses the live database today, so it cannot run write journeys. Create a seeded database with made-up jobs, lists, slips and the synthetic 40 page drawing set. `scripts/test-packing-slip-history-db.sh` is the precedent. Size M.
4. **Journeys.** Move the netperf harness from `.tmp/netperf` into the repo as `perf/`. Script eight journeys: cold start, open a job, switch job tabs, open a material list, change a quantity, receive a line, open a sheet and pinch, send a chat message. Run each at the three links and at 4x processor slowdown. Size M.
5. **Script map.** Run the bundle analyzer once and record what is in the 390 KB shared part. Size S.
6. **Press audit.** List every press handler by kind: fixed control, control in a scroll area, destructive. Count how many go through shared primitives. Size S.
7. **Baseline report.** One table with today's number for every row in section 2.

**Gate.** Every row in section 2 has a real number, and a repeat run moves it by less than 10 percent.

## 7. Workstream 3. Answer before the tap

Recommended first. It changes how every screen feels and it needs no database change.

### Today

A press does nothing until the finger lifts. Then the screen change waits on the network. Code for the next screen is loaded after the tap.

### Design

**Three kinds of press.**

| Kind | Examples | Rule |
| --- | --- | --- |
| Fixed control | bottom bar, tabs, toolbar, dialog buttons | acts on finger down |
| Control in a scroll area | list rows, cards | prepares on finger down, acts on release |
| Destructive or money | delete, send order, Accept | acts on release, as today |

Acting on finger down inside a list would open a row when the person meant to scroll. So rows prepare instead. Preparing means loading the code, reading the data and getting the next screen ready. Release comes 80 to 120 ms later. By then the screen is ready, and a scroll cancels it.

**One primitive.** A `usePress` hook and a `press` setting on the shared `Button`, the link wrapper, list rows, the bottom bar and tabs. It sets a pressed state in the same frame. It swallows the click that follows a press it already handled. Keyboard and screen reader activation still work through the click path. Mouse presses count only for the main button with no modifier key.

**A route registry.** One file maps each screen to its code and its data:

```ts
// src/routes/registry.ts
job: {
  code: () => import("~/app/jobs/[jobId]/JobScreen"),
  data: (p: { jobId: string }) => [jobQueries.detail(p.jobId), jobQueries.lists(p.jobId)],
}
```

Preparation, prediction, the lab journeys and the budgets all read this one registry.

**No round trip for a screen seen before.**

- Set the router's `staleTimes` so a route payload is reused for five minutes.
- Change the service worker to answer route payloads from its cache and refresh behind, keyed by build.
- Turn the tabs inside a job into one client tab host that keeps panels alive with React's `Activity`. Switching tabs becomes a state change with the address updated through `history.pushState`. No route request at all.

**Prediction on the device.** A small table per person: from this kind of screen, which screen came next, how often. It lives in the browser's storage, a few KB, cleared at sign-out, never sent anywhere. At idle the app prepares the top two guesses above 25 percent. It also uses plain rules: the last tab used on this job, the first rows on screen, the sheet after this one.

**Going back.** The previous screen stays alive, hidden, with its scroll position. Back is a swap.

**Movement.** View Transitions for screen changes, 150 ms or less, skipped when the person asks for reduced motion. The new screen is already under the animation.

**Sheets.** When a sheet is open and the link is good, fetch the sheets it links to and the next sheet in the set, small ones first. This is the same decision as saving sheets a person has not opened, which Tim has not made. It stays off until they decide.

### Steps

1. `usePress`, the pressed state and the click guard, with tests for touch, mouse, keyboard and screen reader. Size M.
2. Apply to the bottom bar, job tabs and the jobs list. Measure. Size S.
3. Route registry for the eight journey screens, with prepare on finger down. Size M.
4. `staleTimes` and the service worker change for route payloads. Size S.
5. Job tab host with `Activity`. Size L. This touches `src/app/jobs/[jobId]` layout and page files.
6. Apply the primitive across the shared `Button`. Review the 600 raw buttons by screen, busiest first. Size L.
7. Prediction table and idle preparation. Size M.
8. View Transitions and back restore. Size M.
9. A lint rule: no new raw `onClick` navigation outside the primitives. Size S.

### Gate

- Tap to next paint under 100 ms at p95 for the eight journeys, at 4x slowdown, on all three links, second visit.
- No wrong opens in a scripted test of 200 flings through a list.
- Keyboard and screen reader checks pass.
- No write is sent twice in a double press test.

### Risks and fallback

- A press that acts too early. The rule table keeps destructive actions on release. Each screen can be set back to release with one setting.
- Memory from hidden screens. Cap at two hidden screens. Drop them when the page is hidden.
- Codex is working on zoom prediction in `drawing-zoom-intent.ts`. This workstream stays out of zoom. It covers screen changes only.

## 8. Workstream 2. No network on any tap

The largest change, and the one that makes the app work with no signal.

### Today

Material lists, jobs, suppliers and the catalogue already sync through Replicache. Everything else reads from the server on mount and waits on the server for each write.

### Design

Two tiers. Tier 1 is quick and covers every screen. Tier 2 is deep and covers the screens people live in.

**Tier 1. Every screen opens from the device, then refreshes.**

- Persist the query cache to the device with TanStack's persist client, per account, using the same account key as drawings.
- Serialise with SuperJSON so dates survive.
- Mark sensitive queries, such as payment, as never persisted.
- Cap at 20 MB. Wipe at sign-out and on account change. Wipe on a data version change.
- A helper, `useInstantMutation`, that applies the change to the cache, sends it, and rolls back with a quiet notice on failure. Apply it to the 20 most used writes from the field counts.
- Tier 1 does not queue writes while offline. A half-built second sync engine is worse than none.

**Tier 2. Real local-first on the engine already in the repo.**

Recommendation: extend the vendored Replicache. It is proven here, the server pattern exists, and the alternatives each need a new service. Put it behind a thin store interface so the engine can be replaced later. As far as I know its makers have moved on to a newer product, so the vendored copy is ours to keep working.

Order, by how much time people spend there:

1. Job detail and everything on the job home screen.
2. The rest of material lists. 20 procedures, some still on tRPC.
3. Receiving and slip review state.
4. Drawing workspace data: sheets, markups, measurements, pins, scales. 44 procedures.
5. Chat and conversations.
6. Timesheets.
7. Assets, rooms, models, estimating and pricing stay on tier 1 until use says otherwise.

Design points that need to be right:

- **Partial sync.** A device holds summaries for every job and full data for an active set: jobs opened in the last 30 days and pinned jobs. Without this, storage and pull time grow with the company.
- **One definition per write.** Each mutator is defined once with its input schema, its device version and its server version, side by side in `src/sync/mutators/`. The server version is the authority.
- **Conflict rules by kind of data.**

  | Data | Rule |
  | --- | --- |
  | Plain fields | last write wins per field, by server time |
  | Counted quantities | "add 5" merges as an addition; "set to 5" wins by time and leaves a note of who changed it |
  | Order of rows | fractional positions |
  | Deletes | a delete wins over a later edit |
  | New rows | the device makes the id, so creating never waits |
  | Refused by permissions | the device rolls back and shows why, quietly |

- **Files.** Photos and scans show from the device at once and upload in a queue that resumes.
- **Remote work stays remote.** A slip being read shows as a local row in progress. The result arrives over the stream.
- **Access.** A device holds only what the person may read. A change of role resets the device's view. Sign-out wipes it.
- **Sync mark.** One small mark per screen: on this device, or sent.

### Steps

1. Tier 1 persisted cache with wipe rules and tests. Size M.
2. `useInstantMutation` and the first 20 writes. Size L.
3. Write down the existing sync contract from `src/server/replicache/pull.ts`, `views.ts` and `material-list-sync.ts` as a short spec with tests. Size S.
4. Store interface and the mutator definition pattern. Port the 13 existing mutators to it with no behaviour change. Size M.
5. Partial sync with the active set. Size L. Needs a database change for per-job versions.
6. Job detail domain. Size M.
7. Receiving domain. Size L. `receiving-service` is in the worker bundle, so this needs a worker release.
8. Drawing workspace domain. Size XL. Agree the split with Codex first.
9. Chat, then timesheets. Size L each.
10. Upload queue. Size M.

### Gate

- All eight journeys pass in airplane mode after one sync, writes included.
- Tap to next paint does not change when 2 s of delay is added to every request.
- A convergence test with three devices and 1,000 random orderings of writes ends with identical data every time.
- A killed tab loses no write.
- A typical job uses under 50 MB on the device.

### Risks and fallback

- **Wrong data is worse than slow data.** Receiving quantities touch money. Each domain ships behind a switch per company, with the convergence test in place before the switch is turned on.
- **Database changes.** Steps 5 to 9 need them. Each one is asked for separately.
- **Device storage is not encrypted.** That is the same as today's offline data. Stated so it is a choice and not a surprise.
- Fallback for any domain: stay on tier 1.

## 9. Workstream 4. Open like a native app

### Today

A cold start goes to the network for the page, then loads 390 KB of shared script, then asks the server for data. The four findings in section 1 all live here.

### Design

**A. Deploys that cost almost nothing. Do this first.**

1. One build recipe for both Codex and Claude sessions, so the same code always gives the same file names. Proof: build one commit in both places and compare. All 252 files must match. The cause of today's difference is not yet known. Likely suspects are the output folder setting, the Node version and the folder the build runs in.
2. Keep serving script files from the last ten builds. A person on an old build never gets a 404.
3. Compress script with brotli at the highest level at build time.
4. The service worker fetches the changed files of a new build in the background, on a good link, and switches at the next quiet moment. If a file ever fails to load, the app reloads once into the new build on the same screen.
5. Later: send each changed file as a difference against the copy the device has, using compression dictionaries. This works in Chrome and in the Android app. iPhone support has to be checked when we build it. Other browsers get the normal file.

**B. The page comes from the device.**

- The page shell holds no personal data once screens read from the device store. Then the service worker can answer from its cache at once and refresh behind.
- The sign-in gate moves from blocking the page on the server to a cookie check in middleware. Every data call is still checked on the server, as now.

**C. The last screen, painted before the app starts.**

- When the app is hidden, save a small copy of the current screen: the main region's markup, under 150 KB, with the scroll position.
- On launch the service worker stitches that copy into the page it serves. The first paint is the last screen, with no script run yet.
- The live app takes over under it, without a jump.
- Stored per account, deleted at sign-out, never taken on screens marked sensitive.

**D. Who is signed in, without waiting.**

- Today the server works out who the person is before it sends any page, in `src/app/jobs/layout.tsx`. For an instant start the app shows the last signed-in account's stored screen while Clerk confirms in the background. If Clerk says no, the screen is wiped and the sign-in page shows.
- The cost: a device whose session was ended remotely shows the last screen for up to a second. Tim decides whether that is acceptable.

**E. Script diet.**

- Target 120 KB gzip shared and 60 KB per screen on top.
- Load each of the roughly 20 providers in the jobs layout only on screens that use it.
- Load dialogs, scanners, editors and charts on demand. Only 6 files do this today.
- Turn on `optimizePackageImports` for icons, Radix and date code.
- Turn on the React Compiler, first on a few folders, then everywhere, with the lab watching.
- Look hard at what Clerk's client costs in the shared part.

**F. The Android shell.** With the service worker serving the shell, the WebView start needs no network. Add haptics on confirm through Capacitor.

**G. Polish.** Sized images in modern formats, fonts preloaded, no layout shift, `content-visibility` on long lists.

### Steps

1. One build recipe and the proof. Size M. Needs agreement with Codex.
2. Keep old script files served. Size S.
3. Brotli at build. Size S.
4. Background update in the service worker. Size M.
5. Script map from phase 0, then providers on demand. Size L.
6. Heavy widgets on demand, `optimizePackageImports`. Size M.
7. Shell from the device. Size M. Depends on workstream 2 tier 1.
8. Last screen copy and stitch. Size L.
9. Identity at launch. Size M. Depends on Tim's decision.
10. React Compiler rollout. Size M.
11. Dictionary differences for updates. Size M.

### Gate

- Repeat visit: last screen painted in under 300 ms and working in under 1 s, with the network off.
- A deploy of a small change costs a phone under 100 KB.
- A phone on the old build can open every screen during and after a deploy.
- Shared script at or under 120 KB gzip.

### Risks and fallback

- A stale last screen. The device store makes the real screen match it in most cases. Where it does not, the swap is one frame.
- The service worker serving a broken shell. Keep the last two shells and fall back on a failed start. A server switch can tell every service worker to go back to network first.
- The React Compiler exposing code that breaks its rules. Roll out by folder, with the lint rule first.

## 10. Workstream 5. Shrink every byte on the wire

### Today

HTTP/3 and edge caching of script are already in place. The waste is in polling, in gzip, and in the same data being fetched again and again.

### Design

**One live stream.** A single `/api/live` stream carries short messages: this topic changed, at this version. Topics are a job, a list, a chat, the company. The device then pulls the difference. It replaces the 4 existing streams and about 29 polling queries.

- Server side: Postgres `LISTEN` and `NOTIFY` fan out inside the web process. That is enough on one machine and still works on several.
- A heartbeat every 25 s keeps Cloudflare from closing it.
- Reconnect with backoff and resume from the last message seen.
- Pause after the app is hidden for a while. Catch up with one pull on return.
- Dialogs that poll every 2 s for a pending result listen on the stream instead.

**Fewer requests.** One pull at start brings all first-screen data. No request waits on another.

**Smaller answers.**

- Brotli for script, as in workstream 4.
- Sync answers are differences already. Plain JSON with zstd is enough. A binary format is added only if parsing shows up in the field numbers.
- A trained compression dictionary for sync answers where the browser supports it. Honest note: after the stream and local data, script and drawings are where the bytes are. Dictionaries matter most for script updates and for vector sheet tiles.

**Edge.**

- Early Hints for the shell's first files.
- Drawing files are private and kept for one hour today. Letting the edge hold them needs signed, unguessable, immutable addresses. That is the open "step 4" decision and stays with Tim.

**Images.** Part images at the exact size, in AVIF or WebP, with a tiny placeholder. `public` holds 52 MB today.

**Uploads.** Shrink photos on the device before sending. Not slip photos until the slip benchmark shows no loss in reading.

### Steps

1. `/api/live` with topics, heartbeat and resume. Size M.
2. Move the 4 streams onto it. Size M.
3. Remove polling site by site, busiest first. Size L.
4. One pull at start. Size M. Depends on workstream 2.
5. Images. Size M.
6. Early Hints. Size S.
7. Dictionary for sync answers. Size M. Only if the field numbers justify it.

### Gate

- An idle app makes no request for ten minutes apart from the heartbeat.
- A change on one device shows on another in under 1 s on the Site link.
- Requests to a working first screen: half of the phase 0 number.

### Risks and fallback

- A dropped stream going unnoticed. The device pulls once on every return to the app and on every reconnect.
- More than one server later. `NOTIFY` still works. A shared channel is a later step.

## 11. Workstream 1. Drawings that never blur

The moonshot. It runs beside the other work and starts with a spike that can stop it cheaply.

### What it adds over today

Since 0b3a8ef6 a sheet seen before is sharp 0.32 s after a pinch. The vector path adds four things:

- Sharp in every frame of the pinch, with no sharpen step at all.
- Far fewer bytes before a new sheet is readable, because the first view needs only the coarse level.
- Much less processor and battery, because the graphics chip draws and nothing is rasterised again per zoom.
- New abilities: exact snap for measuring, text search across a set, layer switches, comparing two revisions by geometry.

### Step 0. The spike

One week. It decides go or stop.

On 50 to 100 real sheets, measure:

1. The mix of drawing operators: strokes, fills, text, images, shadings, patterns, clips, transparency.
2. Paths and segments per sheet.
3. Size after our encoding, at full detail and for the first view.
4. Time pdf.js takes to rasterise each sheet on the reference phone at three zooms. This is the cost we would remove.
5. How close a quick prototype render comes to today's raster.

**Go if:**

- 85 percent of sheets compile with nothing unsupported.
- Median full-detail size is at or under the median page PDF, 610 KB.
- Median first-view size is at or under 150 KB.
- A dense sheet draws in under 8 ms per frame on the reference phone.

My size estimates are 40 to 70 percent of the page PDF at full detail and 5 to 15 percent for the first view. They are estimates. An earlier figure I gave of "a few hundred KB" is not proven either. The spike replaces all of them.

The spike needs real sheets. Either Tim approves reading a sample from production uploads, or Tim supplies a folder of sample sets.

### Design

**The compiler.** Input is the per-sheet PDF that the server already splits out with qpdf.

1. Interpret the page into a display list: fills, strokes with width, cap, join and dash, text runs, images and clips.
2. Normalise: page coordinates, sRGB colour, layers kept as layer ids.
3. Find repeats. A valve symbol drawn 300 times is stored once and placed 300 times. This is a large saving on CAD sheets.
4. Text: each distinct glyph outline stored once per font and placed by position. The text itself is kept with positions for search.
5. Levels of detail, like map tiles. The top level is the whole sheet in one tile with detail under a third of a pixel dropped and dense hatching merged to a flat tone. Each level below doubles the detail.
6. Encode: coordinates snapped to a 13 bit grid per tile, stored as small differences, grouped by style, then compressed at the highest level.
7. Package: one immutable file per sheet with an index at the front. The device asks for the index and first view in one request, then for tiles by byte range. One file per sheet fits the kept store in `src/lib/drawing-kept.ts` as it is.

Language. Prototype the front of the compiler in TypeScript on pdf.js operator lists, because `pdf-line-geometry.ts` already walks them. Once the format is settled, write the production compiler in Rust as `native/sheetc`, with pdfium for parsing. pdfium's licence is permissive. MuPDF's is not, so it is out. A general new programming language would not make the app faster. This compiler and its file format are the right size of invention.

**The fidelity check, per sheet.** After compiling, render the result without a screen and compare it with today's raster at two zooms. Pass means structural similarity of 0.98 or more per tile and ink coverage within half a percent. A sheet that fails, or that uses anything unsupported, is marked and stays on today's path for good. Unsupported at first: gradients, tiling patterns, soft masks, blend modes, Type 3 fonts. Scanned sheets are images and belong on today's path anyway.

**The renderer.**

- WebGL2 as the base, since every phone has it. WebGPU later, where it helps.
- Strokes: one instanced quad per segment, joins and caps computed on the chip, width in screen pixels with a floor of one device pixel so hairlines never vanish.
- Fills: triangulated by the compiler.
- Text: glyph meshes placed by position, skipped when smaller than a pixel.
- Pan and zoom change one transform. No geometry is sent again. That is why every frame is sharp.
- A memory cap on the chip, oldest tiles dropped first. Recovery when the browser takes the graphics context away, which iPhones do in the background.
- Markups, measurements and pins stay in their present layer on top, using the same transform.

**In the viewer.** A new `DrawingVectorLayer` beside `DrawingTileLayer` and `DrawingPdfLayer`, chosen per sheet by a flag in the sheet's manifest. One small change in `DrawingSheetViewer.tsx`. Everything else is new files.

**On the server.** Compile on first open, the same way the per-sheet PDFs are split in `src/server/rooms/page-pdfs.ts`, plus a backfill script. That keeps it in the web build with no worker release. Compiling at upload time can come later with a worker release.

### Steps

0. Spike. Size L. Needs sample sheets and the Rust toolchain decision.
1. Display list and normalising in TypeScript, with a viewer for the list. Size L.
2. File format, levels of detail and encoder. Size L.
3. Renderer: strokes, then fills, then text. Size XL.
4. Fidelity check and fallback marks. Size L.
5. Viewer layer, kept store and server route. Size L.
6. Rust port of the compiler. Size XL.
7. Rollout by company with field timings, then snap, search and layers on the vector data. Size L each.

### Gate at each step

- After 2: sizes meet the spike's numbers on the full sample.
- After 4: no sheet that passes the check shows a difference a person can see, judged by eye on 50 sheets.
- After 5: on the reference phone, pan and zoom hold 16.7 ms at p99, and a new sheet on the Basement link is readable in 3 s.
- Rollout: fallback rate under 15 percent, no rise in viewer errors from the field.

### Risks and fallback

- **Size does not beat the PDF.** The spike catches this in week one. The first-view saving may still justify it. If neither holds, stop.
- **A drawing that looks subtly wrong.** On a construction drawing that is a safety matter. The per-sheet check is strict, the fallback is permanent, and the PDF stays one tap away as the reference.
- **Odd PDFs.** Expected. They stay on today's path.
- **Overlap with Codex**, who is working on zoom prediction, render planning and the offline store. Saving vector files for offline use touches their code. Agree the hand-off before step 5.

## 12. Workstream 6. Do the work at save time

### Today

The server is fast at today's size. This workstream keeps it fast as companies grow, and it makes sync pulls cheap. It is not where the time goes now, so it comes after measurement.

### Design

1. **Find the slow reads.** Rank procedures by total time and p95 from the server timing in phase 0.
2. **Cheap fixes first.** Indexes and query shapes for the top ten, checked with `EXPLAIN` on a copy of the database.
3. **Stop repeating the access check.** The layout and each call work out who the person is and what they may do. Keep that answer in the process for a short time and drop it when a role changes.
4. **Screen-shaped rows.** For the hottest screens, one stored row per screen instance, written in the same transaction as the change: job summary, material list view, documents tree, receiving board. A read is one lookup by key.
5. **Version counters per topic.** One counter per job and per list, bumped on every write. A pull that finds its counter unchanged answers at once. The live stream sends the same counter.
6. **More at upload time.** Thumbnails, tiles and slip reading already happen then. Add the vector compile and the search text.

### Steps

1. Ranking report. Size S.
2. Top ten query fixes. Size M.
3. Access check reuse. Size M.
4. Version counters. Size M. Database change.
5. First two screen-shaped rows, with a check that compares them against the live query every night. Size L. Database change.

### Gate

- Read p95 under 20 ms at the server.
- An unchanged pull answers in under 5 ms.
- The nightly comparison finds no difference for two weeks before a screen reads from its stored row.

### Risks and fallback

- A stored row that drifts from the truth. The nightly check and a rebuild command cover it. The live query stays as the fallback.
- Every item from step 4 on needs a database change. Each is asked for separately. Migration 0096 is still pending and is not part of this.

## 13. Workstream 7. A speed law

Phase 0 builds the instruments. This workstream makes them binding.

### Design

**Budgets in one file**, `perf/budgets.json`, with a row per measure in section 2 and per screen.

**Three layers of checking.**

| Layer | What | When | Blocks |
| --- | --- | --- | --- |
| Static | script per screen, shared script, changed files, image sizes | after dev deployment, per review batch | production promotion |
| Lab | eight journeys at three links and 4x slowdown, 15 samples per cell | after dev deployment, when free | production promotion |
| Field | real phones, by build | always | raises a flag after a deploy |

**The rule.** A change that worsens a budget fails unless the same commit raises that budget on purpose with a line saying why. Budgets only move toward the targets otherwise. After each phase the budgets are tightened to the new numbers.

**Lint rules** that keep the gains:

- no screen change from a raw `onClick`
- no polling once the stream exists
- no write on a hot screen that waits on the server
- no new provider in the shared layout
- no image without a size

**Dev deploy chain.** Merged source, scoped tests/type checks, canonical build, one deploy lock, health checks and automatic health rollback. Record every switch in the review queue. Dev preempts timing; preserve completed evidence and mark the interrupted run spoiled for repetition.

**Production promotion.** The full calibrated timing and unchanged byte gates must pass for a reviewed batch with no open serious finding. Dev review findings become tasks, not automatic rollbacks. Escalate a broken journey or a journey more than 25% slower on two independent runs to Tim for a rollback decision. Move the review baseline to the reviewed build after each batch.

**For the people building.** A small overlay in development that shows tap to paint and dropped frames live.

**A real phone.** One cheap Android phone on a cable to this machine gives nightly runs on real hardware. Optional.

### Steps

1. Static budgets and the script. Size S.
2. Dev review queue and batch measurements; full gate before production promotion. Size M.
3. Field report by build, with a flag on regressions. Size M.
4. Lint rules, added as each workstream lands. Size S each.
5. Development overlay. Size S.

### Gate

- A planted regression of each kind is caught: 30 KB of added script, 100 ms added to a tap, a new poll.
- The lab gate gives no false alarm in 20 runs of an unchanged build.

### Risks and fallback

- Noisy timings blocking good work. Timings run on this machine, with medians and a noise band. Shared runners check bytes and counts only.
- A law that people route around. The override is one explicit line in the same commit, so it is visible in review.

## 14. Sequence

**Phase 0. Measure.** About a week.

- Field timing, server timing, seeded lab, journeys, script map, press audit.
- In parallel: the drawing spike, if Tim approves sample sheets.

**Phase 1. Instant feel.** About three weeks. No database change.

- Workstream 4 part A: one build recipe, old files kept, brotli, background update.
- Workstream 3 steps 1 to 5: press primitive, registry, no round trip for a seen screen, job tab host.
- Workstream 2 tier 1: persisted cache and the first 20 instant writes.
- Workstream 5 steps 1 to 3: the live stream, no polling.
- Workstream 7 steps 1 and 2: static budgets, dev review queue and the production promotion gate.

What a person feels after it: every screen they have seen opens at once, presses answer on finger down, common changes show at once, updates stop costing data.

**Phase 2. Works with no signal.** About six weeks. Database changes, asked one at a time.

- Workstream 2 tier 2: job detail, material lists, receiving, chat.
- Workstream 6: version counters, the first screen-shaped rows.
- Workstream 4: shell from the device, last screen at launch, script diet.
- Workstream 3: prediction, View Transitions, back restore.

What a person feels: the app opens on the last screen before they can blink, and a whole shift can be worked in a basement.

**Phase 3. Drawings that never blur.** Starts after the spike says go and runs beside phases 1 and 2. About ten weeks.

**Phase 4. Tighten.** Ongoing.

- Budgets ratcheted to the targets.
- React Compiler everywhere.
- Dictionary differences for updates.
- Images.
- Drawing workspace data and timesheets on tier 2.
- Snap, search and layers on vector sheets.

The week counts are rough and assume one stream of work per track.

## 15. Working beside Codex

- Codex is active in drawing zoom prediction, render planning and the offline store. Their uncommitted files stay untouched.
- Workstream 1 adds new files and one small change in the viewer. The offline store hand-off is agreed before that step.
- Workstream 4 part A needs both sides to use one build recipe. This is the one place where Codex's way of working has to change.
- Workstreams 2, 3 and 5 touch many screens. They land screen by screen in small commits, rebased on the live head each time, as now.
- The speed law applies to every commit, whoever makes it. That needs Tim's word to Codex.

## 16. Risks across the plan

| Risk | Where | Guard |
| --- | --- | --- |
| Wrong data after a merge | 2 | convergence tests, per-company switch, server is the authority |
| A drawing that looks wrong | 1 | per-sheet check, permanent fallback |
| A press that fires too early | 3 | destructive actions stay on release, per-screen setting |
| Stale screen at launch | 4 | device store matches it; one frame swap |
| Broken shell served from the device | 4 | two shells kept, server switch back to network first |
| Stored rows drifting | 6 | nightly comparison, rebuild command |
| Two agents colliding | all | small commits, rebase, agreed hand-offs |
| The plan is too big | all | each phase stands alone and ships value; each workstream has a stop point |

## 17. Decisions that are Tim's

1. **Start phase 0 and phase 1?** Recommended. Neither needs a database change, a worker release or new hosting.
2. **Sample sheets for the drawing spike.** Approve reading a sample from production uploads, or supply a folder.
3. **Rust toolchain on this machine.** It installs in the home folder. Needed from the spike on.
4. **Sync engine.** Extend the vendored Replicache. Recommended. The alternative is a new service.
5. **Database changes.** Version counters, screen-shaped rows, and a table for field timings later. Each asked for when reached.
6. **Worker releases.** Receiving on tier 2 changes code in the worker bundle.
7. **Showing the last screen before sign-in is confirmed.** Faster start against a one second exposure on a device whose session was ended remotely.
8. **Fetching sheets a person has not opened.** Still open from before. Linked-sheet preloading waits on it.
9. **Drawing files at the edge.** Still open from before, with the cache lifetime.
10. **One build recipe for Codex and Claude sessions, and the speed law for both.**
11. **A test phone on a cable.** Optional.

## 18. The first week, if approved

1. Field timing and server timing, deployed. Real numbers start arriving the same day.
2. The seeded lab and the first four journeys.
3. One build recipe, proved by a matching build, plus old files kept and brotli. These three end the 2.74 MB redownload and the 404s.
4. `usePress` on the bottom bar, the job tabs and the jobs list.
5. `staleTimes` and the service worker change, so a screen seen before opens with no round trip.
6. The baseline table, then the same table again at the end of the week.
