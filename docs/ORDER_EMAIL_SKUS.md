# Supplier SKUs in order emails

Supplier SKUs are omitted by default. The order email preview has an Include
supplier SKU checkbox directly above its body, both in material-list order
previews and in Orders. Each supplier's three-dot menu offers Include supplier
SKU in my order emails. Both use the same preference.

Preferences belong to the authenticated user and supplier, stored server-side
with an organization scope (migration0077). They apply across devices and to
collapsed previews as well as expanded ones. New suppliers default off. They do
not change catalogue SKUs, ordering records or another user's preferences.
Preference reads and writes include the expected authenticated account to reject
stale requests after an account change. Writes validate supplier ownership.

Toggling modifies only exact generated item lines in the draft, preserving typed
notes, greetings and subject edits. Item quantity/pack formatting is unchanged.
Supplier SKUs remain in the stored order snapshots for matching and history.
