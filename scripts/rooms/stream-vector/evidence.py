"""Read the complete, hashed paint spool; never accept a truncated page as success."""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
import re

MAX_BYTES = 256 * 1024**2
MAX_RECORD = 16 * 1024**2


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def records(root):
    root = Path(root)
    summary = json.loads((root / 'summary.json').read_text())
    if summary['version'] != 'pdfbox-stream-ink-v1' or summary['uncompressedBytes'] > MAX_BYTES:
        raise ValueError('Unsupported or oversized evidence')
    total_bytes = total_records = events = paths = states = clips = headers = 0
    seen_names = set()
    for name, digest, compressed_bytes, declared_bytes, declared_records in summary['chunks']:
        if not re.fullmatch(r'paint-\d{4}\.jsonl\.gz', name) or name in seen_names:
            raise ValueError('Invalid chunk name')
        seen_names.add(name)
        path = root / name
        if path.is_symlink() or path.stat().st_size != compressed_bytes or sha(path) != digest:
            raise ValueError('Original compressed bytes changed')
        chunk_bytes = chunk_records = 0
        with gzip.open(path, 'rb') as f:
            while line := f.readline(MAX_RECORD + 1):
                if len(line) > MAX_RECORD or not line.endswith(b'\n'):
                    raise ValueError('Oversized or partial record')
                chunk_bytes += len(line)
                chunk_records += 1
                if total_bytes + chunk_bytes > MAX_BYTES:
                    raise ValueError('Expanded evidence budget')
                r = json.loads(line, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
                if not isinstance(r, list) or not r:
                    raise ValueError('Invalid record')
                kind = r[0]
                if kind == 'header':
                    headers += 1
                    if total_records + chunk_records != 1 or r[1] != summary['version'] or r[2:4] != [summary['width'], summary['height']]:
                        raise ValueError('Header mismatch')
                elif kind in {'s', 'c'}:
                    if r[1] != (states if kind == 's' else clips):
                        raise ValueError('Non-contiguous state/clip ID')
                    if kind == 's':
                        if not 0 <= r[2][14] < clips:
                            raise ValueError('Unknown clipping state')
                        states += 1
                    else:
                        clips += 1
                elif kind in {'p', 'glyph', 'image', 'shading', 'annotation', 'unsupported'}:
                    events += 1
                    if r[1] != events or not 0 <= r[3] < states:
                        raise ValueError('Non-contiguous paint or unknown state')
                    if kind == 'p':
                        paths += 1
                else:
                    raise ValueError('Unknown record kind')
                yield r
        if (chunk_bytes, chunk_records) != (declared_bytes, declared_records) or sha(path) != digest:
            raise ValueError('Chunk count/hash disagreement')
        total_bytes += chunk_bytes
        total_records += chunk_records
    if (total_bytes, total_records, events, paths, states, clips, headers) != (
            summary['uncompressedBytes'], summary['records'], summary['events'], summary['paths'],
            summary['states'], summary['clips'], 1):
        raise ValueError('Whole-page count disagreement')
