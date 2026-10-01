"""One declared A511 development trial. Frozen references/holdouts are not read."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys
import time

import numpy as np
import scipy
import skimage
from PIL import Image, ImageDraw, __version__ as pillow_version

from repeat import proposals, FIXED as REPEAT_SETTINGS
from passages import partition, FIXED as PASSAGE_SETTINGS
from vector_barrier import build

HERE = Path(__file__).resolve().parent
PNG_SHA = '0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828'
STREAM_SUMMARY_SHA = '955fb5823cdd83dbbd52e842af3adffe53aef362d887f35534878376221c7307'
LONG_SIDE = 2048
# An exposed-development example selected visually on the source drawing only.
# It is NOT a user-approved room or independent room ground truth.
EXAMPLE_SOURCE_PIXELS = [[778, 502], [956, 502], [956, 646], [778, 646]]


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write(path, obj):
    with Path(path).open('x') as f:
        json.dump(obj, f, indent=2, allow_nan=False)
        f.write('\n')


def labels_overlay(source, labels, cuts):
    rgb = np.array(source.convert('RGB')).copy()
    for ident in range(1, int(labels.max())+1):
        color = np.array([(ident*83) % 180+45, (ident*127) % 180+45, (ident*193) % 180+45])
        mask = labels == ident
        rgb[mask] = (rgb[mask]*.5+color*.5).astype(np.uint8)
    result = Image.fromarray(rgb)
    draw = ImageDraw.Draw(result)
    for cut in cuts:
        draw.line([tuple(cut['a']), tuple(cut['b'])], fill='red', width=3)
    return result


def run(source_png, stream_root, output):
    source_png, stream_root, output = Path(source_png).resolve(), Path(stream_root).resolve(), Path(output).absolute()
    if sha(source_png) != PNG_SHA or sha(stream_root/'summary.json') != STREAM_SUMMARY_SHA:
        raise ValueError('Wrong source image or streamed evidence summary')
    plan = {'version': 'spatial-hypotheses-a511-v1', 'input_sha256': PNG_SHA,
            'stream_summary_sha256': STREAM_SUMMARY_SHA, 'output': str(output),
            'input_png': str(source_png), 'input_stream': str(stream_root),
            'long_side': LONG_SIDE, 'png_gray_threshold': 200,
            'vector_width_rule': 'twice modal positive width', 'vector_max_rgb': 80,
            'repeat_settings': REPEAT_SETTINGS, 'passage_settings': PASSAGE_SETTINGS,
            'example_source_pixels': EXAMPLE_SOURCE_PIXELS, 'example_kind': 'development-hypothesis',
            'conditions': ['raster_passages', 'structural_vector_passages', 'raster_repeat', 'structural_vector_repeat'],
            'runtime': {'python': platform.python_version(), 'executable': sys.executable, 'numpy': np.__version__,
                        'scipy': scipy.__version__, 'skimage': skimage.__version__, 'pillow': pillow_version},
            'sources': {p.name: sha(p) for p in sorted(HERE.glob('*.py'))},
            'reader_sha256': sha(HERE.parent/'stream-vector/evidence.py'),
            'room_accuracy_measured': False, 'production_promotion': False}
    write(output.with_name(output.name+'.claim.json'), plan)
    output.mkdir()
    write(output/'plan.json', plan)
    (output/'sources').mkdir()
    for name in plan['sources']:
        (output/'sources'/name).write_bytes((HERE/name).read_bytes())
    started = time.monotonic()
    try:
        with Image.open(source_png) as im:
            scale = LONG_SIDE/max(im.size)
            source = im.convert('RGB').resize((round(im.width*scale), round(im.height*scale)), Image.Resampling.BOX)
        raster = np.asarray(source.convert('L')) < 200
        structural, vector_info = build(stream_root, LONG_SIDE)
        if structural.shape != raster.shape:
            raise ValueError('Incompatible source coordinate frame')
        example_im = Image.new('1', source.size)
        ImageDraw.Draw(example_im).polygon([(round(x*scale), round(y*scale)) for x, y in EXAMPLE_SOURCE_PIXELS], fill=1)
        example = np.asarray(example_im).astype(bool)
        results = {'vector_evidence': vector_info}
        # Every predeclared condition gets either a retained success or failure.
        # A failed method is not silently rerun with different thresholds.
        for key, ink in [('raster', raster), ('structural_vector', structural)]:
            Image.fromarray(np.uint8(~ink)*255).save(output/(key+'_ink.png'))
            try:
                labels, cuts, diag = partition(ink)
                np.save(output/(key+'_labels.npy'), labels, allow_pickle=False)
                write(output/(key+'_cuts.json'), cuts)
                labels_overlay(source, labels, cuts).save(output/(key+'_passages.png'))
                results[key+'_passages'] = {'status': 'completed', **diag}
            except (ValueError, RuntimeError) as e:
                results[key+'_passages'] = {'status': 'failed', 'error': str(e)}
            try:
                rows, diag = proposals(ink, example, 'development-hypothesis')
                labels = np.zeros(ink.shape, np.int32)
                labels[example] = 1
                details = []
                for ident, row in enumerate(rows, 2):
                    h, w = row['mask'].shape
                    labels[row['y']:row['y']+h, row['x']:row['x']+w][row['mask']] = ident
                    np.save(output/f'{key}_repeat_{ident}_mask.npy', row['mask'], allow_pickle=False)
                    details.append({k: v for k, v in row.items() if k != 'mask'})
                np.save(output/(key+'_repeat_labels.npy'), labels, allow_pickle=False)
                write(output/(key+'_repeat.json'), details)
                labels_overlay(source, labels, []).save(output/(key+'_repeat.png'))
                results[key+'_repeat'] = {'status': 'completed', 'proposals': len(rows), **diag}
            except (ValueError, RuntimeError) as e:
                results[key+'_repeat'] = {'status': 'failed', 'error': str(e)}
        if sha(source_png) != PNG_SHA or sha(stream_root/'summary.json') != STREAM_SUMMARY_SHA or any(
                sha(HERE/n) != digest or sha(output/'sources'/n) != digest for n, digest in plan['sources'].items()):
            raise ValueError('Input/source mutated during trial')
        results.update({'seconds': time.monotonic()-started, 'room_accuracy_measured': False,
                        'promoted_to_production': False, 'plan_sha256': sha(output/'plan.json'),
                        'artifacts': {p.name: sha(p) for p in sorted(output.iterdir()) if p.is_file()}})
        write(output/'completed.json', results)
        return results
    except Exception as e:
        write(output/'failure.json', {'error': str(e)})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-png', type=Path, required=True)
    parser.add_argument('--stream-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.source_png, args.stream_root, args.output), indent=2))
