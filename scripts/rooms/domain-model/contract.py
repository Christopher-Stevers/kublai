"""Separate source-only contract adapter for one authorized domain trial.

No manifest or native asset is interpreted until root authorizes the exact
completed child build and every current executable source byte.
"""
from __future__ import annotations
import hashlib
from importlib.metadata import version
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys

ROOT=Path(__file__).resolve().parent
ROOMS=ROOT.parent
BASE=Path('/home/tim/datasets/foremanhq-room-detection')
DATA_ROOT=BASE/'domain-data/swiss-domain-scale-v1-20260930'
DATA=DATA_ROOT/'manifest.json'
BUILDER=ROOMS/'domain-data'
SWISS=ROOMS/'swiss-model'
MODELS=ROOMS/'models'
ACTUAL=ROOMS.parents[1]/'.tmp/a511-source-textfree.png'
ACTUAL_SHA='0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828'
CONTROL_ROOT=BASE/'models/train-swiss-true-openings-v4-20260930'
# Runtime alias required by the immutable Swiss paired evaluator. Its legacy
# method key frozen_long48 now means genuine Swissv4, not old centerline data.
OLD=CONTROL_ROOT/'training/best.pt'
OLD_SHA='6e2be29bac8fadce06b103e93e08e4bc32d3e79a7b9258217edc5cb87dcb3aa4'
CONTROL_METADATA={
 'run':(CONTROL_ROOT/'training/run.json','ae03141eb308d6f7ceff8e1b05dcf41196b7ab39f6461578407360ec6b2e1169'),
 'binding':(CONTROL_ROOT/'binding.json','3a0d95399efec41a86c6d9b1de2362ad7d6af139dcadacd01480d5b1e93b8d69'),
 'completed':(CONTROL_ROOT/'completed.json','c28f2faccc8575aadbbaad87c2d25fca3b464c23726a3cbd6d2658b1d88b76b9'),
 'original-claim':(BASE/'models/swiss-true-opening-single-trial-20260930.claim.json','a0069b0bdc2d721c8bb63819fef9500b62cd8d1a1afc7c2a961bcf19e7259cec')}
BASELINE_SHA='619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b'
PARTITION=ROOMS/'partition/partition.py'
PARTITION_SHA='49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713'
PREFIX=BASE/'domain-model/swiss-domain-fixed48-20260930'
AUTH=PREFIX.with_name(PREFIX.name+'.root-authorization.json')
CLAIM=PREFIX.with_name(PREFIX.name+'.training.claim.json')
OUTPUTS={p:PREFIX.with_name(PREFIX.name+'.'+p) for p in ('training','heads','actual')}
OUTPUTS['hierarchical']=OUTPUTS['actual']/'hierarchical'
CONFIG=dict(epochs=48,tile=512,batch=2,patches=4,base=16,context_base=8,context_weight=.5,lr=.001,
            seed=20260930,threads=4,device='cuda')
HEADS=['interior','boundary','opening_closure']
GPU_RUNTIME={'python':'3.12.14','torch':'2.12.0+cu130','cuda':'13.0','numpy':'2.5.3','pillow':'12.3.0',
             'opencv':'5.0.0.93','scipy':'1.18.1','shapely':'2.1.2'}
CPU_RUNTIME={'python':'3.12.14','numpy':'2.5.3','Pillow':'12.3.0','scipy':'1.18.1','shapely':'2.1.2','scikit-image':'0.26.0'}
PINS={SWISS/'contract.py':'b52863059c36a9984f4ac2ae6081e601ca9d643f7d5730eb694d23ece1f34d60',
      SWISS/'train_trial.py':'d4ee83cae6b240326684ad0f9128b2e442d682445fc3be74045f2e2b7801cd20',
      SWISS/'evaluate_heads.py':'5d56db3a54703ecb00e436f09f0be94804eb9cf974b667e9a2af2a68450abb47',
      SWISS/'qualitative.py':'a6488a531cc0147c9a33d3701c1b4ee27515032a54f8bad8f8612ea01e7a3c15',
      SWISS/'partition_actual.py':'99dba44780a377f4d7921d9d79056974e6a64db379c0d5f0017d56040c3f3628',
      MODELS/'context_train.py':'4b77b4c8493d8a66acec9ac0d7f383fbc6e025789c0109b54e101f0db04919f5',
      MODELS/'context_predict.py':'25be78fcf3ef890decfa8e11fe9772c3f55af50f83aecadc9d0aa1699ad7458a',
      MODELS/'context_network.py':'637193789d5f994e215784a93b119189f47977da815ded5cf96ec4da2ef647ac',
      MODELS/'network.py':'051b79034aaa36e8179d970a2d3501c46aa4e9ca1f1dee0421ca6410021e64b9',
      MODELS/'common.py':'627562580db02d2e00f847c4fb0f55f53e4adb8289fc6d94fb135c244d49ac09',
      PARTITION:PARTITION_SHA}


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()


