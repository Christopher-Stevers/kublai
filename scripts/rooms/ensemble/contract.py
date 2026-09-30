"""One fixed head replacement, original development data and cached actual maps."""
from __future__ import annotations
import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
DATA = Path('/home/tim/datasets/foremanhq-room-detection')
MODELS = REPO / 'scripts/rooms/models'
PARTITION = REPO / 'scripts/rooms/partition/partition.py'
CONTRACT = 'old-interior-new-physical-barriers-single-hypothesis-v1'
PRESET = 'hierarchical_basins'
INFERENCE = {'tile': 512, 'overlap': 128, 'overview': 512, 'threads': 4, 'device': 'cuda'}
MIX = {'interior': 'old-long48-head-0-exact', 'boundary': 'new-true-opening48-head-1-exact',
       'opening_closure': 'new-true-opening48-head-2-exact'}
CLAIM = DATA / 'ensemble/fixed-old-interior-new-barriers-20260930.claim.json'
PINS = {
 'manifest': (DATA / 'models/data-context-20260930/manifest.json', '79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac'),
 'old_binding': (DATA / 'partition/binding-20260930/binding.json', 'c6de300983e801a7e64e9d9f307009444248ad03b06198682607b360592f680f'),
 'old_cache_report': (DATA / 'models/eval-roi-context-long-20260930/report.json', 'cac68bd373761d21faaa8c7a2a7c7d2ee70ee7a6ef1db4ea64593d478e7a31f3'),
 'hierarchy_report': (DATA / 'partition/eval-20260930/report.json', '707cbd22107cedea09bfc018da2f64b0cb30f9b485125271f95d3aa4a56a9e03'),
 'old_checkpoint': (DATA / 'models/train-context-long-20260930/best.pt', 'aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313'),
 'old_run': (DATA / 'models/train-context-long-20260930/run.json', 'df4d658b3091a7b743935764fcd6fe6621da8f799bd8f893deba31bc06a46b82'),
 'new_checkpoint': (DATA / 'models/train-swiss-true-openings-v4-20260930/training/best.pt', '6e2be29bac8fadce06b103e93e08e4bc32d3e79a7b9258217edc5cb87dcb3aa4'),
 'new_run': (DATA / 'models/train-swiss-true-openings-v4-20260930/training/run.json', 'ae03141eb308d6f7ceff8e1b05dcf41196b7ab39f6461578407360ec6b2e1169'),
 'new_training_binding': (DATA / 'models/train-swiss-true-openings-v4-20260930/binding.json', '3a0d95399efec41a86c6d9b1de2362ad7d6af139dcadacd01480d5b1e93b8d69'),
 'new_training_completed': (DATA / 'models/train-swiss-true-openings-v4-20260930/completed.json', 'c28f2faccc8575aadbbaad87c2d25fca3b464c23726a3cbd6d2658b1d88b76b9'),
 'new_training_claim': (DATA / 'models/swiss-true-opening-single-trial-20260930.claim.json', 'a0069b0bdc2d721c8bb63819fef9500b62cd8d1a1afc7c2a961bcf19e7259cec'),
 'new_actual_binding': (DATA / 'models/a511-swiss-true-openings-v4-20260930/probe_binding.json', 'cad904708ae08d34a1d9d7f86600b47d1f8b7868e60e1e634f9c1c15a8642fe6'),
 'new_actual_completed': (DATA / 'models/a511-swiss-true-openings-v4-20260930/probe_completed.json', 'c6feafb477f6508d24b47861e9b7b21400b0aac30e2771c1d6cb9be695ac521b'),
 'new_actual_map': (DATA / 'models/a511-swiss-true-openings-v4-20260930/probabilities.npz', 'a3275485370d377e932a6064a46bf600eeb9a7e53c18439910b6e91871a993d4'),
 'old_actual_map': (DATA / 'models/a511-context-long-20260930/probabilities.npz', '0d486d09885b269a5e4571c7be280a393a0dfa5e50ed5acf19a939521ea2610a'),
 'old_actual_prediction': (DATA / 'models/a511-context-long-20260930/prediction.json', 'c4b05c1ae6f084ca9e679c17a0bf9e3ddd8285238de6618f963bbc20d4937d02'),
 'actual_image': (REPO / '.tmp/a511-source-textfree.png', '0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828'),
}
PARTITION_SHA = '49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713'
DEPENDENCY_PINS = {
 'scripts/rooms/partition/partition.py': PARTITION_SHA,
 'scripts/rooms/bench/metrics.py': '5fb3df697bb9bf14c5a23765d157ba066564c952a5a9a1922837ebb3c271b0a4',
 'scripts/rooms/complete/report_completeness.py': 'c29a524b45c0fba7fb07532d89f6903e67e74cc0856f7e68cdd1279e5144a483',
 'scripts/rooms/models/common.py': '627562580db02d2e00f847c4fb0f55f53e4adb8289fc6d94fb135c244d49ac09',
 'scripts/rooms/models/network.py': '051b79034aaa36e8179d970a2d3501c46aa4e9ca1f1dee0421ca6410021e64b9',
 'scripts/rooms/models/context_network.py': '637193789d5f994e215784a93b119189f47977da815ded5cf96ec4da2ef647ac',
 'scripts/rooms/models/context_predict.py': '25be78fcf3ef890decfa8e11fe9772c3f55af50f83aecadc9d0aa1699ad7458a',
 'scripts/rooms/models/predict.py': 'b10a2c8a563c767fe64f97dcd7dc4b3442e831f41b6b74c3c8983cb15e788249',
}
CPU_RUNTIME = {'python':'3.12.14','numpy':'2.5.3','scipy':'1.18.1','shapely':'2.1.2','scikit_image':'0.26.0','device':'cpu'}
GPU_RUNTIME = {'python':'3.12.14','torch':'2.12.0+cu130','cuda':'13.0','numpy':'2.5.3','pillow':'12.3.0',
               'opencv':'5.0.0.93','scipy':'1.18.1','shapely':'2.1.2'}
