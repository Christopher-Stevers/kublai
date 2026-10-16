# Startup handoff

Android/browser owns the installed-app native splash; the web app cannot remove
that static frame. The first HTML shell now renders the animated loader before
session/provider/route hydration, using the manifest's #111827 background and the
same preloaded 512px PNG directly. The centred 144px logo never fades or scales in
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
remained fully opaque and centred (originally 96x96); tools animated without JavaScript,
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

## Enlarged animation — 2026-10-16

The central logo is now 144px on normal portrait phones/tablets, with the ring,
tools, title and progress indicator enlarged around it. The composition uses
`min(90vw, 62vh, 24rem)` and reduces the centre icon on very small/short screens,
so it stays centred and visible. The 512px asset is preloaded for sharper Retina
rendering. Browser viewport checks cover portrait, landscape, small phone and
tablet sizes, including hydration, the fade and subsequent navigation. Android's
native splash size is OS/browser-controlled; matching the user's actual cover
still requires a device check.
