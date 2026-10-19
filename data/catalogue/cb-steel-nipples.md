# CB Supplies steel pipe nipples

Imported for the Alma organization's Plumbing catalogue on 2026-10-19.

- 351 PN entries: standard black/galvanized, assortment packs and threaded-one-end nipples.
- 114 XHN entries: 86 Schedule 80 black and 28 standard Schedule 40 left/right-thread nipples.
- 122 SSPN entries: 304 stainless Schedule 40 nipples.
- Two pipe storage racks in the PN publication are explicitly excluded.
- Each published size/length is a separate part. The wizard size is nominal pipe diameter, not nipple length.
- Manufacturer descriptions and identifiers are aliases. No Next supplier SKUs, quotes or job approval records are inferred.
- Published CAD list prices and effective dates are reference attributes only.
- Eleven shared images are reused across the 587 parts. Black steel and stainless individual nipples use reviewed, image_gen-edited single-product photos; only assortment packs show groups. Other images are manufacturer originals. Length, schedule and connection are specified in each description. Edit prompts and source provenance are recorded in cb-steel-nipple-image-overrides.json.
- The single-run assortment pack counts are not inferred from carton quantities. Explicit 4/5/8/9/10-piece packs retain their published counts.

Rebuild from source PDFs with `python3 scripts/catalogue/build-cb-steel-nipples.py`, then `node scripts/catalogue/prepare-cb-steel-nipple-images.mjs`. PDF URLs, hashes and page provenance are in the JSON manifest. The checked-in photos were visually reviewed against the manufacturer pages.

`node scripts/import-cb-steel-nipples.cjs` is read-only by default; `--apply` writes atomically with a pre-import backup under `state-backups/`. It is scoped through the Alma job organization and refuses duplicate identifiers. Catalogue revision triggers notify clients of the new data; no app deployment is required.
