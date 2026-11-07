# Carbon and stainless weld fittings

Source inventory checked on 2026-11-04. The live import adds 2,268 explicit manufacturer articles:

| Material / connection | Source | Articles | Published nominal sizes | Wall / class |
| --- | --- | ---: | --- | --- |
| Carbon steel butt weld | Weldbend | 754 | 1/2–24 in | 369 STD, 364 XS, 13 Schedule 160, 8 XXS |
| Carbon steel socket weld | Anvil / ASC | 434 | 1/8–4 in | 287 Class 3000, 147 Class 6000 |
| Stainless butt weld | Merit Brass | 827 | 1/2–12 in | 440 Schedule 10S, 387 Schedule 40S |
| Stainless socket weld | Merit Brass | 253 | 1/8–3 in | Class 3000 |

Stainless butt weld includes 412 articles in 304/304L and 415 in 316/316L. Stainless socket weld includes 135 in 304/304L and 118 in 316/316L. The manufacturer explicitly identifies these dual grades; neither unverified low-carbon grades nor unlisted size combinations are inferred.

## Sources and boundaries

- [Weldbend price-sheet download page](https://www.weldbend.com/price_sheet.php) links the [November 2026 workbook](https://www.weldbend.com/PriceSheet_1126.xlsx), effective November 1. All 754 non-flange fitting article rows are included. [Dimensional catalogue](https://www.weldbend.com/catalog.pdf) confirms fitting types, wall designations, standards and family images.
- [ASC forged-steel fittings download page](https://www.asc-es.com/price-sheets/high-pressure-product-coatings/anvil-forged-steel-fittings-and-unions) links [CSF-6.26](https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/CSF-6.26-website.xls), effective June 15, 2026. All 434 rows explicitly marked `SKT/W` are included. UPCs, ten-character part numbers and figure numbers are preserved as identifiers.
- Merit Brass's current [butt-weld catalogue](https://order.meritbrass.com/Catalog/ProductList?CategoryId=5637150929) and [Class 3000 socket-weld catalogue](https://order.meritbrass.com/Catalog/ProductList?CategoryId=5637150858) provide 827 and 253 distinct articles across 42 and 13 populated pages. Every article has a product-detail URL in the manifest. The site's paginator advertises pages beyond the final populated page; those empty pages do not create articles.
- The [Merit stainless catalogue](https://www.meritbrass.com/uploads/docs/PDF/Stainless-Steel-Catalog.pdf) supplies the 10S/40S dimensional convention and the exact Type C MSS SP-43 stub-end drawing on PDF page 79.

The scope is those explicit fitting inventories, not all products a manufacturer might custom-manufacture. Flanges, branch-outlet ranges outside these sources, valves, pipe, threaded-only fittings and other stainless socket-weld classes are outside this import. Manufacturer price columns, stock, lead times and supplier listings are not imported. One article carries the manufacturer's `SUD` code; it remains an uninterpreted source note and alias, not an invented availability statement.

The manifest records source document checksums, worksheet and row references, original manufacturer descriptions, product URLs and individual image provenance. Raw downloads are cached under `.tmp/weld-fittings`; organization data and transaction backup receipts are private and are not committed.

## Catalogue placement and labels

The existing path is retained: **Plumbing → Carbon Steel or Stainless steel → size → Butt-Weld Fittings or Socket-Weld Fittings → part**. The two new category choices separate weld connections before part selection. Existing generic `Fitting` records are unchanged.

Descriptions and display names contain connection sizes, material/grade, wall designation or pressure class, weld connection and fitting type. Examples:

- `2" Carbon Steel Schedule 160 Butt-Weld 90° Long-Radius Elbow`
- `1 1/4" Carbon Steel Class 3000 Socket-Weld 90° Elbow`
- `12" x 12" x 10" 316/316L Stainless Steel Schedule 40S Butt-Weld Reducing Tee`
- `1/8" 304/304L Stainless Steel Class 3000 Socket-Weld 90° Elbow`

Manufacturer names and part numbers appear in searchable aliases and structured attributes, not descriptions. Model/figure numbers and ASC UPCs are also aliases. Straight tees use one equal connection size; reducing tees retain both run sizes and the branch size in run/run/branch order. ASC mixed fractions such as `11/4` are parsed as `1 1/4`, not eleven fourths. STD, XS, XXS and numerical schedules remain distinct; STD is not relabelled Schedule 40 at larger diameters.

Fourteen pre-existing stainless weld fittings were reviewed and retained unchanged. Their broad 304/316 and Schedule 40 labels do not establish the same dual-grade certification, radius or stub-end type as the new manufacturer articles. They are not silently merged or upgraded. Exact duplicate descriptions and manufacturer/article identities stop the importer for review. There are no duplicate new specifications or manufacturer/article keys in the manifest.

## Images

There are 48 unique manufacturer images across 84 source-image mappings, including three engineering drawings. All new articles have an image. Manufacturer family images are representative across sizes and wall/class variants. Original image content is retained without cropping or upscaling and placed inside a square white canvas with margins that preserve the whole fitting under the existing soft-edge display. Existing photos and the shared image component are untouched.

Independent visual review covered all 84 mappings. Three misleading website images were corrected:

- ASC's 2155 half-coupling page shows threads. The verified socket-weld half-coupling photograph from figure 2175 is used as a family illustration, with the substitution recorded in asset notes.
- Figure 2128's website diagram mixes threaded and socket unions. The socket-only figure 2126 union family photograph is used and documented.
- All 28 Merit Type C stub-end articles used a general catalogue collage. They now use the exact Type C engineering drawing extracted intact from PDF page 79. No Type A substitute is used.

The other two engineering drawings show ASC reducer inserts. Images are catalogue illustrations rather than dimensional or grade-identification evidence; the article's specification fields identify the selected part.

## Repeatable build and import

Requirements: Python with requests, beautifulsoup4, Pillow, openpyxl and xlrd; Poppler `pdfimages` and `pdftotext`; repository Node dependencies. Spreadsheet sources are read only.

1. `python scripts/catalogue/build-weld-fittings.py` builds the manifest and image assets from explicit source rows.
2. `node scripts/import-weld-fittings.cjs --validate-only` checks counts, specifications, identifiers, labels, aliases, source URLs and image hashes.
3. `node --test scripts/catalogue/weld-fittings.test.cjs` runs source edge-case and rejection tests.
4. `node scripts/import-weld-fittings.cjs` makes a read-only preview against the configured database.
5. Copy only the manifest's assets to the live upload directory, then run `node scripts/import-weld-fittings.cjs --apply` from the live app directory.

The default target is Tim's existing organization account; `WELD_FITTINGS_IMPORT_USER_EMAIL` can select another explicit account. The importer uses stable IDs, an organization-scoped advisory lock, a transaction and a private backup receipt. It inserts new definitions, attributes, aliases and assets. It does not rewrite existing parts, image URLs, prices, suppliers, orders or material-list snapshots. Concurrent upgrades of existing images are therefore preserved. A repeat import verifies the existing additions and creates nothing; later manual changes to imported fields stop verification for review instead of being overwritten.

## Live verification

Completed 2026-11-04:

- 2,268 active parts created and verified field by field inside the transaction.
- 15,344 searchable aliases and 28,065 attributes verified.
- Independent database grouping confirms the four material/category counts above, with zero missing sizes, image references or active flags.
- Manufacturer/SKU alias lookups return representative carbon and stainless parts in the correct weld category.
- All 48 public image URLs returned HTTP 200 and exactly matched the manifest's SHA-256 hashes.
- Public health endpoint returned HTTP 200, `ok: true`, and database `ok`.
- Catalogue revision advanced from 20180 to 22450. A second application created zero records, reverified all 2,268 parts and left revision 22450 unchanged.
- Six importer tests, Node syntax checking and Python compilation passed. No application code or schema changed; no rebuild, web restart or worker restart was required.

Live checks used database queries and public HTTP requests. No authenticated browser walkthrough was performed. All unrelated working-tree files, including the concurrent packing-slip work and image-upgrade batches, were preserved.
