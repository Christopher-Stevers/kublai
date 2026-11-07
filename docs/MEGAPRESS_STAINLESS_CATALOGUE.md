# Viega MegaPress Stainless catalogue addition

Source checked 2026-11-04 against Viega's US manufacturer article tables:

- [MegaPress 316 (EPDM)](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-316.html): 163 articles.
- [MegaPress 304 FKM](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-304-FKM.html): 159 articles.
- [MegaPress 316 FKM](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-316-FKM.html): 170 articles.

492 articles across 88 model pages, in published nominal sizes from 1/2 through 4 inches. Includes elbows, tees, adapters, flanges, caps, unions, couplings and reducers. This adds the fitting ranges listed above; valves, pipe, tools and supplier prices are outside this import.

## Catalogue placement

Plumbing → Press → MegaPress Stainless 316 (EPDM), MegaPress Stainless 304 (FKM), or MegaPress Stainless 316 (FKM) → size → Fitting.

Each record preserves the manufacturer article number, model, source URL, steel grade, seal material, connection dimensions, published article table values and any limited-availability note. Search aliases include Viega, MegaPress, Mega Press Stainless and MegaPress SS. Size combinations come only from actual article rows; no inferred combinations or prices. Source quantity is retained as manufacturer table data, not interpreted as the app's ordering unit or packaging.

Names use size, material and basic fitting type, for example `3" MegaPress Stainless 316 (EPDM) No-Stop Coupling`. Descriptions contain only the basic type (`No-Stop Coupling`). Manufacturer model, article number, detailed connections, length and the previous full name are searchable aliases. Male/female, street, reducing, stop and flange-face distinctions stay in basic labels. The provenance phrase “Listed in manufacturer catalogue” is excluded from aliases and availability attributes as well as names/descriptions. Actual limited-availability notes are retained.

60 unique manufacturer product photos are shared across the 88 models and their sizes. Images use the largest URL advertised in the manufacturer's image srcset, converted to WebP without upscaling, and are served through the existing catalogue image API.

## Repeatable import

1. Build with `python scripts/catalogue/build-megapress-stainless.py` in a Python environment with requests, beautifulsoup4 and Pillow.
2. `node scripts/import-megapress-stainless.cjs --validate-only` checks article uniqueness, family/seal/grade, source URLs, row counts and image hashes.
3. `node scripts/import-megapress-stainless.cjs` performs a read-only dry run against the configured database.
4. Copy the manifest's image files to the live application's matching public upload directory, then run `node scripts/import-megapress-stainless.cjs --apply`.

The default import target is Tim's existing organization account; `MEGAPRESS_STAINLESS_IMPORT_USER_EMAIL` may explicitly select another account. Application is additive and transactional, with an organization-scoped lock, stable IDs and a backup receipt. A repeat application creates zero parts. Conflicting pre-existing names or article numbers stop the import for review. Existing parts, suppliers, prices, lists and orders are not modified. Normal database triggers advance the catalogue sync revision.

## Verification

The read-only dry run planned 492 new parts and found no matching existing articles. All source rows and photo hashes passed validation. Sampled 1-inch elbows match published article numbers 90015 (316 EPDM), 95015 (304 FKM) and 91705 (316 FKM).

The final repository typecheck reports existing errors in two DrawingWorkspace test locators (`exact` is not a supported role-query option); no new TypeScript application code is part of this catalogue addition. The standalone importer uses runtime validation, consistent with the existing catalogue import scripts.

Live import completed: 492 new active parts, 2,952 aliases and all 60 unique photos verified through the public image endpoint. All imported fields matched the source manifest. Existing MegaPressG names were preserved. The catalogue sync revision advanced from 15522 to 16017. A second application created zero records and left the revision unchanged. No application restart or rebuild was needed. Browser verification was unavailable because no browser was connected; verification used read-only database queries and public image/health requests.

## Press supplier and label maintenance

`scripts/ops/normalize-press-catalogue.cjs` applies the subsequent request to use Next as the preferred supplier for all 970 Press/Fitting catalogue parts. The 271 Copper Press and Carbon Steel Press parts already use Next and have basic labels. The 207 MegaPressG and 492 stainless articles use the revised manifests and gain unpriced Next listings. Manufacturer article numbers remain aliases/attributes rather than being assumed to be Next's supplier SKUs.

Run without arguments for a read-only preview, then with `--apply` to update. `PRESS_CATALOGUE_USER_EMAIL` selects the organization account; the default is Tim's existing account. The command verifies the six material counts and manufacturer identities, locks the target records, writes a private full backup, updates only requested fields in a transaction, and verifies the result before commit. A changed inventory requires scope review. It preserves images, existing supplier prices/packaging, other attributes and existing aliases, and does not rewrite material-list or order snapshots. A repeat application should report zero changes.

Live maintenance completed on 2026-11-04 UTC: 699 names/descriptions cleaned, 6,722 auxiliary aliases added, 679 provenance-only availability attributes removed, and 699 unpriced preferred Next listings added. All 970 fittings have exactly one preferred supplier, Next. Catalogue revision advanced from 17001 to 17700. Transactional checks confirmed all unrelated part fields, existing supplier price/packaging fields and retained aliases/attributes stayed unchanged. A second application verified zero changes and revision 17700 remained unchanged. The first attempt rolled back on an array-prototype comparison in the verifier; that comparison was corrected before the successful application. Standalone validators and Python compilation passed; repository typecheck still reports only the two previously recorded DrawingWorkspace test-locator errors. This was a data-only update, requiring no application rebuild or restart.