GPU_DEVICE = 'NVIDIA GeForce RTX 5060 Ti'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1048576), b''): h.update(b)
    return h.hexdigest()


def write(path, value):
    with Path(path).open('x') as f: json.dump(value, f, indent=2, allow_nan=False)
    Path(path).chmod(0o600)


def pinned_json(path, expected):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected or digest(path) != expected:
        raise ValueError('Pinned metadata changed before decode: ' + str(path))
    return json.loads(raw)


def verify(hashes):
    for name, expected in hashes.items():
        if digest(name) != expected: raise RuntimeError('Frozen bytes changed: ' + name)


def sources():
    paths = sorted(ROOT.glob('*.py'))
    paths += [REPO / name for name in DEPENDENCY_PINS]
    for name, expected in DEPENDENCY_PINS.items():
        if digest(REPO / name) != expected: raise ValueError('Frozen inference/partition/metric source differs: ' + name)
    return {str(p.resolve()): digest(p) for p in paths}


def runtime(scope):
    pairs = [('numpy','numpy'),('scipy','scipy'),('shapely','shapely')]
    if scope == 'cpu': pairs += [('scikit_image','scikit-image')]
    elif scope == 'gpu': pairs += [('torch','torch'),('pillow','pillow'),('opencv','opencv-python-headless')]
    else: raise ValueError('Unknown bounded runtime')
    r = {'python':sys.version.split()[0], **{key:version(package) for key,package in pairs}}
    if scope == 'cpu': r['device']='cpu'
    else:
        # Importing Torch does not initialize a CUDA device. Device access happens
        # only after audit + the original experiment-scoped inference claim.
        import torch
        r['cuda']=torch.version.cuda
    return r


def verify_runtime(scope):
    expected = CPU_RUNTIME if scope == 'cpu' else GPU_RUNTIME
    if runtime(scope) != expected: raise RuntimeError('Pinned inference/partition runtime differs')


