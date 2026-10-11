# Simulated part costs — 2026-10-11

The current FormanHQ catalog now has a positive CAD cost for every part. These are illustrative estimates for testing future pricing, not researched market prices or supplier quotations.

## Applied data

- 6,712 catalog parts covered, including all 6,031 active parts.
- Tim's Organization: all 5,997 parts covered.
- 6,711 supplier listings received estimates; two existing positive supplier prices were preserved exactly.
- 656 missing material-list item costs filled; 59 quote/material-list totals recalculated using the existing markup and supplier order-multiple rules.
- All 170 orders and 1,126 saved order items remained byte-for-byte equivalent in the database.
- No catalog names, quantities, purchase multiples, or SKUs changed.

Prices vary with material, nominal diameter, fitting type, and item type. Copper, press fittings, specialty DWV materials, large fittings, and equipment have higher allowances than common plastic fittings or small fasteners. Small deterministic variation keeps identical parts consistent across runs and organizations.

## Units and assumptions

- Fittings, valves, supports, fixtures, and tools: per item.
- Pipe: per listed stick or coil. The name takes precedence if an older description gives a different length. Unspecified lengths use a documented standard-length assumption.
- Hardware in named boxes: per base piece, consistent with the existing purchasing model; this operation does not change the supplier's minimum/order multiple.
- Adhesives, primers, oil, and other consumables: per listed container or roll.
- Tax, freight, and markup are excluded from catalog estimates; existing quote markup is applied separately.
- Twenty-nine estimates use an explicitly recorded assumption, mostly unspecified pipe lengths, three malformed imported sizes, and two unrecognized test items. No source catalog data was changed to conceal these assumptions.

Generated supplier and item notes carry `[foremanhq-estimate-v1-2026-10-11]`, `SIMULATED ESTIMATE ONLY`, the price basis, and any assumptions. Replace the cost through the normal supplier/part editor when verified pricing becomes available, and update the estimate note when adopting a real supplier quote.

Thirty-four original demo supplier listings referenced a different organization's supplier. They retain their listing IDs and purchase rules, but now reference a clearly named local `Simulation pricebook (CAD)` with no ordering contact. Two original demo material-list lines have foreign catalog references and no supplier: only their estimated costs were filled, without adding cross-organization supplier links. Those original catalog references remain a separate data-cleanup task.

## Reusable command

```sh
node scripts/seed-simulated-part-costs.mjs         # inspect a proposed fill
node scripts/seed-simulated-part-costs.mjs --apply # fill missing costs only
node --test scripts/lib/simulated-part-cost.test.mjs
```

The script covers the current database's catalogs, including inactive parts. It never replaces positive costs, reassigns existing valid suppliers, edits order snapshots, or sends messages. New unassigned parts use the organization's existing external supplier, preferring Next for plumbing and Fastening House for hardware. Organizations without an external supplier receive the simulation pricebook.

Application happens in one database transaction with row locks, a bounded lock timeout, a unique advisory lock, and coverage verification before commit. A private backup is written before mutation under `.tmp/simulated-pricing/`; it includes original changed rows, new row IDs, and the applied field values for selective recovery. Backups and per-part reports are intentionally excluded from Git. Never restore over later user edits without comparing their current values to the recorded applied values.

## Validation

- Seven focused tests passed, covering diameter conversion, malformed sizes, pipe lengths/coils, fitting/material cost differences, hardware base units, mislabeled pipe accessories, and estimate labeling.
- Zero unpriced catalog parts, supplier listings, or material-list items after commit.
- Zero supplier listings with inconsistent organization ownership after commit.
- All 59 recalculated totals match the sum of rounded purchase line totals and existing markup.
- Original positive prices and saved order contents independently verified unchanged.
- Subsequent dry run proposes zero changes.
- Public tunnel health check confirmed database access. These are database updates; no application build or service restart was required.

Reload FormanHQ to refresh any prices already cached in the browser.
