# Streaming drawing evidence

Offline experimental adapter, **not a production room detector**. Uses PDFBox
3.0.7 to spool interpreted paint records rather than accumulate a PDF.js operator
list and copy it into another large object graph. It retains curves, transforms,
paint order, styles, clip/state references, glyph bounds and uncertain evidence.
It does not certify that a path is a visible physical wall.

`run.py` uses locally pinned Java/PDFBox paths and SHA-256 identities. The Java
runtime and Apache JAR stay outside the repository. The parent watches elapsed
time, process RSS and log size; the producer enforces cardinality and byte limits.
A sibling claim and immutable source archive precede every extraction. Existing
claims/results cannot be reused. `evidence.records()` verifies compressed chunk
hashes, expanded sizes, record counts, event order and state/clip joins.

```sh
python scripts/rooms/stream-vector/run.py \
  --pdf /absolute/source.pdf --page 0 --output /private/new-trial
python -m unittest discover -s scripts/rooms/stream-vector -p 'test_*.py' -v
```

`--page` is a **zero-based original PDF index**, never a database import slot.
The nine tests generate their own drawings, including 200,101 separate paths,
forms, Type3 glyphs, clips, rotations and tampered spools. No corpus targets are
read. Changing the extractor requires a new declared study; retain old code
archives and outcomes. This adapter does not relax or modify the older frozen
`vector-topology` / `vector-compat` studies.

The [execution report](../../../docs/ROOM_SPATIAL_EXPERIMENTS_2026-10-01.md)
records actual-page results and the corrected adjacent-page mistake.
