"""Fixed suite K detail-to-four-floor-instances registration study.

One development crop was chosen by inspecting the source detail page before any
registration. It is a view crop, not a room outline/GT. All four indexed K labels
are attempted, including failures. Native images outside this crop failed in the
old PDF.js renderer; the paint stream must prove no image intersects this crop.
"""
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

from page_binding import sha, validate
from registration import register, apply, FIXED

HERE = Path(__file__).resolve().parent
BASE = Path('/home/tim/datasets/foremanhq-room-detection/stream-vector')
sys.path.insert(0, str(HERE.parent/'stream-vector'))
from evidence import records
FLOOR = BASE/'verified-page18-textfree-20261001.png'
DETAIL = BASE/'detail-page25-textfree-v1-20261001.png'
INDEX = BASE/'drawing-set-index-v1-20261001/index.json'
INDEX_SHA = 'dae62971a8ec12158462cd24401f2126284f27fbab9f4dd69ecc6fd1c2821f05'
CROP = [1240, 150, 2135, 1290]  # top suite K main-plan view; 5000x3750 source pixels
RATIO = .4  # detail 1:50 -> floor 1:125, equal full-page raster dimensions
OUTPUT = BASE/'suite-k-registration-v1-20261001'


def write(path, obj):
    with path.open('x') as f:
        json.dump(obj, f, indent=2, allow_nan=False)
        f.write('\n')


def run():
    if sha(INDEX) != INDEX_SHA:
        raise ValueError('Drawing index changed')
    floor_binding = validate(BASE/'cached-png-page-receipt-20261001.json',
        '3f66cff8a60ded1746c0b1fe49844e94ed1be5cd227335a43b715150629d6506', FLOOR,
        BASE/'a511-sourcepage18-stream-v1-20261001')
    detail_receipt = Path(str(DETAIL)+'.receipt.json')
    detail_binding = validate(detail_receipt, sha(detail_receipt), DETAIL, BASE/'detail-page25-stream-v1-20261001')
    if floor_binding['pdf_sha256'] != detail_binding['pdf_sha256'] or (floor_binding['pdf_page_number'], detail_binding['pdf_page_number']) != (18, 25):
        raise ValueError('Unexpected source pages')
    for record in records(BASE/'detail-page25-stream-v1-20261001/paint'):
        if record[0] == 'image':
            b = [v*5000/3456 for v in record[5]]
            if b[0] < CROP[2] and b[2] > CROP[0] and b[1] < CROP[3] and b[3] > CROP[1]:
                raise ValueError('Partially decoded native image overlaps detail crop')
    index = json.loads(INDEX.read_text())
    targets = [l['instance'] for l in index['links'] if l['instance']['page_number'] == 18 and l['instance']['suite_type'] == 'K']
    if len(targets) != 4:
        raise ValueError('Declared indexed instance list changed')
    paths = [HERE/'atlas_trial.py', HERE/'registration.py', HERE/'page_binding.py']
    plan = {'version': 'suite-k-cross-sheet-v1', 'floor_binding': floor_binding, 'detail_binding': detail_binding,
            'index_sha256': INDEX_SHA, 'source_crop_pixels': CROP, 'printed_scale_ratio': RATIO,
            'targets': targets, 'settings': FIXED, 'source_sha256s': {p.name: sha(p) for p in paths},
            'warning': 'Detail-page JBIG2 images were not decoded, but all image bounds are outside the selected vector-only crop',
            'room_outlines_inferred': False, 'production_promotion': False}
    write(OUTPUT.with_name(OUTPUT.name+'.claim.json'), plan)
    OUTPUT.mkdir()
    write(OUTPUT/'plan.json', plan)
    (OUTPUT/'sources').mkdir()
    for p in paths:
        (OUTPUT/'sources'/p.name).write_bytes(p.read_bytes())
    try:
        floor = Image.open(FLOOR).convert('RGB')
        detail = Image.open(DETAIL).convert('RGB').crop(CROP)
        detail.save(OUTPUT/'template.png')
        source = np.asarray(detail.convert('L'), dtype=np.float32)/255
        canvas = floor.copy(); draw = ImageDraw.Draw(canvas)
        results = []
        for ordinal, target in enumerate(targets):
            b = target['anchor_box_normalized']
            cx, cy = (b[0]+b[2])/2*floor.width, (b[1]+b[3])/2*floor.height
            rx, ry = detail.width*RATIO*1.5, detail.height*RATIO*1.5
            roi = [max(0, round(cx-rx)), max(0, round(cy-ry)), min(floor.width, round(cx+rx)), min(floor.height, round(cy+ry))]
            target_image = floor.crop(roi)
            target_image.save(OUTPUT/f'instance-{ordinal}.png')
            try:
                candidates, diag = register(source, np.asarray(target_image.convert('L'), dtype=np.float32)/255, RATIO)
                attached = []
                for candidate in candidates:
                    m = np.array(candidate['matrix_source_to_target'])
                    local_anchor = apply(np.linalg.inv(m), [[cx-roi[0], cy-roi[1]]])[0]
                    if not (0 <= local_anchor[0] < detail.width and 0 <= local_anchor[1] < detail.height):
                        candidate['rejected_reason'] = 'transform misses indexed suite label'
                        continue
                    attached.append(candidate)
                    corners = apply(m, [[0,0],[detail.width-1,0],[detail.width-1,detail.height-1],[0,detail.height-1],[0,0]])
                    draw.line([(float(x+roi[0]), float(y+roi[1])) for x,y in corners], fill=(230,30,180), width=6)
                results.append({'instance': target, 'roi': roi, 'status': 'completed', 'registrations': attached, 'diagnostics': diag})
            except (ValueError, RuntimeError) as e:
                results.append({'instance': target, 'roi': roi, 'status': 'failed', 'error': str(e)})
        canvas.save(OUTPUT/'registrations.png')
        if any(sha(p) != plan['source_sha256s'][p.name] for p in paths) or sha(INDEX) != INDEX_SHA:
            raise ValueError('Study source changed')
        write(OUTPUT/'completed.json', {'results': results,
              'room_outlines_inferred': False, 'room_accuracy_measured': False, 'approved_for_production': False,
              'artifacts': {p.name: sha(p) for p in sorted(OUTPUT.iterdir()) if p.is_file()}})
        return [{'status': r['status'], 'registrations': len(r.get('registrations', [])),
                 'diagnostics': r.get('diagnostics'), 'error': r.get('error')} for r in results]
    except Exception as e:
        write(OUTPUT/'failure.json', {'error': str(e)})
        raise


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))
