"""Correctly bound vector-only replay, preserving the original invalid pairing.

Same frozen algorithms and settings, different correctly identified source page.
Image-only conditions already consumed the correct image; do not repeat them.
"""
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

from page_binding import sha, validate
HERE = Path(__file__).resolve().parent
SPATIAL = HERE.parent/'spatial-hypotheses'
sys.path.insert(0, str(SPATIAL))
from passages import partition
from repeat import proposals
from vector_barrier import build
from trial import labels_overlay, EXAMPLE_SOURCE_PIXELS, write

BASE = Path('/home/tim/datasets/foremanhq-room-detection/stream-vector')
RECEIPT = BASE/'cached-png-page-receipt-20261001.json'
RECEIPT_SHA = '3f66cff8a60ded1746c0b1fe49844e94ed1be5cd227335a43b715150629d6506'
PNG = BASE/'verified-page18-textfree-20261001.png'
VECTOR = BASE/'a511-sourcepage18-stream-v1-20261001'
OUTPUT = BASE/'a511-paired-spatial-v1-20261001'


def run():
    binding = validate(RECEIPT, RECEIPT_SHA, PNG, VECTOR)
    own = [HERE/'page_binding.py', HERE/'paired_trial.py', *sorted(SPATIAL.glob('*.py'))]
    plan = {'version': 'paired-spatial-v1', 'binding': binding,
            'sources': {str(p): sha(p) for p in own}, 'long_side': 2048,
            'conditions': ['structural_vector_passages', 'structural_vector_repeat'],
            'example_source_pixels': EXAMPLE_SOURCE_PIXELS, 'example_kind': 'development-hypothesis',
            'reason': 'Correct prior adjacent-page vector/image pairing; old outputs retained and disqualified',
            'previous_unpaired_plan_sha256': 'e79a8a6c948f87425a701a4808ccbe8e3a969179f5d2e3d05837b807cb732aa9',
            'room_accuracy_measured': False, 'approved_for_production': False}
    write(OUTPUT.with_name(OUTPUT.name+'.claim.json'), plan)
    OUTPUT.mkdir()
    write(OUTPUT/'plan.json', plan)
    (OUTPUT/'sources').mkdir()
    for p in own:
        (OUTPUT/'sources'/p.name).write_bytes(p.read_bytes())
    try:
        source = Image.open(PNG).convert('RGB').resize((2048, 1536), Image.Resampling.BOX)
        ink, vector_diag = build(VECTOR/'paint', 2048)
        Image.fromarray(np.uint8(~ink)*255).save(OUTPUT/'structural-ink.png')
        result = {'binding': binding, 'vector': vector_diag}
        try:
            labels, cuts, diag = partition(ink)
            np.save(OUTPUT/'labels.npy', labels, allow_pickle=False)
            write(OUTPUT/'cuts.json', cuts)
            labels_overlay(source, labels, cuts).save(OUTPUT/'passages.png')
            result['passages'] = {'status': 'completed', **diag}
        except (ValueError, RuntimeError) as e:
            result['passages'] = {'status': 'failed', 'error': str(e)}
        try:
            ex = Image.new('1', source.size)
            ImageDraw.Draw(ex).polygon([(round(x*2048/5000), round(y*2048/5000)) for x, y in EXAMPLE_SOURCE_PIXELS], fill=1)
            example = np.asarray(ex).astype(bool)
            rows, diag = proposals(ink, example, 'development-hypothesis')
            labels = np.zeros(ink.shape, np.int32)
            labels[example] = 1
            for ident, row in enumerate(rows, 2):
                h, w = row['mask'].shape
                labels[row['y']:row['y']+h, row['x']:row['x']+w][row['mask']] = ident
            np.save(OUTPUT/'repeat-labels.npy', labels, allow_pickle=False)
            write(OUTPUT/'repeat.json', [{k: v for k, v in r.items() if k != 'mask'} for r in rows])
            labels_overlay(source, labels, []).save(OUTPUT/'repeat.png')
            result['repeat'] = {'status': 'completed', 'proposals': len(rows), **diag}
        except (ValueError, RuntimeError) as e:
            result['repeat'] = {'status': 'failed', 'error': str(e)}
        if binding != validate(RECEIPT, RECEIPT_SHA, PNG, VECTOR) or any(sha(p) != s for p, s in plan['sources'].items()):
            raise ValueError('Binding/source changed')
        result.update({'room_accuracy_measured': False, 'approved_for_production': False,
                       'artifacts': {p.name: sha(p) for p in sorted(OUTPUT.iterdir()) if p.is_file()}})
        write(OUTPUT/'completed.json', result)
        return result
    except Exception as e:
        write(OUTPUT/'failure.json', {'error': str(e)})
        raise


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))