def write(path,value):
    path=Path(path)
    with path.open('x') as f:json.dump(value,f,indent=2,allow_nan=False)
    path.chmod(0o600)


def verify(entries):
    for path,sha in entries.items():
        if digest(path)!=sha:raise ValueError('Frozen domain-model bytes changed: '+str(path))


def source_paths(*ignored):
    # Bind whole executable adapters/architecture/builder, not only imported
    # function names. Tests are preserved too. No old corpus paths are followed.
    paths=[]
    for folder in (ROOT,SWISS,MODELS,BUILDER):
        paths.extend(p for p in sorted(folder.glob('*.py')) if folder!=MODELS or not p.name.startswith('test_'))
    return paths+[PARTITION]


def sources():
    verify(PINS)
    return {str(p.resolve()):digest(p) for p in source_paths()}


def runtime(scope):
    if scope=='cpu':return {'python':sys.version.split()[0],**{p:version(p) for p in ('numpy','Pillow','scipy','shapely','scikit-image')}}
    if scope!='gpu':raise ValueError('Unknown fixed runtime')
    import torch
    return {'python':sys.version.split()[0],'torch':torch.__version__,'cuda':torch.version.cuda,
            **{key:version(package) for key,package in (('numpy','numpy'),('pillow','pillow'),('opencv','opencv-python-headless'),('scipy','scipy'),('shapely','shapely'))}}


def fixed_plan():
    return {'contract':'one-swiss-domain48-source-plan-v1','config':CONFIG,'manifest':str(DATA),
            'baseline_manifest_sha256':BASELINE_SHA,'outputs':{p:str(v) for p,v in OUTPUTS.items()},
            'paired_control':{'role':'genuine Swissv4 true-opening48; same physical target/source split',
              'legacy_method_key':'frozen_long48','checkpoint':str(OLD),'checkpoint_sha256':OLD_SHA,
              'training_manifest_sha256':BASELINE_SHA,'completed_lineage':{str(p):sha for p,sha in CONTROL_METADATA.values()}},
            'training_claim':str(CLAIM),'head_threshold':.5,'inference':{'tile':512,'overlap':128,'overview':512},
            'actual_presets':['plain-.4','hierarchical_basins'],'original_context20_transfer':False,
            'original_context20_or_protected_assets_decoded':False,'all_space_scoring_eligible':False,
            'gpu_runtime':GPU_RUNTIME,'cpu_runtime':CPU_RUNTIME,'approved_for_production':False}


def validate_authorization(value,current):
    if (value.get('decision')!='AUTHORIZE' or not value.get('reviewer') or value.get('plan')!=fixed_plan() or
        value.get('source_bindings')!=current or value.get('dataset_audit_outcome')!='CLEAR'):
        raise ValueError('Root authorization must pin this exact source/plan/completed child build')
    for key in ('manifest_sha256','dataset_completed_sha256','dataset_original_receipt_sha256','dataset_binding_sha256','dataset_claim_sha256'):
        sha=value.get(key)
        if not isinstance(sha,str) or len(sha)!=64 or any(ch not in '0123456789abcdef' for ch in sha):
            raise ValueError('Independent completed dataset hashes are mandatory')


def load_module(name,path,aliases=None):
    """Explicit unique module names and scoped import aliases; always restore."""
    aliases=aliases or {};previous={key:sys.modules.get(key) for key in aliases}
    try:
        sys.modules.update(aliases)
        spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
        sys.modules[name]=module;spec.loader.exec_module(module);return module
    finally:
        for key,value in previous.items():
            if value is None:sys.modules.pop(key,None)
            else:sys.modules[key]=value


