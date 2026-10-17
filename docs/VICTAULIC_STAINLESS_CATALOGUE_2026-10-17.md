# Victaulic stainless grooved fitting import — 2026-10-17

Adds the explicit dimensional-table fitting/size combinations in these official publications to Tim's organization's Plumbing catalogue:

| Publication                                                               | Scope                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| [17.16](https://assets.victaulic.com/assets/uploads/literature/17.16.pdf) | OGS Schedule 10S stainless fittings                     |
| [17.50](https://assets.victaulic.com/assets/uploads/literature/17.50.pdf) | OGS Schedule 40S stainless fittings                     |
| [17.18](https://assets.victaulic.com/assets/uploads/literature/17.18.pdf) | OGS duplex / super duplex fittings                      |
| [17.05](https://assets.victaulic.com/assets/uploads/literature/17.05.pdf) | AGS Schedule 10S / 40S stainless fittings               |
| [31.04](https://assets.victaulic.com/assets/uploads/literature/31.04.pdf) | StrengThin 100 thin-wall stainless fittings             |
| [17.32](https://assets.victaulic.com/assets/uploads/literature/17.32.pdf) | StrengThin high-pressure duplex / super duplex fittings |

Materials are **Stainless Steel Grooved** and **Duplex Stainless Grooved**. Existing generic Grooved and stainless butt-weld parts are preserved. Descriptions distinguish grade, schedule where specified, groove system, product model, and SWS / cast / flat / PN variants. Unusual actual-OD variants (e.g. 76.1 mm versus 73 mm) are explicitly marked in descriptions and attributes, even where they share a nominal wizard size.

Only listed sizes with a published dimension are imported. Dashes do not become parts. The importer does not form Cartesian products of size ranges. Optional made-to-order Schedule 5S, tapping configurations, custom lengths, and flange-face/bolt options without their own dimensional rows are not extrapolated. These six publications cover fittings; separate coupling, valve, tooling, and anchor product lines are outside this dataset.

Manufacturer **model numbers** are stored as attributes and search aliases, together with full descriptions. These are not invented size-specific manufacturer SKUs or supplier SKUs. No supplier extension, job-price approval, supplier quote, or guessed price is created by this import. Grades, grooves, and schedules remain distinct; product presence is not a compatibility or pressure-rating determination. Authoritative installation and performance details remain in the cited submittals.

48 verified manufacturer engineering illustrations are shared across size and grade variants. Each has a content-addressed filename, source publication/page, exact crop, and SHA-256. They are diagrams, not generated photographs. Uploaded catalogue image routes serve them immediately without an application rebuild. Source PDF hashes and per-row extraction evidence are retained in the JSON manifest.

## Extraction checks

- Column maps are explicit. Rows are anchored to actual outside-diameter text rather than unreliable merged PDF table cells; only merged run dimensions carry forward within a table.
- Metric rows are not imported again as separate inch rows. Japanese actual-OD variants retain their actual diameters.
- 17.50 reducer tables repeat a run column; reduce that to two physical ends. On page 12 the first duplicated 12-inch OD reads 10.750, whereas the second reads 12.750 and both metric values read 323.9. Use the second run column, confirmed by the nominal 12-inch label and metric OD. Never create a three-ended reducer.
- The 17.32 tables use nominal-only, side-by-side layouts. Their exact combinations are explicitly transcribed, not inferred from the overall size range.
- Validate unique identities/names, reducing geometry, image checksums, source publications, field bounds, and post-import image coverage.
- The import is one organization-scoped transaction, takes an advisory lock, backs up the pre-import records and planned new IDs, and is safe to rerun. Existing descriptions and supplier data are not overwritten. Catalogue revision triggers make additions visible to sync clients.

## Reproduce

Download the six PDFs to a local source directory; use the bundled Python containing pdfplumber and Pillow:

```sh
python3 scripts/catalogue/build-victaulic-stainless.py --sources SOURCE_DIR --output data/catalogue/victaulic-stainless-grooved.json
python3 scripts/catalogue/extract-victaulic-stainless-images.py --sources SOURCE_DIR --catalogue data/catalogue/victaulic-stainless-grooved.json
node scripts/import-victaulic-stainless.cjs --validate-only
node scripts/import-victaulic-stainless.cjs
node scripts/import-victaulic-stainless.cjs --apply
```

Default mode is read-only. `VICTAULIC_IMPORT_USER_EMAIL` chooses the account whose organization is imported into. The live import receipt and private database backup are saved separately from this document.

## Verified live result

Imported 2,588 new fitting variants, 48 shared images (682,156 bytes), 30,658 provenance/specification attributes, and 7,764 aliases. No existing part rows were modified. A repeat dry run proposes zero new parts. All 2,588 live records match the manifest, have images, and resolve to the expected material/category/size. All 48 public image responses have matching SHA-256 hashes. Public application/database health passed.
