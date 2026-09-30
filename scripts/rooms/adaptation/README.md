# Verified review adaptation

This offline tool starts from the fixed completed long48 context checkpoint instead
of discarding its weights. It consumes a new private dataset produced by
`../models/context_review_data.py`. It never updates the application or selects a
production model. No customer-data adaptation has run: the current live review
check found no saved decisions or complete-floor attestations.

Use the review controls to approve/reject/correct proposals and add missing rooms.
Only an explicitly complete floor can provide dense supervision. Partial reviews
teach approved interiors and boundaries; unknown pixels, rejected proposals and
all reviewed opening labels stay unsupervised. Separate reviewed training and
validation jobs are mandatory. Splits also isolate exact PDFs and images; exports
currently lack physical-building aliases, so this is not a site-independent test.

Before loading native training assets, the tool replays copied export identities
and quarantines every alias of a protected PDF. It then checks immutable approval
evidence and regenerates native targets, known masks, provisional approved-room
labels and overview supervision. A forged label checksum cannot substitute for
the approved geometry. Source-PDF and preview bytes are checked independently;
their rendering association still relies on the export's recorded provenance,
not a cryptographic renderer receipt.

The fixed experiment uses twelve epochs, learning rate 0.0001 and the unchanged
context architecture/loss/tile sampler. Half of expected training sampling mass
belongs to verified reviews and half to exact synthetic replay. Checkpoint
selection uses masked loss only on separate reviewed validation jobs. That loss
cannot establish missing-room recall, especially on partially reviewed floors.
Unknown opening gradients are masked, but shared weights and optimizer decay can
still change opening predictions. All heads and complete-room performance must be
evaluated separately before promotion.

Create the verified review dataset using the existing model README, then run:

```sh
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python \
  scripts/rooms/adaptation/review_adapt.py \
  --manifest /absolute/private-reviewed-context-data/manifest.json \
  --output /absolute/new-private-adaptation-run
```

Output must be outside the repository. Inputs, parent checkpoint/completed run,
sources, archived sources and runtime are bound in `binding.json`. The
dataset/parent/config claim is stored outside the chosen output directory;
changing output or CPU/CUDA cannot reset an attempt. A failed attempt has no
completion record and remains claimed. Checkpoints and copied inputs stay private.
`review_adapt.read_completed(output)` checks the original path, global completed
receipt, bound inputs/sources/runtime and emitted bytes without decoding a model.
It requires all twelve epochs, the selected epoch, the parent-run/checkpoint
bindings, archived producer sources and consistent run/data/claim associations.
It rechecks captured hashes before returning; a checkpoint changed during
verification fails. The previously selected checkpoint is also checked before
an improving epoch can replace it.
Use this gate before any future evaluation/inference adapter consumes a child
checkpoint; no child checkpoint has been produced or consumed in this work.

Tests use fabricated exports and tensors only:

```sh
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python \
  -m unittest discover -s scripts/rooms/adaptation -p 'test_*.py' -v
```

These tests establish provenance and supervision behavior, not detector accuracy.
Keep the current live detector and human approval workflow until a candidate
improves complete-room results on independently reviewed real drawings.
