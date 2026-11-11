# Raw navigation speed-law gate

`node scripts/check-navigation.mjs [source-root]` rejects new or changed raw JSX
`onClick` navigation, implementing speed-plan §7 step 9. `pnpm lint` runs it before
the existing ESLint debt check. The canonical release builder runs it against its
actual source directory before copying/building release outputs, and again in
the canonical child. There is no runtime behavior change or automatic conversion.

The TypeScript AST follows a handler's same-file function and variable references.
It recognizes router `push/replace/back/forward`, workspace `navigate`, browser
location/history/window opening, and the named navigation/screen-state conventions
listed in `raw-navigation.mjs`. Router hook aliases are recognized. Proper imports
of shared `Button`, `PressableCard`, and Next `Link` (including local aliases and
relative imports) are allowed; a component merely named `Button` is not exempt.
The rule examines custom components as well as intrinsic DOM tags. Non-navigation
writes and keyboard-only handlers remain outside this rule; it never changes
activation timing, keyboard behavior, confirmation or destructive operations.

`baseline.json` records the precise preexisting debt from tracked commit bytes,
including commit provenance, path, tag, token/dependency digest and allowed count.
Lines are review aids, not identities. Whitespace/comments and line shifts pass;
a new handler in an old file, extra copy, moved path, changed named handler or
changed referenced destination fails. Deleted paths/handlers need no waiver.
Unused entries do not authorize a different hash. No file or component has a
blanket exemption. The inventory is deliberately more conservative than the
historical heuristic `perf/press-audit.mjs`; its counts are not interchangeable.

For a necessary exception, review a **single exact digest/count** and use category
`keyboard`, `destructive`, or `manual` with a specific written reason. For example,
a navigation that must remain behind a confirmed destructive operation must
explain the confirmation and why the primitive cannot preserve that contract.
Existing entries use `preexisting`; this documents debt rather than certifying
keyboard/accessibility behavior or grandfathering future edits. Do not regenerate
the baseline to make CI pass. Prefer the shared primitive; review any baseline
change as code. There are no inline blanket disable comments or auto-update flag.

Static limitations: this is a narrow syntax/API law, not proof that every
application-defined callback changes screens. It does not execute handlers,
follow arbitrary imported helper implementations, infer unknown callback/state
names, inspect dynamic computed calls or expand JSX prop spreads. Such navigation
still needs review and the shared registry/press contract. The exact handler hash
makes a recognized existing handler edit reviewable but is not a full call-graph
security boundary. Tests are tooling checks, not measured navigation speed.

```sh
node --test scripts/navigation/raw-navigation.node-test.mjs
node scripts/check-navigation.mjs
```

Verification on 2026-11-11: the initial tracked inventory and frozen canonical R8
source both pass without modifying their source/runtime. The baseline covers 32
existing handlers in 30 exact digest groups. The current gate does not certify
R8's failed/partial performance gates or authorize activation.
