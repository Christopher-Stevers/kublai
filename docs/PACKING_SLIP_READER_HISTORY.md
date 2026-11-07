# Packing slip reader evidence

The server archives completed analysis attempts, failed attempts, and confirmed
receipt reviews in `kublai_packing_slip_review_history`. Records are scoped to the
company and job, with document/version/run IDs, source PDF hash, reader/model label,
app release, timestamp and acting user. The original parsed lines, bounding boxes,
warnings and order snapshot remain available after reanalysis. Confirmation saves
both the original analysis and the final user-selected item links and quantities.
The history insert and receipt changes share one transaction; retries do not create
duplicate records or receive a delivery twice.

These are operational company records, not anonymous usage diagnostics. They are
not sent to a model or used to change code automatically. They have no public API.
Review via authorized, company-scoped database access when investigating a report.
A company deletion removes its history. Source references do not retain deleted
PDF files: normal document retention still applies. History begins with deployment;
we cannot reconstruct matches already overwritten by older confirmations.

**A received quantity is not a corrected reading of the shipped quantity.** A
physical shortage, overdelivery, or count correction may explain the difference.
Confirmation records explicitly label quantities as physical receipt observations.
Use the source PDF and a human review to classify causes before creating test truth.
Unconfirmed form edits are not saved; confirmed edits and analysis results are.

The reader handles stacked quantity headers, shared product/description columns,
packaging-note rows and incidental marks between items. Exact whole supplier codes
outrank approximate matches; a code substring is not an exact match. Uncertain
numbers and item matches remain flagged rather than being filled from order totals.
