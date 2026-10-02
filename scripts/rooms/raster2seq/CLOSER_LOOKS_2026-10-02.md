# Fixed overlapping closer-look probe, 2026-10-02

One additional raw CubiCasa256 probe completed. It recovers some visible small
enclosures and faint interior partitions that were absent in the wider views,
but still produces missing/merged spaces, spurious stair/circulation divisions
and disagreeing outlines. Root separately inspected the original full-page
overlay and agreed to reject production promotion. No new model run or threshold
tuning follows this result.

## Declaration and exact inputs

`closer_looks.py` subdivides only the four already fixed regional views from the
baseline. Windows are 640×640 native pixels, stride 480, with a final edge-aligned
window where necessary. The exact declaration is 18 windows: four west upper,
four west lower, six north common, four east upper. The source image is unchanged.
No gamma, morphology, semantic filter, new crop selection or reference seed is
used. It is a fixed multiscale development probe, not content-adaptive detection
or an independent test set.

The official code/checkpoint and verified original page18/index17 are the same
as the [raw256 baseline](RESULTS_2026-10-02.md): code commit
`031f565c4d5d08fc889bbcd873d4afb62dce3676`, checkpoint SHA256
`f7c0ef9379aa8cf11349da8b2179214e0d495af758383984a2361a1309aab3b7`,
source PNG SHA256
`0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`.
No training, protected corpus, customer review geometry or truth annotations
enter this probe.

Parent polygons come from the frozen baseline report SHA256
`0be1853222df3b17428996e4f00c1cbe9cfaf62acde590b507041ea3babd7f12`.
Every child stores its crop transform, original model points, untouched normalized
source-page points, semantic guess and parent-region ID. A child with at least
90% of its area overlapping a valid parent has a spatial parent relation,
explicitly marked as a hypothesis. This does not prove either ring is a room.

## Validity, duplicates and crop limitations

Invalid rings and out-of-crop polygons are quarantined, never repaired or clipped.
Deduplication applies only to valid, in-crop, non-edge-flagged polygons from
different windows, at IoU≥0.85. It keeps an exact original representative ring
and compares each duplicate only against that representative. There is no
transitive clustering, geometric union, room/suite merging or largest-component
repair. Class conflicts and every suppressed duplicate remain in provenance.

One model pixel (2.5 native pixels) of boundary margin is the predeclared possible
crop-truncation warning. **`strict_contained_polygons` is a ring-coordinate
condition only. It does not mean a complete physical-room boundary.** In this
run no emitted valid ring triggered that narrow warning, but visual inspection
shows model outlines can end artificially inside a window even when the drawn
space continues beyond it. Zero flags cannot certify nontruncation. The preset
was not changed after viewing those failures.

Distinct retained rings with intersection≥25% of the smaller area are recorded
as overlap disagreements, not resolved automatically. A contained child inside
a parent may expose a previously merged physical partition, a false fixture or
a newly invented subdivision. Neither containment nor cross-window agreement is
a correctness test.

## Measured result

| Existing parent region | Child windows | Polygon proposals | Strictly valid rings before dedup | Retained representatives |
| --- | ---: | ---: | ---: | ---: |
| West upper | 4 | 48 | 28 | 25 |
| West lower | 4 | 39 | 30 | 30 |
| North common | 6 | 70 | 55 | 49 |
| East upper | 4 | 48 | 41 | 40 |
| Total | 18 | 205 | 154 | 144 |

There are 51 invalid polygons, 10 removed near-duplicates, 3 duplicate semantic
class disagreements and 70 retained overlap-disagreement pairs. These counts
are proposal diagnostics, not counts of correct rooms, false rooms or misses.

Total wall time was 20.083s, model load 3.215s, per-window inference 0.343–2.126s.
Peak CUDA allocated/reserved memory was 286.73/302MiB; peak process RSS 2237.73MiB.
One window, `west-lower-y0-x1`, reached the original 512-token limit and emitted
only five polygon proposals, three valid. Raw unfinished generation is retained.
This is an explicit missingness/failure risk despite the process completing.
The limit was not raised and that window was not rerun.

