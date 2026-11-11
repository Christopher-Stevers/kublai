# Quantity button attribute feedback (prepared)

The four ordinary QuantityControls +/- buttons opt into hook-owned
`data-pressed` feedback through optional `Button.pressFeedback="attribute"`.
Button defaults to `state`; the prop is consumed before DOM spreading. Quantity
buttons still activate on native release/click. Quantity/input/save/retry logic,
PackQuantityControls, LargeButton and all other Button consumers are unchanged.
No new CSS or fixed/down activation is introduced.

The existing reviewed R8 hook feature is reused unchanged. Current hook bytes
exactly match `25d590c9`; frozen R18's hook exactly matches that commit's parent.
Future candidate composition must select **only that hook delta**, plus this
commit's Button and QuantityControls files. Never import the R8 JobsClient or
PressableCard changes. Button/Quantity preimages were compared with frozen R18
and match exactly; the frozen files themselves were never edited.

| Future runtime overlay | R18 SHA256 | Postimage SHA256 |
| --- | --- | --- |
| src/hooks/use-press.ts (25d590c9 hook only) | a2df179682c0927a8b589bfd0fee1c9c88e3eee2ee56a1395def2ae8e27f6e80 | e28161945ea26619148916a537bdab1e01b5bacb120cd66a84f80daf94a7e266 |
| src/components/ui/button.tsx | 97924c8dabde09f38b5bcaf232322b46e16c27d2652cc98cee48a4033e65b5fb | 4a03ed88948ecbfa979f0b5db3259c4715c9665d7b9e91112f912b93833dc84b |
| src/components/materialLists/QuantityControls.tsx | e8327ff7be1115aa94e665e6da464521d0d8094ba798cbd45cbec56df450b87b | f8d315f8bde373ee7890ff4def1676d0678d389b85a6a3b2b5af18b8322e2891 |

## Focused evidence

35 tests pass across six files, one worker: two new actual-component suites,
existing usePress gesture/attribute suites, QuantityControls durability and
PackQuantityControls regressions. Actual Button React Profiler observes two
additional commits for the default state's down/up feedback and **zero** for
attribute feedback, while the DOM attribute changes correctly. A parent render
while held preserves the attribute; release, disable, blur and unmount clear it.
The prop does not leak to the DOM.

Both horizontal and vertical real QuantityControls retain release-only behavior:
down/up alone writes nothing; the native click performs exactly one +/- update
and immediate durable-save call before its promise acknowledges. Disabled minimum,
pointer cancellation, movement, scroll and outside release are covered. Actual
Button keyboard/assistive click behavior is checked with explicit click events
because JSDOM does not synthesize browser keyboard activation. Existing fixed
compatibility and fling coverage ran unchanged; no duplicate browser matrix was
created. An initial new fixture returned its mock from beforeEach (registering an
unintended teardown); the fixture now returns void, with no production fix needed.

Scoped ESLint has **zero new findings**. Exact R18 baseline reproduces the existing
QuantityControls set-state-in-effect error at line 56 and the unused LargeButton
asChild warning (line shift only). Both new tests have zero lint findings. These
pre-existing findings were not changed to expand this slice.

The work removed is visual-only React state updates in the opted-in hook path;
actual quantity/save state commits remain necessary. The hook still allocates
its state/ref machinery, reads the same release geometry and uses the same
activation/cancellation logic. Hook-owned data-pressed must not be supplied as a
competing React prop. No causal explanation of R18's Office regression, browser
paint/timing improvement, byte saving, canonical build, DB, phone or activation
is claimed. Full candidate source/build/byte and unchanged measured gates remain
required separately.