def completed_data_gate(authorization):
    """Only call after source/auth gates; builder checks pre/post raw bytes."""
    # No same-name `contract`/`render` leakage to the domain-model namespace.
    expected={DATA:authorization['manifest_sha256'],DATA_ROOT/'completed.json':authorization['dataset_completed_sha256'],
              DATA_ROOT/'binding.json':authorization['dataset_binding_sha256'],
              DATA_ROOT.parent/'swiss-domain-scale-v1-20260930.completed.json':authorization['dataset_original_receipt_sha256'],
              DATA_ROOT.parent/'swiss-domain-scale-v1-20260930.build.claim.json':authorization['dataset_claim_sha256']}
    verify(expected)
    rendering=load_module('domain_data_render_verified',BUILDER/'render.py')
    builder=load_module('domain_data_contract_verified',BUILDER/'contract.py',{'render':rendering})
    manifest,done=builder.completed_build()
    verify(expected)
    if done['manifest_sha256']!=authorization['manifest_sha256']:raise ValueError('Authorized completed manifest association changed')
    return manifest,done,builder


def validate_metadata(data):
    if (data.get('dataset_contract')!='swiss-domain-scale-and-structured-sheet-v1' or data.get('baseline_manifest_sha256')!=BASELINE_SHA or
        data.get('counts')!={'train':80,'validation':20} or data.get('overview')!=512 or data.get('heads')!=HEADS or
        data.get('room_truth_member')!='absent' or any(data.get(k) is not False for k in
        ('physical_room_ground_truth_certified','all_space_scoring_eligible','human_completeness_evidence'))):
        raise ValueError('Only generated native masked heads with no room truth are eligible')
    rows=data['records']
    if len(rows)!=100 or len({r['id'] for r in rows})!=100:raise ValueError('Exact source100 coverage required')
    if {s:sum(r['split']==s for r in rows) for s in ('train','validation')}!={'train':80,'validation':20}:
        raise ValueError('Original80/20 grouped split required')


def validate_control_metadata(values):
    run,binding,done,claim=(values[k] for k in ('run','binding','completed','original-claim'))
    run_sha=CONTROL_METADATA['run'][1];binding_sha=CONTROL_METADATA['binding'][1];claim_path,claim_sha=CONTROL_METADATA['original-claim']
    if (run.get('checkpoint_sha256')!=OLD_SHA or run.get('manifest_sha256')!=BASELINE_SHA or
        run.get('heads')!=HEADS or run.get('parameters')!=2456454 or
        len(run.get('history',[]))!=48 or [r.get('epoch') for r in run['history']]!=list(range(1,49)) or
        any(run.get('config',{}).get(k)!=v for k,v in CONFIG.items()) or done.get('returncode')!=0 or
        done.get('checkpoint_sha256')!=OLD_SHA or done.get('run_sha256')!=run_sha or done.get('binding_sha256')!=binding_sha or
        binding.get('output')!=str(CONTROL_ROOT) or binding.get('config')!=CONFIG or
        binding.get('assets',{}).get(str(claim_path))!=claim_sha or claim.get('output')!=str(CONTROL_ROOT) or
        claim.get('config')!=CONFIG or claim.get('manifest_sha256')!=BASELINE_SHA or
        binding.get('approved_for_production') is not False or binding.get('all_space_scoring_eligible') is not False):
        raise ValueError('Paired control must be the original completed genuine Swissv4 fixed48 model')
    for path,sha in PINS.items():
        if path.parent==MODELS and run.get('source_hashes',{}).get(path.name)!=sha:
            raise ValueError('Genuine Swissv4 control architecture/trainer/inference source identity differs')


def control_lineage():
    pins={str(OLD):OLD_SHA,**{str(p):sha for p,sha in CONTROL_METADATA.values()}}
    verify(pins)
    values={}
    for role,(path,sha) in CONTROL_METADATA.items():
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Control metadata changed before decode')
        values[role]=json.loads(raw);verify({str(path):sha})
    validate_control_metadata(values);verify(pins)
    return pins


def prepare(scope):
    current=sources()  # executable sources are bound before any manifest parse
    raw=AUTH.read_bytes();pin=hashlib.sha256(raw).hexdigest();authorization=json.loads(raw)
    validate_authorization(authorization,current)
    if runtime(scope)!=(GPU_RUNTIME if scope=='gpu' else CPU_RUNTIME):raise ValueError('Declared runtime differs')
    control_lineage()
    data,done,builder=completed_data_gate(authorization);validate_metadata(data)
    verify(current)
    if digest(AUTH)!=pin:raise ValueError('Root authorization changed during completed metadata verification')
    return authorization,current,data,done,builder,pin


