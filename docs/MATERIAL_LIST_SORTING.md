# Material-list sorting

Choose the sort order in Settings → Material lists. Dashboard workspace lists and dedicated material-list pages apply this preference automatically in grid and table views. Lists do not display a sort selector.

- Default: catalog name, material name, nominal size ascending, category name, then part name.
- Supplier: supplier name, then the default ordering. Unassigned suppliers appear last.
- Recently added: creation timestamp descending; editing quantity does not move an item to the top.

The choice is stored on the current device under `foremenhq.material-list-sort`. Sorting changes display order only and does not mutate list records, prices, quantities, quotes or orders. New and synced items are sorted automatically.

Sorting uses the cached catalogue's material and dimensions where available, with item snapshots and leading unit-marked sizes as fallbacks. Fractions and mixed fractions are interpreted numerically; mm/cm dimensions are converted for comparison. Categories use actual catalogue category names, with missing categories last within each material and size. Names use natural alphabetical ordering; there is no fitting-type classification or priority. Unknown materials and sizes sort last within their respective comparison level. This needs no AI calls or internet connection.

Implementation: `src/lib/material-list-sort.ts`, `src/hooks/use-material-list-sort.ts`.

Validation: eight sorting unit tests, TypeScript and production build, plus browser verification on the dashboard material-list path: mobile and desktop rendering, changed row order, all options, persistence after reload, and offline selection. No list data was edited by browser checks.

The Add menu applies the same comparator before pagination in both grid and table part views, including search results and cached offline parts. Parts not yet added have no list supplier or added-to-list date, so Supplier and Recently added use the catalog/material/size/category/name fallback here. Catalogue management retains its explicit reorder behavior.

Settings → Material lists → Name keyword priority provides ordered, editable comma-separated keyword groups, with add/remove and move up/down controls. Groups start empty; users can load examples explicitly. The first matching group wins after material, numeric size, and actual category. Matching ignores case, normalizes punctuation, and matches whole words/phrases. It does not infer synonyms; users include their own alternatives in a group. Unmatched names follow matched names; names within a group use natural alphabetical ordering. Empty keywords are ignored. The same rules apply in Add menu search, grid/table views, and offline data. Rules save on the current device as `foremenhq.name-sort-keywords` and update mounted views through a preference event. Clearing all groups restores alphabetical name sorting.

Each keyword group now has Includes and Excludes comma-separated boxes. A group matches at least one Includes term and no Excludes terms; exclusion takes precedence for that group only. A rejected part may match a later group, otherwise it sorts with unmatched parts. Exclusions never remove parts. Old string-based preferences load into Includes with Excludes empty, preserving prior order.

On 2026-09-22 the owner requested copying their nine screenshot groups to all accounts: 90; 45; Coupling; Wye; TY, tee; Adapter, adaptor; Reducing; Fitting; Flange. Exact exclusions are in `src/lib/name-keyword-defaults.ts`. The shared app rollout installs this list once on each device when it loads the update, backing up any previous local groups first. New installations get the same groups. Later local edits remain editable and are not overwritten on reload. This is a one-time copy, not ongoing account synchronization.

Catalog name is now the first level of the default hierarchy in material lists and Add parts. Unknown catalogs sort last. Keyword priorities remain within each catalog/material/size/category group.