def exact_cases(manifest, old_binding, old_report, hierarchy):
    """Metadata-only, independently pinned identities—not a 20-case count gate."""
    validation=[r for r in manifest['records'] if r['split']=='validation']
    records = {r['id']:r for r in validation}
    cases = old_binding['cases']
    historical=hierarchy['results'][PRESET]['cases']
    cache_cases=old_report['results']['baseline_low_barrier']['cases']
    if (len(validation)!=20 or len(records)!=20 or len(cases)!=20 or len({r['id'] for r in cases})!=20 or
        {r['id'] for r in cases}!=set(records) or len(old_report['ids'])!=20 or set(old_report['ids'])!=set(records) or
        len(historical)!=20 or {r['id'] for r in historical}!=set(records) or
        len(cache_cases)!=20 or {r['id'] for r in cache_cases}!=set(records)):
        raise ValueError('Only exactly the original 20 development IDs are allowed')
    if hierarchy['results'][PRESET]['summary']['expected'] != 1321:
        raise ValueError('Historical full synthetic reference denominator differs')
    caches = {r['id']:r for r in cache_cases}
    result=[]
    for case in cases:
        row=records[case['id']]
        if row['source']!='synthetic-msd' or row['split']!='validation' or case['group']!=row['group']:
            raise ValueError('Original development source/group differs')
        for key in ('image','targets'):
            expected=(PINS['manifest'][0].parent / row[key]).resolve()
            if Path(case[key]).resolve()!=expected or old_binding['input_hashes'].get(case[key])!=row[key+'_sha256']:
                raise ValueError('Original image/target association differs before decode')
        probability=Path(case['probabilities']).resolve()
        expected_map=PINS['old_cache_report'][0].parent / (case['id']+'.probabilities.npz')
        if probability!=expected_map.resolve() or old_binding['input_hashes'].get(str(probability))!=caches[case['id']]['probabilities_sha256']:
            raise ValueError('Old probability input/cache association differs before decode')
        result.append({**case,'site':row['site'],'old_probability_sha256':caches[case['id']]['probabilities_sha256'],
                       'image_sha256':row['image_sha256'],'targets_sha256':row['targets_sha256']})
    return result


