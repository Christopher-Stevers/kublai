"""Read-only, byte-fenced QA of the one completed domain correction corpus.

No model inference, training, room truth, protected data or detector tuning.
"""
import hashlib
import json
from pathlib import Path
import resource
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

DOMAIN = Path(__file__).resolve().parents[1] / 'domain-data'
sys.path.insert(0, str(DOMAIN))
import contract as domain

MANIFEST_SHA = '78d1ce1e2f9eb9ff9c913e332e767c9fe459cd663ea03c9e3b202398bdd1df82'
COMPLETED_SHA = '7fa4b0247f3fe3ed9e59317ac1934441028cbea3f5288530ea1934643b81d589'
GLOBAL_SHA = '42195f4c515ab641efaee68f3c3bb9f43e1537a7528c6e656be15749924a3035'
OUT = Path('/home/tim/datasets/foremanhq-room-detection/domain-data-qa/data-swiss-domain-v1-20260930')


def check_arrays(target, known, shape):
    if (target.shape != (3, *shape) or known.shape != target.shape or target.dtype != np.uint8
            or known.dtype != np.uint8 or not np.isin(target, (0, 1)).all() or not np.isin(known, (0, 1)).all()
            or np.any(target[2] > target[1])
            or np.any((target[0] > 0) & (target[1] > 0) & (known[0] > 0))):
        raise ValueError('Invalid dimensions/binary/physical subset/supervised interior overlap')
    return {'positive': [int(t.sum()) for t in target], 'known': [int(k.sum()) for k in known],
            'unknown': [int(np.count_nonzero(k == 0)) for k in known],
            'unknown_positive_openings': int(np.count_nonzero((target[2] > 0) & (known[2] == 0)))}


def names_only(files):
    if set(files) != {'target', 'known'}:
        raise ValueError('Only target/known members allowed; no provisional truth')


def distribution(values):
    a = np.asarray(values, dtype=np.float64)
    return {'n': len(values), 'min': float(a.min()), 'p10': float(np.quantile(a, .1)),
            'p50': float(np.quantile(a, .5)), 'p90': float(np.quantile(a, .9)), 'max': float(a.max())}


