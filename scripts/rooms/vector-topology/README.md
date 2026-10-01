# Painted-path and jointly witnessed portal prototype

This is a separate offline CPU experiment. It is **not an application detector**
and does not certify a building envelope, rooms, unlabeled circulation, portal
precision or floor completeness. It preserves PDF drawing evidence and tests
whether an intact quarter-circle swing, radial leaf, two jambs and continuing
paired wall faces jointly support one closed-door span. A supported witness
still requires review. Missing evidence is unresolved; no arbitrary wall gap is
closed and no source glyph, furniture or revision loop is assumed to be a room.

`painted-paths.ts` reads the pinned PDF.js 6.2.108 normalized operator stream.
Extraction IDs identify normalized paths and operators, not original CAD
entities. Full curves, page-point transforms and graphics-state provenance are
retained, including unsupported paths with reason codes. The parser's conservative
eligibility subset and resource limits are defined in its source. `portals.ts`
fits the actual circle center, uses the leaf and opposite arc endpoint, then
requires attached jambs and local paired wall continuations. The closure follows
the wall opening rather than the arc chord. Ambiguous/conflicting evidence is
quarantined. Preset tolerances are proposed geometric rules, not calibrated
probabilities or facts validated on actual construction drawings.

Native curves split into multiple smaller commands are not joined into a
quarter swing; single-quarter native curves and contiguous sampled line runs
are supported. Unknown later text, shading or image paint can conservatively
leave earlier source evidence unresolved, including all evidence on a sheet.
That is a visibility limitation, not evidence that a sheet has no doors.

The [research snapshot](../../../docs/ROOM_VECTOR_PORTAL_TOPOLOGY_RESEARCH_2026-09-30.md)
explains the current parser/graph limitations and the still-required physical
wall-band, envelope and free-space topology work. No production parser, raster
partition, Swiss corpus, GPU model or review database is changed by this tool.

## Fabricated checks

From the repository:

```bash
node --import tsx --test scripts/rooms/vector-topology/*.test.ts
```

These are fabricated geometry and PDF cases, including independent PDF fixtures
and provenance mutation checks. Passing them does not measure actual room or
door accuracy. No provider or GPU is involved.

## One private source-frozen probe

Complete source review and fabricated checks before freezing a real input. Use
an exact PDF and its **zero-based** page index. Outputs must be a new absolute
private directory outside the repository; do not put customer drawings in Git.

```bash
node --import tsx scripts/rooms/vector-topology/run.ts freeze \
  /absolute/private/source.pdf 18 /absolute/private/new-vector-probe
node --import tsx scripts/rooms/vector-topology/run.ts run \
  /absolute/private/new-vector-probe/plan.json
node --import tsx scripts/rooms/vector-topology/run.ts verify \
  /absolute/private/new-vector-probe/plan.json
```

Freezing records current own TypeScript/test/README bytes, installed PDF.js main
and worker bytes and package metadata, Node/tsx versions and `pnpm-lock.yaml` hash.
Private source copies are checked before native parsing and after emission.
The native worker requires the original live parent claim and an exclusive
worker-start record before parsing; direct worker calls cannot bypass the
parent's deadline/RSS supervision. Completion consumers verify that record too.
The exact input PDF hash, original plan path, page, output bytes and original
global claim/completion are bound. Dependency version/lock metadata is retained;
this is not an assertion that every transitive runtime byte is archived.

The parent bounds a separate worker to 60 elapsed seconds and a 1,536 MiB V8
heap, polls Linux worker RSS every 100 ms against 2,048 MiB and also rejects a
reported peak above that limit. RSS polling is not an instantaneous hard kernel
memory limit. The parser and geometry stages have their own declared command,
sampling, local-evidence and candidate budgets and fail rather than truncate.
Every JSON emission is capped at 256 MiB. A resource failure is a failure of
this fixed probe; it does not establish that no doors exist.

Original attempts are claimed under
`/home/tim/datasets/foremanhq-room-detection/vector-topology-claims` by source
bytes, input PDF hash, page, runtime and limits. Copying identical PDFs, moving
an output or deleting its files cannot reset an attempt. A failed attempt stays
spent. Settings or sources must never be silently changed to replay a reported
result. A later explicitly designed development study needs its own declared
experiment and must not use protected or previously untouched evaluation inputs
for tuning.

`painted-page.json` preserves private source paths/state, `portal-evidence.json`
preserves accepted and unresolved witnesses, and `summary.json` gives counts,
geometry-stage latency/RSS and limitations. The worker receipt additionally
records peak RSS after serialization/emission; a final peak gate follows the
post-write byte checks. `verify` checks metadata/raw bytes without
importing the PDF parser or decoding native geometry. These counts are not true
room/door counts. Actual accuracy needs independently checked source evidence;
all-space accuracy additionally needs every physical room, hall and common
space outlined and an explicit complete-floor review.
