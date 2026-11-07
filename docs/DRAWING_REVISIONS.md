# Revised drawing PDFs

Use **Upload revised drawings** on the Drawings folder screen, or in **More** inside a folder. Upload one revised PDF. The existing resumable uploader splits the pages into a new `Revisions · filename.pdf` folder and retains the source PDF.

The review proposes existing logical drawings by normalized, unique drawing number. Case, spaces and hyphen variations can match; decimal numbers remain distinct. Repeated numbers, multiple existing candidates and missing identities require an explicit choice. The review distinguishes matched revisions, new drawings and uncertain pages. Users may leave pages for later, keep them as new drawings, or manually select a destination. Two pages cannot both replace one logical drawing in the same confirmation.

One confirmation publishes version records and makes confirmed revisions current. Prior sheets, annotations and history remain. Revised drawings return to Draft. The operation checks drawing-management permission, organization/job boundaries, source identities and metadata revisions under transaction locks. A stale item aborts the whole confirmation. Uploads themselves are durable: closing or failing review never deletes uploaded sheets, and the existing per-drawing revision workflow remains available.

## Calibration

A drawing number or equal page dimensions is not evidence of unchanged drawing scale. The bulk workflow reads original-PDF scale text in a bounded isolated worker and compares the saved normalized vector geometry. It retains calibration only when:

- Both PDF pages yield one usable printed scale, matching the saved calibration within 0.1% after unit conversion.
- Sheet aspect agrees, and at least 80 usable interior line segments cover at least six spatial cells.
- At least 98% of the larger segment set coincides in normalized coordinates, with only small coordinate roundoff permitted.
- Neither vector extraction is truncated.

Otherwise the review/result explicitly requests a calibration check before measuring, and the current scale is cleared. Scans, missing vectors, mixed/noted scales, changed crops/resizing, insufficient common geometry and changed printed scale commonly require this check. This is a conservative evidence check, not a guarantee about unlabelled local details. Failed or timed-out evidence extraction never counts as compatible. Metadata and small evidence caches are derived from immutable job-authorized sources; PDFs are parsed outside the web process with a 512 MB heap and timeout.

## Possible markup and takeoff impacts

When a drawing revision becomes current, the service compares normalized vector segments and PDF text rectangles. It considers localization reliable only when printed scale agrees and distributed common geometry establishes alignment. Changed regions include added/removed segments and changed text, so an amended size label can flag nearby work even without moved lines.

Existing accessible markups and linked estimating takeoffs near changed regions receive **Needs review** issues. When alignment, scale, evidence or a takeoff location is uncertain, affected items are flagged for a broader check and explicitly labelled uncertain. Bounding-box proximity is deliberately conservative and can produce false positives. These flags describe possible impacts, never confirmed mistakes. No annotation, takeoff quantity, estimate or order is automatically adjusted.

Open **Needs review** in the drawing viewer. **Compare before / after** opens the existing comparison tool focused on the item. **Mark reviewed** closes the review issue using existing permissions, revision checks and audit records. Closed issues remain in history. Private markups remain private; estimating flags are private to the importing reviewer and are generated only with estimating/financial access. Unlocated takeoffs receive a clearly described whole-sheet check. Large impact lists are capped at 200 per transition with an explicit additional-items review warning.

Single-drawing Attach revision / Make current also generates review flags and retains calibration when compatible evidence is already available. Missing evidence stays conservative and requests verification. Bulk import prepares evidence for automatic and manually chosen matches.
