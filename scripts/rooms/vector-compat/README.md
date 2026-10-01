# Optional text-glyph compatibility study

This is a separate, declared compatibility profile for the executed, immutable
`../vector-topology` v1 producer. It never changes that parser or any portal
threshold. The first actual v1 attempt failed in the strict operator argument
copier before emitting geometry. A fabricated Helvetica PDF reproduces undefined
optional glyph metadata in the pinned PDF.js worker. That is evidence of a
compatibility gap, not proof of every cause in the actual drawing.

Only explicitly present `undefined` in the worker's three known optional text
glyph fields is tagged as a versioned serializable sentinel. A ledger retains
its operator, glyph, field, key position and original type. Missing fields and
null remain distinct. Structural operators, path arrays and numeric arguments
are unchanged. Unknown values still fail. The frozen parser retains its
conservative rule that unknown later text bounds invalidate earlier vector
evidence. Zero supported portals therefore does not mean no doors exist.

`profile.ts` embeds the original source/runtime/limits plan and separately pins
all compatibility sources. Freeze happens before decoding; raw archives and all
pre/post fences remain mandatory. Passing an original failed plan also binds
its immutable source/input/failure bytes. The compatibility attempt identity
includes the profile and source bytes, but excludes output aliases and optional
prior-failure lineage, so neither can reset an attempt. Original claims, worker
starts, failures and completions are exclusive and never overwritten.

Use Node 26.8.2 with the repository's pinned PDF.js 6.2.108 and tsx:

```sh
node --import tsx scripts/rooms/vector-compat/run.ts freeze /private/source.pdf 18 /private/new-study /private/v1-failed/plan.json
node --import tsx scripts/rooms/vector-compat/run.ts run /private/new-study/plan.json
node --import tsx scripts/rooms/vector-compat/run.ts verify /private/new-study/plan.json
```

Omit the last freeze argument for a fabricated smoke fixture. The parent caps
worker heap at 1536 MiB, polls RSS against 2048 MiB every 100 ms, and kills the
worker after 60 seconds. Final worker peak RSS gates also cover serialization
and post-write verification. This is a sampled watchdog, not an instantaneous
kernel memory limit. The 128 MiB input and 256 MiB per-emission caps also remain.

Private emissions are `painted-page.json`, `portal-evidence.json`,
`normalization.json`, and `summary.json`. Their original serialized SHA-256
values join the original plan, claim, worker start, receipt and completion.
`verify` consumes metadata and raw bytes without importing the parser, decoding
native geometry, rerunning inference or changing producer files.

This prototype does not determine the building envelope, partition free space,
train a model, use room labels, score room completeness or change production.
Result evidence belongs in a separate report; producer files remain immutable
after the declared experiment starts.