The four declared regional rectangles cover 25.32% of page area. The remaining
page pixels were not analyzed in this probe; many are background, but parts of
the drawing also lie outside the declaration. Blank pixels in the stitched
overlay cannot be counted as missed rooms without a reference. The 18 windows
share one source page and overlapping content, so they are not independent
samples and cannot support floor-level accuracy/completeness estimates.

## Actual source-overlay observations

The full-page original-pixel overlay and four derived regional views were
inspected. More nearby context improves some proposals, but not consistently:

- **West upper:** Some lower-left interior bathroom/pocket boundaries appear
  where the parent had a larger merged region. Gray interiors in upper units
  remain merged or absent; center stairs and circulation have false/conflicting
  subdivisions, and several drawn units lack a valid proposal.
- **West lower:** Several small upper enclosures and gray-wall partitions appear.
  Central stairs acquire overlapping fragments, the token-capped right window
  leaves visible spaces unproposed, and lower units retain merged interiors.
- **North common:** More small washroom/service pockets are outlined than in the
  wide parent view. Overlapping windows disagree about common circulation and
  stairs, and parking/exterior fragments remain false physical-room hypotheses.
- **East upper:** The upper-center gray interior is subdivided more than in the
  parent. New outlines also arbitrarily split/overlap rooms and stairs; other
  interiors remain merged. Exterior annotations acquire false regions.

This visual evidence supports using close looks for offline annotation
assistance, not automatic acceptance. No complete real-floor truth exists here;
these observations are not numerical recall/merge/split scores.

## Frozen outputs and tests

Private run directory:

```text
/home/tim/datasets/foremanhq-room-detection/raster2seq/page18-fixed-closerlooks-20261002
plan.json SHA256:
7efccbf945d0b7146837d1e076606cdcb230d54bf88729fa4b66f3eb2bb94180
report.json SHA256:
3484e14ecd72aae1fc54f897b989ea66be3550f895a737d5c0b43679122e159a
full-page-valid-overlay.png SHA256:
7e6c64666e94db0d9cd8eaab0409b7b809a65a789fa9bb1717280e6939d8f761
```

`valid-proposals.json` retains all raw records and exact representative mappings,
parent hypotheses, duplicate provenance and overlap conflicts. Per-window JSON
keeps raw tokens/logits and transformations. Sources are archived and bound by
the plan. Post-run validation passed 569 current/archive/emission byte checks;
this validates lineage, not room correctness. Four presentation-only regional
crops are separately stored under `page18-closerlooks-visual-review-20261002`,
with a metadata receipt linking the original overlay SHA256; no extra inference
or ground truth was generated to make them.

Six new fabricated tests cover fixed coverage/counts, invalid/outside rings,
crop warnings, exact-ring/class-conflict dedup, no transitive chaining and no
nested unit/room union. All 23 owned adapter/probe tests pass. Historical producer
sources and prior outputs remain unchanged.

Historical command, run from the v3 clone (output already exists):

```bash
timeout --signal=TERM --kill-after=15s 600s \
 /home/tim/datasets/foremanhq-room-detection/raster2seq/.venv/bin/python \
 scripts/rooms/raster2seq/closer_looks.py \
 --upstream /home/tim/datasets/foremanhq-room-detection/raster2seq/upstream \
 --model /home/tim/datasets/foremanhq-room-detection/raster2seq/official-cubicasa5k \
 --source /home/tim/datasets/foremanhq-room-detection/stream-vector/verified-page18-textfree-20261001.png \
 --baseline /home/tim/datasets/foremanhq-room-detection/raster2seq/page18-fixed-five-view-20261002 \
 --output /home/tim/datasets/foremanhq-room-detection/raster2seq/page18-fixed-closerlooks-20261002
```

The remaining priority is actual drawing annotations and domain-specific
adaptation, with an agreed physical-room policy and independently attested
full-floor evaluation. Repeatedly subdividing this one exposed page or choosing
more favorable overlap thresholds cannot establish completeness.