def metadata_preflight():
    """Hash files and read metadata only; never open a pixel/map/reference array."""
    frozen={str(p.resolve()):sha for p,sha in PINS.values()}
    verify(frozen)
    meta={key:pinned_json(path,sha) for key,(path,sha) in PINS.items() if path.suffix=='.json'}
    old,new=meta['old_run'],meta['new_run']; completed=meta['new_training_completed']
    for row,checkpoint,manifest_sha in ((old,PINS['old_checkpoint'][1],PINS['manifest'][1]),
                                      (new,PINS['new_checkpoint'][1],'619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b')):
        if row['checkpoint_sha256']!=checkpoint or row['manifest_sha256']!=manifest_sha or row['config']['epochs']!=48 or len(row['history'])!=48:
            raise ValueError('Only completed fixed 48-epoch checkpoints are allowed')
        for name,expected in DEPENDENCY_PINS.items():
            architecture=Path(name).name in ('common.py','network.py','context_network.py')
            # OLD maps are reused, not inferred with today's adapter. Its full
            # historical run/cache source identities remain pinned separately.
            if name.startswith('scripts/rooms/models/') and (row is new or architecture) and row['source_hashes'].get(Path(name).name)!=expected:
                raise ValueError('Completed checkpoint inference architecture provenance differs')
    if (completed['returncode']!=0 or completed['binding_sha256']!=PINS['new_training_binding'][1] or
        completed['run_sha256']!=PINS['new_run'][1] or completed['checkpoint_sha256']!=PINS['new_checkpoint'][1]):
        raise ValueError('New checkpoint completion chain differs')
    training=meta['new_training_binding']; claim=meta['new_training_claim']
    if training['assets'].get(str(PINS['new_training_claim'][0]))!=PINS['new_training_claim'][1] or claim['output']!=training['output'] or claim['config']['epochs']!=48:
        raise ValueError('Original new-model training attempt differs')
    original=meta['old_binding']; report=meta['hierarchy_report']; cached=meta['old_cache_report']
    if (original['manifest_sha256']!=PINS['manifest'][1] or original['checkpoint_sha256']!=PINS['old_checkpoint'][1] or
        original['development_report_sha256']!=PINS['old_cache_report'][1] or report['binding_sha256']!=PINS['old_binding'][1] or
        report['runtime']!=CPU_RUNTIME or cached['checkpoint_sha256']!=PINS['old_checkpoint'][1] or cached['manifest_sha256']!=PINS['manifest'][1]):
        raise ValueError('Original completed development/map provenance differs')
    cases=exact_cases(meta['manifest'],original,cached,report)
    for case in cases:
        for key in ('image','targets','probabilities'):
            frozen[case[key]]=original['input_hashes'][case[key]]
    actual=meta['new_actual_binding']; actual_done=meta['new_actual_completed']; old_actual=meta['old_actual_prediction']
    if (actual['checkpoint_sha256']!=PINS['new_checkpoint'][1] or actual['input_sha256']!=PINS['actual_image'][1] or
        actual['probabilities_sha256']!=PINS['new_actual_map'][1] or actual['runtime']!=GPU_RUNTIME or
        actual_done['probe_binding_sha256']!=PINS['new_actual_binding'][1] or
        actual_done['emitted_bindings'].get(str(PINS['new_actual_map'][0]))!=PINS['new_actual_map'][1] or
        old_actual['input_sha256']!=PINS['actual_image'][1] or old_actual['checkpoint_sha256']!=PINS['old_checkpoint'][1] or
        (actual['width'],actual['height'])!=(old_actual['width'],old_actual['height'])):
        raise ValueError('Independently completed actual-map/input/model associations differ')
    for key,expected in (('image',PINS['actual_image'][1]),('probabilities',PINS['old_actual_map'][1]),('prediction',PINS['old_actual_prediction'][1])):
        if original['input_hashes'].get(original['actual'][key])!=expected:
            raise ValueError('Original actual cache association differs')
    verify(frozen)
    return {'contract':CONTRACT,'cases':cases,'input_bindings':frozen,'source_bindings':sources(),
            'fixed_mix':MIX,'preset':PRESET,'inference':INFERENCE,'cpu_runtime':CPU_RUNTIME,'gpu_runtime':GPU_RUNTIME,'gpu_device':GPU_DEVICE,
            'baseline':report['results'][PRESET], 'actual':{'image':str(PINS['actual_image'][0]),
            'old_probability':str(PINS['old_actual_map'][0]),'new_probability':str(PINS['new_actual_map'][0]),
            'width':actual['width'],'height':actual['height']},'expected_development_spaces':1321,
            'no_private_pixels_or_references_decoded':True,'approved_for_production':False,
            'limitations':'Original procedural development only. No Swiss derived GT or protected/new once-only site assets. Actual A511 is qualitative only.'}


def freeze(output):
    preflight=metadata_preflight()
    output=output.resolve();output.mkdir(mode=0o700,parents=True,exist_ok=False)
    snapshot=output/'frozen_sources';snapshot.mkdir(mode=0o700)
    for name,sha in preflight['source_bindings'].items():
        path=Path(name);dest=snapshot/path.relative_to(REPO);dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        shutil.copyfile(path,dest);dest.chmod(0o600)
        if digest(dest)!=sha:raise RuntimeError('Source snapshot changed')
    binding={**preflight,'binding_path':str(output/'binding.json'),'output':str(output),'claim_path':str(CLAIM)}
    write(output/'binding.json',binding)
    CLAIM.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    write(CLAIM,{'contract':CONTRACT,'binding_path':binding['binding_path'],'binding_sha256':digest(output/'binding.json'),
                 'output':str(output),'fixed_mix':MIX,'preset':PRESET})
    verify(binding['input_bindings']);verify(binding['source_bindings'])
    return binding