def run():
    if Path(domain.__file__).resolve() != (DOMAIN / 'contract.py').resolve():
        raise ValueError('Imported domain adapter identity mismatch')
    pins = {str(domain.OUTPUT/'manifest.json'): MANIFEST_SHA,
            str(domain.OUTPUT/'completed.json'): COMPLETED_SHA, str(domain.RECEIPT): GLOBAL_SHA,
            str(Path(__file__).resolve()): domain.digest(__file__)}
    domain.verify(pins); versions = domain.runtime(); started = time.monotonic()
    manifest, completion = domain.completed_build()
    if domain.digest(domain.OUTPUT/'manifest.json') != MANIFEST_SHA:
        raise ValueError('Completed corpus changed before QA')
    rows = sorted(manifest['records'], key=lambda r: r['id'])
    # Metadata-only choice declared before reading any image pixels or targets.
    small = next(r for r in rows if r['render_stats']['density'] == '0.4'
                 and r['render_stats']['wall_ink_style'].startswith('paired'))
    large = next(r for r in rows if r['render_stats']['density'] == '1.0'
                 and r['render_stats']['wall_ink_style'] == 'paired-gray-2')
    selected = [{'id': r['id'], 'density': r['render_stats']['density'],
                 'wall_style': r['render_stats']['wall_ink_style'],
                 'image': str(domain.OUTPUT/r['image']), 'image_sha256': r['image_sha256']} for r in (small, large)]
    totals = {'native_positive': [0,0,0], 'native_known': [0,0,0], 'native_unknown': [0,0,0],
              'coarse_positive': [0,0,0], 'coarse_known': [0,0,0], 'coarse_unknown': [0,0,0],
              'unknown_positive_openings': 0, 'coarse_unknown_positive_openings': 0}
    cases = []
    for row in rows:
        img = domain.asset(domain.OUTPUT,row['image'],row['image_sha256'])
        target_path = domain.asset(domain.OUTPUT,row['targets'],row['targets_sha256'])
        coarse_path = domain.asset(domain.OUTPUT,row['overview'],row['overview_sha256'])
        with Image.open(img) as im:
            if im.mode != 'RGB' or im.size != (2048,1536):
                raise ValueError('Native RGB dimensions/mode changed')
            image = np.asarray(im).copy()
        decoded = []
        for path, shape in ((target_path,(1536,2048)),(coarse_path,(512,512))):
            with np.load(path,allow_pickle=False) as z:
                names_only(z.files); target,known = z['target'].copy(),z['known'].copy()
            counts = check_arrays(target,known,shape)
            decoded.append((target,known,counts))
        domain.verify({str(img):row['image_sha256'],str(target_path):row['targets_sha256'],str(coarse_path):row['overview_sha256']})
        target,known,native = decoded[0]; _,_,coarse = decoded[1]
        stats = row['render_stats']; negative = np.all(known > 0,axis=0) & ~np.any(target > 0,axis=0)
        clearance = ndimage.distance_transform_edt(negative)
        for box in stats['known_negative_pocket_motifs']:
            x0,y0,x1,y1 = box
            if not negative[y0:y1+1,x0:x1+1].all() or clearance[y0:y1+1,x0:x1+1].min() <= 12:
                raise ValueError('Pocket motif touches positive/unknown support or violates margin')
        for item in stats['fixtures']:
            x0,y0,x1,y1 = item['box']
            if not ((target[0,y0:y1+1,x0:x1+1]>0)&(known[0,y0:y1+1,x0:x1+1]>0)&(target[1,y0:y1+1,x0:x1+1]==0)).all():
                raise ValueError('Fixture nuisance crosses supervision support')
        if (len(stats['parking_landscape'])>32 or len(stats['known_negative_pocket_motifs'])>8
                or len(stats['fixtures'])>160 or len(stats['clouds'])!=8
                or stats['physical_opening_pixels']!=native['positive'][2]
                or stats['unknown_positive_opening_pixels']!=native['unknown_positive_openings']
                or stats['unknown_pixels_per_head']!=native['unknown']):
            raise ValueError('Measured native pixels/nuisance caps differ from recorded receipts')
        chromatic = int(np.count_nonzero(np.ptp(image.astype(np.int16),axis=2)>20))
        luma = image.astype(np.float32)@np.asarray([.2126,.7152,.0722],np.float32)
        ink = luma<245
        if chromatic != stats['chromatic_pixels'] or chromatic == 0:
            raise ValueError('Chromatic rendered ink missing or changed')
        for prefix,c in (('native',native),('coarse',coarse)):
            for name in ('positive','known','unknown'):
                totals[prefix+'_'+name] = [a+b for a,b in zip(totals[prefix+'_'+name],c[name])]
        totals['unknown_positive_openings'] += native['unknown_positive_openings']
        totals['coarse_unknown_positive_openings'] += coarse['unknown_positive_openings']
        cases.append({'id':row['id'],'split':row['split'],'density':stats['density'],
                      'wall_style':stats['wall_ink_style'],'native':native,'coarse':coarse,
                      'source_partial':stats['source_semantics_partial'],'fixtures':len(stats['fixtures']),
                      'parking_landscape':len(stats['parking_landscape']),
                      'known_negative_pocket_motifs':len(stats['known_negative_pocket_motifs']),
                      'chromatic_pixels':chromatic,'ink_pixels':int(ink.sum()),
                      'known_negative_ink_per_megapixel':float(np.count_nonzero(ink&negative)/(2048*1536/1e6)),
                      'interior_fraction':float(target[0].mean()),'physical_opening_fraction':float(target[2].mean())})
    domain.verify(pins); final_manifest,final_done=domain.completed_build()
    if final_manifest!=manifest or final_done!=completion or domain.runtime()!=versions:
        raise ValueError('Completion/runtime changed during output QA')
    domain.verify(pins)
    report={'contract':'completed-domain-data-qa-v1','manifest_sha256':MANIFEST_SHA,
            'completed_sha256':COMPLETED_SHA,'global_receipt_sha256':GLOBAL_SHA,
            'qa_source_sha256':pins[str(Path(__file__).resolve())],'runtime':versions,
            'all_space_scoring_eligible':False,'physical_room_ground_truth_certified':False,
            'training_runs':0,'inference_runs':0,'counts':len(cases),'cases':cases,'totals':totals,
            'visual_selection':selected,'source_partial_cases':sum(c['source_partial'] for c in cases),
            'density_counts':{split:{d:sum(c['split']==split and c['density']==d for c in cases)
                                    for d in ('0.4','0.7','1.0')} for split in ('train','validation')},
            'distributions':{k:distribution([c[k] for c in cases]) for k in ('fixtures','parking_landscape',
                             'known_negative_pocket_motifs','chromatic_pixels','known_negative_ink_per_megapixel',
                             'interior_fraction','physical_opening_fraction')},
            'wall_seconds':time.monotonic()-started,'peak_host_rss_mib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
            'limitations':'Native mask/render contract QA, not room matching or real-sheet/model accuracy. Source functional areas are not certified physical-room completeness. No truth members or source reference WKT decoded; two visuals require separate human inspection.'}
    OUT.mkdir(mode=0o700,parents=True,exist_ok=False)
    domain.write(OUT/'report.json',report)
    domain.write(OUT/'completed.json',{'report_sha256':domain.digest(OUT/'report.json'),
                                     'qa_source_sha256':report['qa_source_sha256']})
    print(json.dumps({k:report[k] for k in ('counts','totals','density_counts','distributions','wall_seconds','peak_host_rss_mib','visual_selection')},indent=2))
    print('Report SHA256 '+domain.digest(OUT/'report.json'),flush=True)
    return report


if __name__=='__main__':
    run()
