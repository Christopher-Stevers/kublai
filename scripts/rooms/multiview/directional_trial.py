"""One fixed Suite K directional-registration attempt on already exposed pages.

No PDF decoder, GT, training, provider, model or room-copy path is invoked.
Original rasters and old four target ROIs are immutable input contracts.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import sys
import time

import numpy as np
import scipy
import PIL
from PIL import Image, ImageDraw
from directional_registration import SETTINGS, register, apply

HERE = Path(__file__).resolve().parent
BASE = Path('/home/tim/datasets/foremanhq-room-detection/stream-vector')
OUTPUT = BASE/'suite-k-directional-v1-20261002'
CROP = [1240, 150, 2135, 1290]
ROIS = [[321, 0, 1395, 1218], [3421, 0, 4495, 1218],
        [743, 0, 1817, 1218], [3026, 0, 4100, 1270]]
PDF_SHA = '17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f'
INPUTS = {
    'pdf': (Path('/home/tim/Documents/Codex/2026-09-20/ins/output/ForemanHQ-original-drawings.pdf'), PDF_SHA),
    'floor': (BASE/'verified-page18-textfree-20261001.png', '0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828'),
    'detail': (BASE/'detail-page25-textfree-v1-20261001.png', '820bb00583eab427b9aa0f9e84b27f7c0a0630d2c266ec2ca86dabcc433762e8'),
    'floor_receipt': (BASE/'cached-png-page-receipt-20261001.json', '3f66cff8a60ded1746c0b1fe49844e94ed1be5cd227335a43b715150629d6506'),
    'detail_receipt': (BASE/'detail-page25-textfree-v1-20261001.png.receipt.json', 'c2ccbed27545840dc3ea599ff066e4a6eab7d06f832d773b4624a59ac4b4a80a'),
    'old_plan': (BASE/'suite-k-registration-v1-20261001/plan.json', '962bf438cf7dbeda8a7b4cc2fb9863003bd5ced7f4e49adbccd85c9d9d27058c'),
    'old_completed': (BASE/'suite-k-registration-v1-20261001/completed.json', '46a243973054bdafd246b46e5386a6c8928e7274dbed68809b1804909afc2f6c'),
    'index': (BASE/'drawing-set-index-v1-20261001/index.json', 'dae62971a8ec12158462cd24401f2126284f27fbab9f4dd69ecc6fd1c2821f05'),
}
OWN = ['directional_registration.py', 'directional_trial.py', 'test_directional_registration.py',
       'test_directional_trial.py', 'DIRECTIONAL_REGISTRATION.md']
MAX_OUTPUT_BYTES = 256*1024*1024


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk := f.read(1024*1024): h.update(chunk)
    return h.hexdigest()


def read_checked(path, expected):
    if sha(path) != expected: raise ValueError(f'Changed bytes: {path}')
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected: raise ValueError('JSON read byte drift')
    value = json.loads(raw)
    if sha(path) != expected: raise ValueError('JSON decode byte drift')
    return value


def write(path, value):
    raw = (json.dumps(value, indent=2, allow_nan=False)+'\n').encode()
    with Path(path).open('xb') as f: f.write(raw)
    expected = hashlib.sha256(raw).hexdigest()
    if sha(path) != expected: raise ValueError('JSON emission byte drift')
    return expected


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__,
            'pillow': PIL.__version__, 'executable': str(Path(sys.executable).absolute()),
            'torch_imported': 'torch' in sys.modules}


def verify_inputs():
    for path, expected in INPUTS.values():
        if sha(path) != expected: raise ValueError(f'Changed fixed input: {path}')


def metadata(old, completed, floor_receipt, detail_receipt):
    if (old['source_crop_pixels'] != CROP or old['printed_scale_ratio'] != .4 or
            len(old['targets']) != 4 or len(completed['results']) != 4):
        raise ValueError('Old crop/scale/target contract changed')
    targets = []
    for i, r in enumerate(completed['results']):
        if r['roi'] != ROIS[i] or r['instance'] != old['targets'][i]:
            raise ValueError('Old ROI or indexed target identity changed')
        t = r['instance']; b = t['anchor_box_normalized']
        if (t['page_number'] != 18 or t['page_index'] != 17 or t['suite_type'] != 'K' or
                len(b) != 4 or not np.isfinite(b).all() or not (0 <= b[0] < b[2] <= 1 and 0 <= b[1] < b[3] <= 1)):
            raise ValueError('Invalid indexed source anchor')
        anchor = [(b[0]+b[2])*2500, (b[1]+b[3])*1875]
        targets.append({'ordinal': i, 'instance': t, 'roi': ROIS[i], 'anchor_page_pixels': anchor})
    for role, receipt, page in [('floor', floor_receipt, 18), ('detail', detail_receipt, 25)]:
        # The old cached receipt uses explicit binding fields; the render receipt
        # uses camelCase. Both pin original PDF page rather than the DB slot.
        actual_page = receipt.get('pdfPageNumber', receipt.get('sourcePdfPageNumber'))
        if actual_page is None: actual_page = receipt.get('pdf_page_number')
        source_sha = receipt.get('sourcePdfSha256', receipt.get('pdf_sha256'))
        png_sha = receipt.get('pngSha256', receipt.get('cacheSha256', receipt.get('png_sha256')))
        if actual_page != page or source_sha != PDF_SHA or png_sha != INPUTS[role][1]:
            raise ValueError('Original PDF/raster page identity disagrees')
    return targets


def verify_fence(plan, plan_sha):
    if sha(OUTPUT/'plan.json') != plan_sha: raise ValueError('Plan changed')
    if Path(plan['output']).resolve() != OUTPUT.resolve(): raise ValueError('Copied output')
    if runtime() != plan['runtime']: raise ValueError('Runtime changed')
    verify_inputs()
    for name, expected in plan['sources'].items():
        if sha(HERE/name) != expected or sha(OUTPUT/'sources'/name) != expected:
            raise ValueError('Current/archive source changed')


def validate_report(report, plan_sha, claim_sha):
    if (report['plan_sha256'] != plan_sha or report['claim_sha256'] != claim_sha or
            report['runtime'] != runtime() or report['all_four_target_ids'] != list(range(4)) or
            [r['ordinal'] for r in report['results']] != list(range(4)) or
            report['room_accuracy_measured'] is not False or report['approved_for_production'] is not False):
        raise ValueError('Completed report identity/scope/coverage mismatch')
    for i, r in enumerate(report['results']):
        if r['roi'] != ROIS[i] or r['instance']['page_number'] != 18 or r['instance']['suite_type'] != 'K':
            raise ValueError('Completed target identity mismatch')


def display_peak(result):
    chosen = result.get('chosen_peak_id')
    if chosen is not None:
        matches = [p for p in result['peaks'] if p['id'] == chosen]
        if len(matches) != 1: raise ValueError('Display chosen-peak identity mismatch')
        return matches[0]
    return min(result['peaks'], key=lambda p: p['fit_mean']) if result['peaks'] else None


def worker(plan_sha, claim_sha):
    plan = read_checked(OUTPUT/'plan.json', plan_sha)
    claim = read_checked(OUTPUT.with_suffix('.claim.json'), claim_sha)
    if (claim['plan_sha256'] != plan_sha or claim['parent_pid'] != os.getppid() or
            claim['output'] != str(OUTPUT) or claim['sources'] != plan['sources']):
        raise ValueError('Original parent/attempt join failed')
    write(OUTPUT/'worker_started.json', {'plan_sha256': plan_sha, 'claim_sha256': claim_sha,
                                      'parent_pid': os.getppid(), 'worker_pid': os.getpid()})
    started = time.monotonic(); emitted = {}; results = []
    try:
        verify_fence(plan, plan_sha)
        floor = Image.open(INPUTS['floor'][0]).convert('RGB')
        detail_page = Image.open(INPUTS['detail'][0]).convert('RGB')
        if floor.size != (5000,3750) or detail_page.size != (5000,3750):
            raise ValueError('Native full-page dimensions changed')
        detail = detail_page.crop(CROP)
        detail.save(OUTPUT/'template.png'); emitted['template.png'] = sha(OUTPUT/'template.png')
        source = np.array(detail)
        canvas = floor.copy(); draw = ImageDraw.Draw(canvas)
        for target in plan['targets']:
            i, roi = target['ordinal'], target['roi']
            crop = floor.crop(roi)
            name = f'instance-{i}.png'; crop.save(OUTPUT/name); emitted[name] = sha(OUTPUT/name)
            local_anchor = np.array(target['anchor_page_pixels'])-roi[:2]
            try:
                r, maps = register(source, np.array(crop), local_anchor, deadline=claim['deadline_monotonic'])
                np.savez_compressed(OUTPUT/f'cost-surfaces-{i}.npz', **maps)
                emitted[f'cost-surfaces-{i}.npz'] = sha(OUTPUT/f'cost-surfaces-{i}.npz')
                for p in r['peaks']:
                    local = np.array(p['matrix_crop_to_roi'])
                    offset = np.array([[1.,0,roi[0]],[0,1,roi[1]],[0,0,1]])
                    p['matrix_crop_to_page'] = (offset@local).tolist()
                    p['matrix_crop_to_normalized_page'] = (np.diag([1/5000,1/3750,1])@offset@local).tolist()
                best = display_peak(r)
                r['displayed_peak_id'] = best['id'] if best else None
                r['displayed_peak_geometrically_supported'] = best['geometrically_supported'] if best else False
                r['displayed_choice_reason'] = ('chosen-unreviewed-registration' if r.get('chosen_peak_id') else
                                                'lowest-fit-diagnostic-not-selected' if best else 'no-peak')
                if best:
                    local_canvas = crop.copy(); local_draw = ImageDraw.Draw(local_canvas)
                    for s in r['segments']:
                        xy = apply(best['matrix_scaled_to_roi'],[s['a'],s['b']])
                        color = (20,170,240) if s['group']=='fit' else (215,35,190)
                        local_draw.line([tuple(p) for p in xy],fill=color,width=2)
                        draw.line([tuple(p+roi[:2]) for p in xy],fill=color,width=3)
                    overlay = f'instance-{i}-overlay.png'; local_canvas.save(OUTPUT/overlay); emitted[overlay]=sha(OUTPUT/overlay)
                    draw.text((roi[0]+10,roi[1]+10),f'K{i}: {r["status"]} / drawn {best["id"]}',fill=(200,30,40),stroke_width=1)
                r.update(target)
                name=f'instance-{i}.json'; emitted[name]=write(OUTPUT/name,r)
                results.append(r)
            except (ValueError,RuntimeError) as error:
                failure={**target,'status':'failed','error':str(error),'room_accuracy_measured':False}
                name=f'instance-{i}-failure.json'; emitted[name]=write(OUTPUT/name,failure); results.append(failure)
            print(json.dumps({'ordinal':i,'status':results[-1]['status'],
                              'peaks':len(results[-1].get('peaks',[])), 'seconds':results[-1].get('seconds')}),flush=True)
        canvas.save(OUTPUT/'candidate-page-overlay.png'); emitted['candidate-page-overlay.png']=sha(OUTPUT/'candidate-page-overlay.png')
        verify_fence(plan,plan_sha)
        if sha(OUTPUT.with_suffix('.claim.json')) != claim_sha: raise ValueError('Attempt claim changed')
        if time.monotonic()>claim['deadline_monotonic']: raise RuntimeError('Overall CPU process budget')
        for name,expected in emitted.items():
            if sha(OUTPUT/name)!=expected: raise ValueError('Emitted artifact changed')
        if sum(p.stat().st_size for p in OUTPUT.iterdir() if p.is_file())>MAX_OUTPUT_BYTES:
            raise RuntimeError('Output byte budget')
        report={'version':'suite-k-directional-v1','plan_sha256':plan_sha,'claim_sha256':claim_sha,
                'results':results,'emitted':emitted,'seconds':time.monotonic()-started,
                'peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,
                'runtime':runtime(),'all_four_target_ids':[r['ordinal'] for r in results],
                'room_outlines_inferred':False,'room_accuracy_measured':False,'approved_for_production':False}
        write(OUTPUT/'report.json',report)
    except Exception as error:
        write(OUTPUT/'failure.json',{'error':str(error),'plan_sha256':plan_sha,'claim_sha256':claim_sha,'partial_emitted':emitted})
        raise


def run():
    start=time.monotonic(); sources={name:sha(HERE/name) for name in OWN}; rt=runtime()
    verify_inputs()
    old=read_checked(*INPUTS['old_plan']); complete=read_checked(*INPUTS['old_completed'])
    floor_receipt=read_checked(*INPUTS['floor_receipt']); detail_receipt=read_checked(*INPUTS['detail_receipt'])
    targets=metadata(old,complete,floor_receipt,detail_receipt)
    if runtime()!=rt or any(sha(HERE/n)!=h for n,h in sources.items()): raise ValueError('Preflight source/runtime drift')
    plan={'version':'suite-k-directional-v1','output':str(OUTPUT),'settings':SETTINGS,'source_crop_pixels':CROP,
          'targets':targets,'inputs':{k:{'path':str(p),'sha256':h} for k,(p,h) in INPUTS.items()},
          'sources':sources,'runtime':rt,'maximum_output_bytes':MAX_OUTPUT_BYTES,
          'warning':'Old detail full-page native image omission lies outside the fixed vector-only crop; unchanged source bytes retained.',
          'room_outlines_inferred':False,'room_accuracy_measured':False,'approved_for_production':False}
    # Fixed original path and exclusive claim spend this exact declaration once.
    claim_path=OUTPUT.with_suffix('.claim.json')
    if claim_path.exists() or OUTPUT.exists(): raise ValueError('Original declaration already attempted')
    OUTPUT.mkdir(); (OUTPUT/'sources').mkdir()
    for name,h in sources.items():
        raw=(HERE/name).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=h: raise ValueError('Archive-entry source drift')
        (OUTPUT/'sources'/name).write_bytes(raw)
    plan_sha=write(OUTPUT/'plan.json',plan)
    claim_sha=write(claim_path,{'output':str(OUTPUT),'parent_pid':os.getpid(),'plan_sha256':plan_sha,
                              'sources':sources,'deadline_monotonic':start+SETTINGS['overall_seconds']})
    verify_fence(plan,plan_sha)
    env=dict(os.environ,OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1',MKL_NUM_THREADS='1',NUMEXPR_NUM_THREADS='1')
    try:
        with (OUTPUT/'stdout.jsonl').open('xb') as stdout, (OUTPUT/'stderr.log').open('xb') as stderr:
            p=subprocess.run([sys.executable,str(HERE/'directional_trial.py'),'--worker',plan_sha,claim_sha],
                             stdout=stdout,stderr=stderr,env=env,
                             timeout=max(.1,start+SETTINGS['overall_seconds']-time.monotonic()),check=False)
        if p.returncode!=0: raise RuntimeError(f'Worker exit {p.returncode}; original logs retained')
        report_sha=sha(OUTPUT/'report.json'); report=read_checked(OUTPUT/'report.json',report_sha)
        validate_report(report,plan_sha,claim_sha)
        verify_fence(plan,plan_sha)
        if sha(claim_path)!=claim_sha: raise ValueError('Parent claim drift')
        for name,h in report['emitted'].items():
            if sha(OUTPUT/name)!=h: raise ValueError('Parent final emitted byte drift')
        if sha(OUTPUT/'report.json') != report_sha: raise ValueError('Parent final report drift')
        if sum(p.stat().st_size for p in OUTPUT.rglob('*') if p.is_file()) > MAX_OUTPUT_BYTES:
            raise RuntimeError('Parent output byte budget')
        if time.monotonic()-start > SETTINGS['overall_seconds']:
            raise RuntimeError('Parent final overall CPU process budget')
        write(OUTPUT/'completed.json',{'output':str(OUTPUT),'plan_sha256':plan_sha,'claim_sha256':claim_sha,
              'report_sha256':report_sha,'stdout_sha256':sha(OUTPUT/'stdout.jsonl'),'stderr_sha256':sha(OUTPUT/'stderr.log'),
              'overall_wall_seconds':time.monotonic()-start,'returncode':0,'room_accuracy_measured':False,'approved_for_production':False})
        return report
    except Exception as error:
        write(OUTPUT/'parent-failure.json',{'error':str(error),'plan_sha256':plan_sha,'claim_sha256':claim_sha,
                                         'overall_wall_seconds':time.monotonic()-start})
        raise


if __name__=='__main__':
    if len(sys.argv)==4 and sys.argv[1]=='--worker': worker(sys.argv[2],sys.argv[3])
    elif len(sys.argv)==1:
        r=run(); print(json.dumps({'output':str(OUTPUT),'statuses':[s['status'] for s in r['results']],
                                  'seconds':r['seconds'],'peak_rss_bytes':r['peak_rss_bytes']}))
    else: raise ValueError('Only the fixed original declaration is executable')
