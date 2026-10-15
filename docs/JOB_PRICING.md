# Job supplier lists and pricing

A job price list references supplier listings. Each listing references the catalogue's permanent `partDefinitionId`; SKU text is not used as a foreign key. Several suppliers or SKUs can share one catalogue part and photo. Descriptions supplied by vendors remain aliases; existing catalogue names are preserved.

Visual and interaction intent: use the existing ForemanHQ colors, small text, a search field and a compact list that stacks naturally on phones. Keep part search and price editing primary, with the approval queue on a separate tab. Save and review states use the existing dialogs and buttons.

Open **Job → Job pricing & approvals**. Listed parts appear first in the parts wizard and material lists. A selected supplier outside the job's list is unlisted even if a different supplier has priced that part. Membership in the approved list and confirmation of a dollar price are separate facts.

Initial Alma import: 728 reviewed Next SKUs, 532 matched rows and 196 new parts. The three workbook corrections are included. All imported prices are CAD budget estimates before tax and delivery. They are **not Next quotations**. Every row records its basis and assumptions. IPEX single-fitting list prices, pipe prices per 100 feet and Cello assumed net multipliers are distinct; carton sizes do not establish minimum order multiples. The 6-inch stainless pipe has no stock length in the source and is priced per foot, explicitly labeled. Shared representative product photos avoid a separate image per size.

On October 15, Tim confirmed that Alma's hardware is covered by Fastening House pricing. All 254 current Hardware catalogue parts were added using their existing Fastening House listing IDs, bringing the job to 982 approved supplier listings. No supplier SKUs or actual quoted amounts were supplied. Budget allowances remain `estimated`; 85 packaged parts use whole-box/pack allowances converted from the older per-piece estimates. Two legacy amounts without a documented basis have explicit, low-confidence replacement assumptions recorded in the job price source. Global catalogue prices and historical orders are preserved. This approval is a snapshot of current parts, rather than automatic approval of future catalogue additions.

Managers with `jobPricing.manage` and `financial.view` may edit or import prices. Export the CSV template, fill **Unit cost CAD**, retain the entry ID and supplier SKU, and set **Price status** to `estimated`, `confirmed` or `none`. CSV and Excel uploads require an exact listing match and explicit confirmation; unknown/duplicate SKUs, invalid costs, stale revisions and foreign entries are rejected. No matching or part creation happens automatically during price replacement.

Unlisted orders require a reason and an authorized reviewer with `jobPricing.approve`. The server hashes exact material-list row IDs, requested and ordered quantities, prices, supplier listings/SKUs and the pricing-list revision. Edits invalidate the approval. The order preview withholds its email until approval; direct sending is also checked inside the transaction. Legacy draft orders must be regenerated from the material list. Requests, decisions and price changes keep audit records including the actual actor during employee simulation. Used approvals are retained and sent lines snapshot the estimated/confirmed status.

Price updates recalculate only unsent list rows. Sent prices, quantities, receipt history and links are preserved. Source aliases and supplier links do not modify any historical order SKU snapshots.

## Import operations

`node scripts/ops/import-job-pricing.mjs scripts/data/alma-next-approved-2026-10-14.json` validates the reviewed manifest. `--apply` saves a restricted local backup, then performs the import in a single transaction with the job purchasing lock. Existing supplier-SKU collisions fail rather than silently reassigning another part. Reruns preserve entered job prices. New shared photos retain their source page and checksum; existing photo assets are reused.

Apply `0074_job_pricing` with `scripts/ops/apply-job-pricing-migration.mjs`. The database also rejects cross-organization job/listing/approval relationships. No schema or authentication bypass is required for the UI.

To apply the Fastening House snapshot, validate `node scripts/ops/approve-job-catalogue-supplier.mjs scripts/data/alma-fastening-house-approved-2026-10-15.json`, then use `--apply`. This operation checks the expected job-price revision, immutable supplier/part IDs, organization, pack contents, units and source catalogue allowances. It backs up the current job pricing and approval records, adds only missing entries, retains entered prices, audits the user's authorization and invalidates unused approvals tied to the previous revision. The manifest intentionally requires a fresh review if job pricing has changed. Refresh unsent costs afterward with `scripts/ops/reprice-job-lists.ts`; no app build is needed for this data-only addition.

Validation: isolated PostgreSQL tests cover direct-send rejection, exact-content approvals, supplier SKU selection, job-specific prices, historical price preservation and cross-organization writes. Browser checks exercise the actual pricing page and dialogs using fixture responses at 320/390/768/1280px; they do not simulate a supplier quote or send an email.
