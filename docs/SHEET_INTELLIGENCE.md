# Sheet tools and equipment coverage

The drawing menu includes Auto Hyperlink, Legend Items, Super Spec Material and
Super Equipment. Sheet tools require `drawings.view` and `drawings.sheetTools`;
Super Spec Material also retains the separate `systems.access` permission.
Every request resolves the job and readable document folders again.

## Auto Hyperlink versions

The Version selector offers three readers. Version 1 (Normal) retains the existing
embedded PDF text / previously recognized OCR flow, tag rules and job schedule
vocabulary. It runs when the dialog opens and makes no external model request.
Version 2 (Terra, `gpt-6.1-terra`) and Version 3 (DeepSeek, `deepseek-flash`)
read the current drawing image only after the user starts a scan. Both return
typed tag text and source boxes. App code validates coordinates, anchors to exact
PDF text where possible, deduplicates overlapping crops, and performs the same
permission-filtered destination lookup. Neither model supplies URLs or saves links.
AI results start unchecked; users can inspect locations and destinations before
saving. Repeated image-only tags retain every reviewed occurrence on the source.
Other linked sheets still use their own exact text positions.

Keys stay server-side: `OPENAI_API_KEY` for Terra and `DEEPSEEK_API_KEY` for
DeepSeek's hosted vision API. An unconfigured reader is shown as disconnected;
there is no fallback to another model. Choosing a version alone never calls its
provider. Whole-page and four overlapping crops are sent with up to 1,000 schedule
tags. Requests have a 75-second timeout, a 12 MiB image limit, a 1 MiB response
limit and at most 600 proposed tag occurrences. PDFs render in an isolated
512 MiB-heap child (30-second timeout, 4,200-pixel maximum dimension); temporary
images are deleted. PDF file/page limits match the equipment index.

Completed readings are cached by organization, job, source, PDF contents/page,
schedule vocabulary, reader/model and reader revision. Reopening can reuse them;
Read again explicitly requests a fresh reading, including after an empty result.
Database reservations prevent concurrent duplicate calls and retry billing.
The default organization budget is 40 attempts per UTC day across AI readers,
configured by `HYPERLINK_AI_DAILY_CALLS` (0 disables new readings, maximum 200).
Failed/uncertain requests count; two active readings per organization are allowed.
Stopping/closing the dialog ignores late results and prevents saves; an already
submitted provider request may finish and be cached. Access is checked before
rendering, before sending images and before returning or caching results.

Deploy migration `0099_hyperlink_readers.sql` using
`node scripts/ops/apply-hyperlink-readers-migration.mjs`, and deploy the
`hyperlink-render-worker` bundle together with the web app. Provider unit tests
use simulated responses and verify contracts, not recognition accuracy. The
isolated database checks run with `bash scripts/test-hyperlink-readers-db.sh`;
render tests cover rotated digital and image-only PDFs.

## Super Equipment

The report reads equipment schedules from current drawing revisions across the
job, then checks current versions of accessible job Documents. The source picker
can restrict the document search. Each detected schedule line retains its sheet,
schedule title, row text and link to the source location. Separate physical rows
with the same equipment tag remain separate report entries.

- **Submittal found:** an exact tag match in a document registered as a submittal
  or identified by its name, tags or folder as a submittal/shop drawing. Presence
  is separate from approval; document version and workflow status remain visible.
- **Needs review:** a tag in an ordinary document, a superseded/changes-requested
  submittal, or an exact model-number candidate without a tag match. Models come
  from explicit schedule headers; similarity alone does not confirm coverage.
- **No submittal found:** no matching tag or model candidate in the selected
  readable sources. Untagged documents can still cover the equipment.
- **Search incomplete:** unmatched equipment when selected files are pending,
  unreadable, unsupported or truncated. Missing data never proves absence.

Report search, sheet/status filters and CSV export preserve line-level evidence.
Exports include search warnings and timestamp. Exported cells are escaped against
spreadsheet formula injection. No report changes a document's approval status.
Refresh recomputes coverage from current versions; no migration is required.

## Extraction and limits

Immutable PDF/Office text indexes are shared across equipment search and link
tools. Hyperlink preview reads a job's indexes once per batch of up to 200 tags,
instead of a network request for every tag/source pair. Destinations can span all
job drawing sets. Users review/select tags before saving; existing links are kept.
Unfinished indexing must finish before link saving; overflow is reported instead
of silently dropping destinations. One annotation origin expands to occurrences
through the existing annotation service.

Legend proposals support bordered tables and repeated aligned symbol/description
rows beneath explicit headings. Users can scan a set, recognize scanned text,
edit crops/descriptions, exclude candidates, or draw a row to add a missed symbol.
Candidates retain their individual source sheet and are saved by source. Repeated
reads keep already reviewed rows. Missing vectors no longer prevent text-based
legend proposals.

Optional OCR uses local Tesseract and PDF.js in the bounded equipment worker.
One page is recognized per operation; the browser processes a queue sequentially
and can stop it. At most two index/OCR children run in an app process. A child has
a 512 MB JS heap, a maximum 4,200-pixel page dimension, one Tesseract thread and a
55-second timeout. OCR caches are stored beside immutable source files, separate
from originals; recognition errors require review. Both digital and scanned
synthetic PDFs are used for verification.

Existing index limits are 160 MB per source, 2,000 PDF pages, 48 MB serialized
text, 32 MB decompressed Office XML. OCR is limited to 10,000 words per page.
The report displays at most 5,000 schedule lines. Failed or omitted sources are
reported. Untagged lines, unusual/transposed tables, tiny text, unsupported files
and incomplete model-token indexes still require manual inspection. Current
report matching uses deterministic evidence; no new external AI requests are made.

## Super Spec Material

The existing on-demand specification assessment supports its complete
Specifications folder scope and a selected-source scope (up to 20 documents and
50 drawing sets). Search/group/review filters, material-choice and mapping gaps,
source evidence, manual-override reasons and CSV export make the saved requirements
reviewable. Catalogue searches start on demand rather than issuing hundreds of
requests when expanding results. The supported material groups remain pipe,
fittings, valves and joining. Assessment proposals and catalogue candidates require
review in Systems; see `JOB_SYSTEMS.md` for model/extraction details.

Production releases must deploy the updated `equipment-index-worker` bundle
alongside the app. Keep the old app and worker releases available for rollback.
