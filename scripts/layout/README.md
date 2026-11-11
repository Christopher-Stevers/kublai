# Shared-layout provider speed-law gate

`node scripts/check-providers.mjs [source-root]` implements the speed plan's
shared-layout provider law. Both `pnpm lint` and canonical release-build preflight
run it after the raw-navigation check and before lint/build output work. It makes
no runtime changes and does not build or activate an application.

The initial tracked-source inventory records 35 exact provider imports/usages,
including their layout, wrapper owner, canonical module/export, count and purpose.
Every `src/app/**/layout.ts(x)` is a root; root and jobs layouts are included.
Imports and mounts are counted separately. Named import aliases, relative paths,
local component aliases, namespace mounts, `Context.Provider` and local React 19
context shorthand are recognized. Ordinary components are not providers merely
because they are in a layout. Non-provider local components carrying `children`
are followed, which catches a new provider behind an existing shell (including
contexts such as the existing TutorialGate). Existing recognized provider
implementations remain opaque: splitting the voice engine inside the same
`DevVoiceProvider` module/export is not a new shared-layout boundary.

The baseline is by **identity and count**, not file or implementation hash. A
line/comment shift passes. A new provider, new layout/owner, changed module/export
or additional mount fails. Deletions pass and report removable exceptions.
When removing a mount, reduce its active allowed count by the reported unused
count. When removing an identity entirely, remove its active exception and retain
the exact entry in `retired` with a reason in the same reviewed change. A retired import/usage
cannot be reintroduced without a deliberate policy review; it is a violation.
A stateless source snapshot cannot detect a historical deletion/restoration if
an obsolete active exception was left behind. The retirement ledger is necessary
for that historical guarantee; the gate does not claim to infer Git history in a
frozen release. Never regenerate the baseline to bless new providers. A necessary
new exception requires its exact layout/owner/module/export/count and a specific
written reason. There are no blanket file exclusions or inline disable comments.

Limits: conventions ending `Provider`, `Providers`, or `ProviderWrapper` identify
imported providers. Arbitrarily renamed barrel exports, computed/dynamic element
factories, spreads and hidden providers inside opaque provider implementations
need code review. This is a common-boundary law, not a count of every React context
in the application. It does not certify the cost or correctness of existing
providers. Unknown names and screen-local providers are not globally prohibited.

No polling prohibition is added: live migration/authority coverage is incomplete.
The existing 60-second authority refresh and other uncovered polls are not made
invalid by the presence of `/api/live`. Site-specific polling gates need an
accepted migration contract first.

```sh
node --test scripts/layout/shared-providers.node-test.mjs
node scripts/check-providers.mjs
```
