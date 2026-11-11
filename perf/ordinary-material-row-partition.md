# Ordinary material row partition — later candidate

Only `!verifyMode && !item.sentOrderItemId && !item.sentOrder` selects the ordinary
component. All sent or receiving rows retain the original receipt controller.
The controller lifecycle prefix is unchanged except moving its presentation-only
quantity parse. Stateless photo/badge/menu/editable-field markup is shared, rather
than duplicating the receipt component. No screen receipt helper, public props,
list/item keys, account context or draft ownership was moved.

The ordinary branch keeps workspace-local quantity/supplier/deletion behavior and
sync status, but mounts no receipt state, queued intent or hold/picker listener.
Unsent rows entering receiving initialize saved values through the old controller;
leaving cancels ephemeral receipt click/hold work through its existing unmount
policy. Ordinary prop refresh keeps QuantityControls mounted and its pending local
draft; account-key remount cannot retain the old draft/timer.

Static source counts exclude 14 receipt refs, four states, two layout effects and
two passive effects per eligible row. For the synthetic 24 ordinary rows that is
336 refs, 96 states and 48 registrations of each effect class. These are **source
counts**, not measured callback invocations, render cost or speed savings.

39 focused tests in six files pass, including durable quantity/draft refresh,
pack/tool/supplier delegation, real menu deletion single-flight, sent fallback,
StrictMode transitions, pending receipt cancellation, hold-listener cleanup and
account-key remount. Scoped ESLint has zero errors/warnings; owned paths have no
type errors, while global TypeScript still fails on unrelated repository paths.
The raw-navigation gate and diff checks pass. Exact source hashes/counts and
validation are in [the evidence](artifacts/ordinary-material-row-partition-2026-11-11.json).

No static-byte build or timing run occurred. The dispatcher/presentation also add
React boundaries; net cost is unknown. R11 remains immutable and excludes this
later candidate. Failed full gates remain unchanged, and no production change or
activation is authorized by these functional/source checks.
