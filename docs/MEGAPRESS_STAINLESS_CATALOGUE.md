# Viega MegaPress Stainless catalogue addition

Source checked 2026-11-04 against Viega's US manufacturer article tables:

- [MegaPress 316 (EPDM)](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-316.html): 163 articles.
- [MegaPress 304 FKM](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-304-FKM.html): 159 articles.
- [MegaPress 316 FKM](https://www.viega.us/en/products/Catalog/Metal-systems/MegaPress-316-FKM.html): 170 articles.

492 articles across 88 model pages, in published nominal sizes from 1/2 through 4 inches. Includes elbows, tees, adapters, flanges, caps, unions, couplings and reducers. This adds the fitting ranges listed above; valves, pipe, tools and supplier prices are outside this import.

## Catalogue placement

Plumbing → Press → MegaPress Stainless 316 (EPDM), MegaPress Stainless 304 (FKM), or MegaPress Stainless 316 (FKM) → size → Fitting.

Each record preserves the manufacturer article number, model, source URL, steel grade, seal material, connection dimensions, published article table values and any limited-availability note. Search aliases include Viega, MegaPress, Mega Press Stainless and MegaPress SS. Size combinations come only from actual article rows; no inferred combinations or prices. Source quantity is retained as manufacturer table data, not interpreted as the app's ordering unit or packaging.

60 unique manufacturer product photos are shared across the 88 models and their sizes. Images use the largest URL advertised in the manufacturer's image srcset, converted to WebP without upscaling, and are served through the existing catalogue image API.

## Repeatable import

1. Build with `python scripts/catalogue/build-megapress-stainless.py` in a Python environment with requests, beautifulsoup4 and Pillow.
2. `node scripts/import-megapress-stainless.cjs --validate-only` checks article uniqueness, family/seal/grade, source URLs, row counts and image hashes.
3. `node scripts/import-megapress-stainless.cjs` performs a read-only dry run against the configured database.
4. Copy the manifest's image files to the live application's matching public upload directory, then run `node scripts/import-megapress-stainless.cjs --apply`.

The default import target is Tim's existing organization account; `MEGAPRESS_STAINLESS_IMPORT_USER_EMAIL` may explicitly select another account. Application is additive and transactional, with an organization-scoped lock, stable IDs and a backup receipt. A repeat application creates zero parts. Conflicting pre-existing names or article numbers stop the import for review. Existing parts, suppliers, prices, lists and orders are not modified. Normal database triggers advance the catalogue sync revision.

## Verification

The read-only dry run planned 492 new parts and found no matching existing articles. All source rows and photo hashes passed validation. Sampled 1-inch elbows match published article numbers 90015 (316 EPDM), 95015 (304 FKM) and 91705 (316 FKM).

Repository typecheck currently reports existing errors in `scripts/import-megapressg.cjs` and two DrawingWorkspace test locators; no new TypeScript application code is part of this catalogue addition. The standalone importer uses runtime validation, consistent with the existing catalogue import scripts.