def archive_sources(folder,paths):
    folder=Path(folder);folder.mkdir(mode=0o700);result={}
    for path in paths:
        relative=Path(path).relative_to(ROOMS);dest=folder/relative
        dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True);shutil.copyfile(path,dest);dest.chmod(0o600)
        result[str(relative)]=digest(dest)
        if result[str(relative)]!=digest(path):raise ValueError('Archived source changed')
    # Preserve completed control metadata byte-for-byte, separately from model
    # source files. Architecture metadata filters only models/ as before.
    control_lineage();directory=folder/'control-lineage';directory.mkdir(mode=0o700)
    for role,(path,sha) in CONTROL_METADATA.items():
        dest=directory/(role+'.json');shutil.copyfile(path,dest);dest.chmod(0o600)
        if digest(dest)!=sha:raise ValueError('Archived genuine-control metadata changed')
        result['control-lineage/'+role+'.json']=sha
    write(folder/'hashes.json',result);return result


def legacy_contract(prepared):
    """Adapt only runtime bindings; every reused source file stays byte-identical."""
    authorization,current,data,done,builder,auth_sha=prepared
    sys.path.insert(0,str(MODELS))
    legacy=load_module('domain_swiss_contract_verified',SWISS/'contract.py')
    legacy.DATA=DATA;legacy.DATA_SHA=authorization['manifest_sha256'];legacy.CLAIM=CLAIM
    legacy.OLD=OLD;legacy.OLD_SHA=OLD_SHA
    legacy.ROOT=ROOT;legacy.CONFIG=CONFIG;legacy.source_paths=source_paths;legacy.archive_sources=archive_sources
    legacy.validate_metadata=validate_metadata
    def preflight():
        # This is invoked by the unmodified Swiss trainer before native decode.
        repeated=prepare('gpu')
        if repeated[0]!=authorization:raise ValueError('Completed dataset authorization changed')
        import numpy as np
        from PIL import Image
        assets={str(AUTH):auth_sha,str(DATA):authorization['manifest_sha256'],str(DATA_ROOT/'completed.json'):authorization['dataset_completed_sha256'],
                str(DATA_ROOT/'binding.json'):authorization['dataset_binding_sha256'],str(builder.CLAIM):authorization['dataset_claim_sha256'],
                str(DATA_ROOT.parent/'swiss-domain-scale-v1-20260930.completed.json'):authorization['dataset_original_receipt_sha256'],
                **control_lineage(),**done['emitted_hashes'],**builder.read_binding()[0]['input_bindings'],**builder.read_binding()[0]['baseline_bindings'],
                str(OLD):OLD_SHA,str(ACTUAL):ACTUAL_SHA,str(PARTITION):PARTITION_SHA}
        verify(assets)
        compatible=legacy.read_context_manifest(DATA);validate_metadata(compatible)
        unknown=0
        for row in compatible['records']:
            paths={key:legacy.checked_asset(DATA.parent,row[key],row[key+'_sha256']) for key in ('image','targets','overview','references')}
            with Image.open(paths['image']) as image:
                if image.mode!='RGB' or image.size!=(2048,1536):raise ValueError('Fixed bounded domain RGB page required')
            with np.load(paths['targets'],allow_pickle=False) as z:
                if set(z.files)!={'target','known'}:raise ValueError('Room truth/unknown NPZ members cannot enter this trial')
                legacy.validate_arrays(z['target'],z['known'],(3,1536,2048));unknown+=int((z['known']==0).any())
            with np.load(paths['overview'],allow_pickle=False) as z:
                if set(z.files)!={'target','known'}:raise ValueError('Coarse supervision must contain only masked heads')
                legacy.validate_arrays(z['target'],z['known'],(3,512,512))
            verify({str(p):row[key+'_sha256'] for key,p in paths.items()})
        verify(assets);verify(current)
        return compatible,assets,{'cases_with_unknown_pixels':unknown,'unchanged_trainer_compatible':True,
                                 'all_space_scoring_eligible':False,'unknown_preserving_domain_data':True}
    legacy.preflight=preflight
    return legacy