def read_binding(path,scope=None,require_clear=False):
    path=Path(path).resolve();h=digest(path);binding=pinned_json(path,h)
    claim=pinned_json(CLAIM,digest(CLAIM))
    if (binding.get('contract')!=CONTRACT or binding.get('binding_path')!=str(path) or binding.get('claim_path')!=str(CLAIM) or
        claim.get('binding_path')!=str(path) or claim.get('binding_sha256')!=h or claim.get('output')!=binding.get('output') or
        claim.get('contract')!=CONTRACT or claim.get('fixed_mix')!=MIX or claim.get('preset')!=PRESET or
        binding.get('fixed_mix')!=MIX or binding.get('preset')!=PRESET or binding.get('inference')!=INFERENCE or
        binding.get('cpu_runtime')!=CPU_RUNTIME or binding.get('gpu_runtime')!=GPU_RUNTIME or binding.get('gpu_device')!=GPU_DEVICE):
        raise ValueError('Use only the original claimed binding and fixed hypothesis')
    if binding['source_bindings']!=sources():raise RuntimeError('Frozen ensemble/dependency source drift')
    verify(binding['input_bindings']);verify(binding['source_bindings'])
    for name,expected in binding['source_bindings'].items():
        if digest(path.parent/'frozen_sources'/Path(name).relative_to(REPO))!=expected:
            raise RuntimeError('Archived source snapshot drift')
    # The independently pinned metadata preflight is rerun before array/CUDA access.
    original=metadata_preflight()
    for key in ('cases','input_bindings','source_bindings','baseline','actual','expected_development_spaces'):
        if binding[key]!=original[key]:raise ValueError('Original metadata associations changed before decode')
    if scope:verify_runtime(scope)
    if require_clear:
        clear=path.parent/'AUDIT_CLEAR.json'
        approval=pinned_json(clear,digest(clear))
        if approval.get('decision')!='CLEAR' or approval.get('binding_sha256')!=h or approval.get('source_bindings')!=binding['source_bindings']:
            raise ValueError('Exact frozen preflight/source audit CLEAR is required')
    return binding,h


def claim_phase(binding,binding_sha,phase):
    if phase not in ('inference','scoring','actual'):raise ValueError('Unknown fixed phase')
    path=CLAIM.with_name(CLAIM.name.replace('.claim.json','.'+phase+'.json'))
    clear=Path(binding['output'])/'AUDIT_CLEAR.json'
    write(path,{'contract':CONTRACT,'phase':phase,'binding_path':binding['binding_path'],'binding_sha256':binding_sha,
                'original_claim_path':str(CLAIM),'original_claim_sha256':digest(CLAIM),'audit_clear_sha256':digest(clear),
                'fixed_mix':MIX,'preset':PRESET,'source_bindings':binding['source_bindings'],
                'output':str(Path(binding['output'])/phase)})
    return path,digest(path)


def phase_path(phase, completed=False):
    if phase not in ('inference','scoring','actual'):raise ValueError('Unknown fixed phase')
    suffix='.'+phase+('.completed.json' if completed else '.json')
    return CLAIM.with_name(CLAIM.name.replace('.claim.json',suffix))


def verify_phase(binding,binding_sha,phase,path,expected):
    if Path(path).resolve()!=phase_path(phase).resolve():raise ValueError('Use the original experiment phase claim')
    row=pinned_json(path,expected)
    if (row.get('contract')!=CONTRACT or row.get('phase')!=phase or row.get('binding_path')!=binding['binding_path'] or
        row.get('binding_sha256')!=binding_sha or row.get('original_claim_path')!=str(CLAIM) or
        row.get('original_claim_sha256')!=digest(CLAIM) or row.get('audit_clear_sha256')!=digest(Path(binding['output'])/'AUDIT_CLEAR.json') or
        row.get('source_bindings')!=binding['source_bindings'] or row.get('fixed_mix')!=MIX or row.get('preset')!=PRESET or
        row.get('output')!=str(Path(binding['output'])/phase)):
        raise ValueError('Original attempt/audit/phase association differs')
    return row


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    os.umask(0o077);b=freeze(a.output);print(json.dumps({'binding':b['binding_path'],'sha256':digest(b['binding_path']),
                                                    'cases':len(b['cases']),'gpu_or_scoring_started':False}))
