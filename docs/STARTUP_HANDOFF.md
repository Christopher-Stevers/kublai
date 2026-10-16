# Startup handoff

Android/browser owns the installed-app native splash; the web app cannot remove
that static frame. The first HTML shell now renders the animated loader before
session/provider/route hydration, using the manifest's #111827 background and the
same preloaded 192px PNG directly. The centred 96px logo never fades or scales in
from transparent. Only the surrounding trade tools animate into view.

StartupHandoff retains that cover while a visible route-loading fallback exists
or real page content is absent. Once ready, it waits two animation frames so the
page can paint underneath, releases pointer events and fades the cover out over
200ms. It does not wait for the orbit animation or impose a minimum loading time.
Reduced-motion settings remove the exit wait. This also avoids introducing an
image-optimizer request between the native splash asset and the animated loader.

Validation: three lifecycle tests (pending route, script-only stream, fast route),
typecheck, focused lint, production build and a Chromium visual fixture with
hydration/route readiness deliberately delayed. Across sampled frames the logo
remained fully opaque and centred at 96x96; tools animated without JavaScript,
and the cover disappeared only after ready content painted. The native Android
splash handoff itself still needs confirmation on the user's installed device.

## React ownership regression

The cover is rendered and removed by StartupHandoff's React state. Never call
DOM remove() on that React-owned node: streamed onboarding/navigation updates may
still use it as an insertion anchor. The original imperative removal caused a
confirmed insertBefore NotFoundError on Android. A regression test reproduces
insertion of a new sibling after the cover exits, and a hydrated Chromium test
verifies the same transition and navigation. Both failed/passed as appropriate
before and after replacing imperative removal with React state.

## Startup only

The root layout owns the startup animation for the lifetime of the open app.
Route loading fallbacks use a small inline status instead, so navigating between
screens never replays the full-screen animation. The initial handoff still waits
for that route status to clear. A lifecycle regression covers initial pending
content followed by another pending route after startup has finished.
