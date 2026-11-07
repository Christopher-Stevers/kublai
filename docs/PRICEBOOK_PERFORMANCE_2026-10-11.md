# Pricebook performance — 2026-10-11

This is the first catalogue/pricing performance pass following the drawing work.
It indexes exact price identities in the shared estimating matcher, validates
pricebook CSVs in a browser worker, and bounds the rate editor to 50 visible rows
with search and paging. No Rust component is added for this workload: eliminating
repeated scans already reduces the largest matching case below 10 ms locally.

## Measurements

Node 26.8.2 on the development machine, sequential runs of the frozen scanner and
the indexed matcher. Each case uses one warm-up followed by three timed runs.
Fixtures are synthetic supplier rows at supported application sizes; they are
not customer pricebooks or physical-phone measurements. A read-only production
check found no stored organization pricebook rows available for this comparison.

| Estimate lines | Pricebook rows | Original median | Indexed median |
| -------------: | -------------: | --------------: | -------------: |
|            100 |          1,000 |        15.36 ms |        0.69 ms |
|            500 |          5,000 |       380.84 ms |        4.58 ms |
|          2,000 |         10,000 |     3,051.91 ms |        7.84 ms |

Complete result hashes matched in every case, including rates, evidence sources,
warnings, ambiguity, and counts. Index construction is included in each timing.
The 10,000-row CSV parser itself took approximately 37 ms on this machine; the
worker changes where that work happens, not its parsing algorithm. Worker startup
and messaging can increase total elapsed import time while keeping input and
painting responsive. These matching numbers do not establish whole-page speedups.

## Behavior preserved

- Description and SKU matching remain exact after the existing normalization.
  Unit aliases, supplier choices, currency rejection, missing prices and simulated
  price provenance retain their previous behavior. A row whose description and
  SKU both match remains one candidate; separate duplicate rows remain ambiguous
  in their original order.
- Each operation rebuilds its index, so in-place changes cannot apply stale
  prices. Excluded lines and the input pricebook remain untouched.
- CSV parsing and staging IDs run in the worker. Results transfer in acknowledged
  batches of 250, allowing main-thread input and painting between batches.
  Unsupported browsers retain the existing parser. Closing, permission changes,
  logout/account changes and explicit cancellation terminate or discard the work.
- CSV errors retain the existing pricebook. Importing only stages edits; the
  existing explicit revision-bound save applies them. Appending past 10,000 rates
  is rejected before changing the book; an explicit replacement remains available.
- Search and paging limit rendering without limiting saves: all rate edits remain
  in the same local book and save together, including edits on other pages.

## Reproduction

```sh
node --import tsx scripts/benchmark-pricebook.ts scan /tmp/pricebook-scan.json 3
node --import tsx scripts/benchmark-pricebook.ts indexed /tmp/pricebook-indexed.json 3
```

The frozen scanner is benchmark/test code only. Tests cover result equivalence,
duplicate candidates, mutable input reuse, CSV errors, bounded worker responses,
cancellation, account cleanup, fallback, paging and saving edits across pages.
Local release receipts and browser checks are retained in
`.tmp/pricebook-performance/`.
