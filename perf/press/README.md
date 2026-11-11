# Press primitive verification

`node perf/press/run.mjs` builds an isolated production React fixture from the current `usePress`, `Button`, and `PressableCard`. It drives actual Chromium touch events through 200 scrolling gestures, checks no row opens, and confirms each preparation is aborted. It also checks a fixed control's touch/compatibility click activates once, keyboard Enter still works, and a default write waits for release and executes once. It uses `/usr/bin/chromium` unless `CHROMIUM_PATH` is provided, binds only a temporary loopback server, and removes its generated bundle afterward. No production data or mutations are involved.

This verifies primitive behavior with desktop Chromium touch emulation. It is not the eight-journey app lab, a physical phone/Safari check, a screen-reader certification, or evidence of the `<100 ms` p95 gate.

Focused tests:

```sh
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/hooks/use-press.test.tsx src/routes/registry.test.ts
node perf/press/run.mjs
```

Node 26's experimental global `localStorage` conflicts with some existing JSDOM suites; the flag restores their browser storage setup. It does not change the app.

Only explicitly reviewed view controls use `press="fixed"`. The shared Button defaults to release; destructive variants and Slot children retain release. Scroll cards prepare on pointer down and execute through the normal click path, cancelling on motion, scrolling, pointer cancel and blur. Nested controls retain their own actions. A capture guard prevents the compatibility click from activating a newly mounted target after fixed navigation.

The route registry uses the existing local job reader and material-list IndexedDB records, and imports real screen modules. It never sends a write or fetches private remote chat/drawing contents as preparation. Dynamic imports and an IndexedDB transaction already in progress cannot be cancelled; abort prevents later preparation stages. No private preparation result is retained by the registry.

Existing job workspace choices are cards inside a scroll area, so they remain release controls. A stateful job tab host, hidden-panel retention, route payload policy, prediction and transitions are separate work. The measured eight-journey baseline must finish before its harness adopts the new shared registry or produces after evidence. No app release is activated by these tests.

On 2026-11-11, drawing folder and sheet cards adopted the existing
`PressableCard` primitive. This supplies press feedback and scroll cancellation;
it does not fetch unopened drawings or change rendering. All 41 tests in
`JobDrawingsView.test.tsx` passed, including scroll-then-tap and nested favorite
and folder-menu checks. Scoped lint found the same eight existing test errors
and three production warnings as committed HEAD; no new diagnostics. The
primitive itself was unchanged, so its earlier Chromium verification was not
rerun. Physical-phone timing remains unverified.
