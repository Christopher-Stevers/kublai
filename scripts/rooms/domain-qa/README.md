# Completed domain-corpus QA

`inspect_data.py` performs a read-only check of the exact completed domain corpus. It pins the original manifest/completion/global receipt, calls the independently fenced `domain-data/contract.completed_build()` before and after native decoding, and checks only the authorized 100 generated images and target/known assets. No model, provisional truth, source WKT, protected/generalization assets, training or room matching is used.

The private completed report is `/home/tim/datasets/foremanhq-room-detection/domain-data-qa/data-swiss-domain-v1-20260930/report.json`, SHA-256 `c6944e872c78ea21cbd337a781bb6fd8eee03b13a15035f603a48d3b60525875`. The exact executed QA source is preserved alongside it, SHA-256 `61e93f3ff1339b7f07fad7cca429127b83fb20505f00c2f3dcc9d19342bbcadd`. It need not be rerun.

Three fabricated tests exercise unknown positive openings, dimensions/binary/subset/known-interior overlap rejection, and truth-member rejection without accessing a corpus:

```bash
cd /home/tim/.openclaw/worktrees/foremanhq-reliability/scripts/rooms/domain-qa
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python -m unittest -v test_inspect_data
```

The [completed data report](../../../docs/ROOM_DOMAIN_SCALE_DATA_2026-09-30.md) records pixel totals, nuisance distributions, two fixed visual samples and limitations. Those are data-contract checks, never physical-room or actual-sheet accuracy.
