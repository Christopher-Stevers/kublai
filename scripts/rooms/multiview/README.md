# Cross-view drawing experiments

Offline research; no production dependency or automatic geometry promotion.

| Module | Purpose |
| --- | --- |
| `page_binding.py` | Verify exact PDF bytes, original source page, one-/zero-based convention, PNG identity and vector receipt before combining evidence. Equal aspect ratios are insufficient. |
| `drawing_sets.py` | Index candidate suite/detail relationships from source drawing titles and captions. Preserve ambiguity, floor/ceiling distinction and variant suffixes. This does not locate room boundaries. |
| `registration.py` | Fit scale-constrained SIFT/RANSAC similarity or reflection, withholding matches for a separate check. Transfer rings/holes only as pending hypotheses. |
| `render-source.ts` | Render a specified original PDF page and save a new PNG with its source/page/hash receipt. One-based page number. |
| `paired_trial.py` | Original frozen record of the corrected page-18 repeated-room/navigation study. |
| `atlas_trial.py` | Original frozen Suite K detail-to-floor study. All four registrations were rejected. |
| `reference_probe.py` | Original bounded comparison with unmodified MIT `roomgraph`; it timed out. |

```sh
python -m unittest discover -s scripts/rooms/multiview -p 'test_*.py' -v
python scripts/rooms/multiview/drawing_sets.py \
  --pdf /absolute/source.pdf --output /private/new-index
node --import tsx scripts/rooms/multiview/render-source.ts \
  /absolute/source.pdf 1 5000 /private/new-page.png
```

Seventeen fabricated tests cover page/source mismatches, title-block/caption
matching, variant ambiguity, scale, reflected registration, blank inputs,
nonuniform-warp rejection and preserved holes. Python uses NumPy, SciPy,
scikit-image and Pillow; the indexer also uses Poppler's `pdftotext`. Original
trial wrappers contain this machine's private paths and refuse spent outputs;
they are evidence records, not general batch jobs.

`render-source.ts` records the renderer file digest, not every transitive
dependency. Decoder-fix evidence separately pins `pdf-render-options.ts` and
the installed PDF.js version. Old PNGs/receipts were retained after that fix.
The original atlas source crop was outside all embedded images and is
byte-identical after the fix; the full old detail-page image was incomplete.

The index is intentionally only a candidate generator. Wrapped captions can
still misclassify a bedroom variation as a full suite view, and missing labels
leave unmatched instances. No candidate link is automatic permission to copy
room geometry. A successful registration is not proof that a room layout or its
revision is identical.

See [results and limitations](../../../docs/ROOM_SPATIAL_EXPERIMENTS_2026-10-01.md).
