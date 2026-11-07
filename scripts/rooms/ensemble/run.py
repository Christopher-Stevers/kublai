"""Execute the three original-claim phases of one fixed structural ensemble.

Inference opens only the original development RGB pages. Scoring waits until
all predictions are finished before opening any reference. Actual uses caches.
"""
from __future__ import annotations
import argparse
import colorsys
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

import numpy as np

from compose import compose_probability, validate_probability
import contract as c


def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


def head_hashes(probability):
    validate_probability(probability)
    return [hashlib.sha256(np.ascontiguousarray(head).tobytes()).hexdigest() for head in probability]


def checked_probability(path, expected):
    """Hash before array decode and after; validate every head, even unused ones."""
    c.verify({str(path):expected})
    with np.load(path,allow_pickle=False) as saved:result=saved['probability'].copy()
    c.verify({str(path):expected});validate_probability(result)
    return result


def checked_rgb(path,expected):
    from PIL import Image
    c.verify({str(path):expected})
    with Image.open(path) as image:
        if image.width*image.height>30_000_000:raise ValueError('RGB page exceeds fixed budget')
        result=np.asarray(image.convert('RGB'),dtype=np.float32)/255
    c.verify({str(path):expected})
    return result


def coverage(rows,expected):
    ids=[row['id'] for row in rows]
    if len(ids)!=len(expected) or len(set(ids))!=len(ids) or set(ids)!=set(expected):
        raise ValueError('Partial, duplicated or substituted original case coverage')


class Artifacts:
    """Capture each emission immediately, before another result can be emitted."""
    def __init__(self, output):
        self.output=Path(output);self.output.mkdir(mode=0o700,exist_ok=False)
        self.receipts=self.output/'receipts';self.receipts.mkdir(mode=0o700)
        self.hashes={}

    def capture(self,path):
        path=Path(path).resolve()
        if not path.is_relative_to(self.output.resolve()) or str(path) in self.hashes:
            raise ValueError('Artifact must be a new file inside the original output')
        path.chmod(0o600);sha=c.digest(path)
        receipt=self.receipts/f'{len(self.hashes):04d}.json'
        c.write(receipt,{'path':str(path),'sha256':sha})
        if c.digest(path)!=sha:raise RuntimeError('Artifact changed immediately after emission')
        self.hashes[str(path)]=sha;self.hashes[str(receipt.resolve())]=c.digest(receipt)
        return sha

    def json(self,name,value):
        path=self.output/name;c.write(path,value);return self.capture(path)

    def arrays(self,name,**arrays):
        path=self.output/name
        with path.open('xb') as stream:np.savez_compressed(stream,**arrays)
        return self.capture(path)

    def labels(self,name,value):
        path=self.output/name
        with path.open('xb') as stream:stream.write(value.astype('<i4').tobytes())
        return self.capture(path)


def begin(binding_path,phase,scope):
    binding,bsha=c.read_binding(binding_path,scope=scope,require_clear=True)
    claim,claim_sha=c.claim_phase(binding,bsha,phase)
    artifacts=Artifacts(Path(binding['output'])/phase)
    artifacts.json('started.json',{'contract':c.CONTRACT,'phase':phase,'binding_sha256':bsha,
                                  'claim_path':str(claim),'claim_sha256':claim_sha,
                                  'source_bindings':binding['source_bindings'],'runtime':c.runtime(scope)})
    return binding,bsha,claim,claim_sha,artifacts


def fences(binding,bsha,phase,claim,claim_sha,artifacts,scope):
    c.verify(binding['input_bindings']);c.verify(binding['source_bindings']);c.verify(artifacts.hashes)
    if c.digest(binding['binding_path'])!=bsha or c.sources()!=binding['source_bindings']:
        raise RuntimeError('Original binding/source changed during execution')
    c.verify_phase(binding,bsha,phase,claim,claim_sha);c.verify_runtime(scope)


def finish(binding,bsha,phase,claim,claim_sha,artifacts,scope,report):
    report_sha=artifacts.json('report.json',report)
    fences(binding,bsha,phase,claim,claim_sha,artifacts,scope)
    completed={'contract':c.CONTRACT,'phase':phase,'status':'completed','binding_sha256':bsha,
               'original_claim_sha256':c.digest(c.CLAIM),'claim_path':str(claim),'claim_sha256':claim_sha,
               'report_path':str(artifacts.output/'report.json'),'report_sha256':report_sha,
               'source_bindings':binding['source_bindings'],'input_bindings':binding['input_bindings'],
               'emitted_bindings':dict(artifacts.hashes),'runtime':c.runtime(scope),
               'fixed_mix':c.MIX,'preset':c.PRESET,'approved_for_production':False}
    path=artifacts.output/'completed.json';c.write(path,completed);sha=c.digest(path)
    # A completed marker has its own original-path receipt outside removable
    # output directories; changing output paths cannot reset a spent attempt.
    fences(binding,bsha,phase,claim,claim_sha,artifacts,scope)
    c.write(c.phase_path(phase,True),{'contract':c.CONTRACT,'phase':phase,'binding_sha256':bsha,
            'claim_sha256':claim_sha,'completed_path':str(path),'completed_sha256':sha})
    if c.digest(path)!=sha:raise RuntimeError('Completed marker changed during final capture')
    return report


def failed(artifacts,phase,exc):
    # An unhandled failure permanently spends this phase. There is no retry or
    # fallback path, and an incomplete output cannot be consumed downstream.
    path=artifacts.output/'failed.json'
    if not path.exists():c.write(path,{'phase':phase,'status':'failed','error':str(exc),
                                      'emitted_bindings':dict(artifacts.hashes)})


def completed_phase(binding,bsha,phase):
    receipt_path=c.phase_path(phase,True)
    receipt=c.pinned_json(receipt_path,c.digest(receipt_path))
    output=Path(binding['output'])/phase;path=output/'completed.json'
    if (receipt.get('contract')!=c.CONTRACT or receipt.get('phase')!=phase or receipt.get('binding_sha256')!=bsha or
        receipt.get('completed_path')!=str(path)):
        raise ValueError('Only the original phase completion receipt is allowed')
    done=c.pinned_json(path,receipt['completed_sha256'])
    claim=c.phase_path(phase);c.verify_phase(binding,bsha,phase,claim,receipt['claim_sha256'])
    scope='gpu' if phase=='inference' else 'cpu'
    if (done.get('contract')!=c.CONTRACT or done.get('status')!='completed' or done.get('phase')!=phase or
        done.get('binding_sha256')!=bsha or done.get('original_claim_sha256')!=c.digest(c.CLAIM) or
        done.get('claim_path')!=str(claim) or done.get('claim_sha256')!=receipt['claim_sha256'] or
        done.get('source_bindings')!=binding['source_bindings'] or done.get('input_bindings')!=binding['input_bindings'] or
        done.get('runtime')!=(c.GPU_RUNTIME if scope=='gpu' else c.CPU_RUNTIME) or
        done.get('fixed_mix')!=c.MIX or done.get('preset')!=c.PRESET or done.get('report_path')!=str(output/'report.json') or
        done.get('emitted_bindings',{}).get(str(output/'report.json'))!=done.get('report_sha256')):
        raise ValueError('Original completed phase provenance differs')
    if any(not Path(name).resolve().is_relative_to(output.resolve()) for name in done['emitted_bindings']):
        raise ValueError('Completed artifacts must be in the original phase output')
    c.verify(done['emitted_bindings'])
    report=c.pinned_json(output/'report.json',done['report_sha256'])
    if (report.get('binding_sha256')!=bsha or report.get('source_bindings')!=binding['source_bindings'] or
        report.get('runtime')!=done['runtime'] or report.get('fixed_mix')!=c.MIX or report.get('preset')!=c.PRESET):
        raise ValueError('Completed report does not match the frozen experiment')
    return report,done


def inference_rows(report,binding,done):
    rows=report['cases'];coverage(rows,[r['id'] for r in binding['cases']])
    byid={row['id']:row for row in rows}
    for case in binding['cases']:
        row=byid[case['id']];path=Path(binding['output'])/'inference'/(case['id']+'.probabilities.npz')
        if (row.get('status')!='ok' or row.get('image')!=case['image'] or row.get('image_sha256')!=case['image_sha256'] or
            row.get('checkpoint_sha256')!=c.PINS['new_checkpoint'][1] or row.get('probabilities')!=str(path) or
            done['emitted_bindings'].get(str(path))!=row.get('probabilities_sha256') or
            row.get('group')!=case['group'] or row.get('site')!=case['site'] or
            row.get('head_names')!=['interior','boundary','opening_closure'] or row.get('width',0)*row.get('height',0)>30_000_000 or
            min(row.get('width',0),row.get('height',0))<1 or len(row.get('head_sha256',[]))!=3):
            raise ValueError('Exact source/cache/checkpoint/head associations are required for all 20 inference cases')
    return byid


def base_report(binding,bsha,scope):
    return {'contract':c.CONTRACT,'binding_path':binding['binding_path'],'binding_sha256':bsha,
            'input_bindings':binding['input_bindings'],'source_bindings':binding['source_bindings'],
            'runtime':c.runtime(scope),'fixed_mix':c.MIX,'preset':c.PRESET,
            'approved_for_production':False,'synthetic_development_only':True,
            'limitations':'One fixed hypothesis. Procedural development metrics do not establish real-sheet completeness. Swiss derived references are never scored. Actual A511 has no complete reference.'}


def infer(binding_path):
    binding,bsha,claim,claim_sha,a=begin(binding_path,'inference','gpu')
    try:
        sys.path.insert(0,str(c.MODELS))
        from context_predict import context_probabilities,load_context_model,runtime_versions
        import torch
        if runtime_versions()!=c.GPU_RUNTIME:raise RuntimeError('Inference runtime changed after imports')
        torch.set_num_threads(c.INFERENCE['threads']);device=torch.device('cuda')
        if not torch.cuda.is_available():raise RuntimeError('CUDA unavailable; this single attempt cannot fall back')
        if torch.cuda.get_device_name(device)!=c.GPU_DEVICE:raise RuntimeError('Pinned CUDA device differs')
        model,metadata=load_context_model(c.PINS['new_checkpoint'][0],device)
        if (metadata['tile']!=512 or metadata['overview']!=512 or metadata['base']!=16 or metadata['context_base']!=8 or
            metadata['manifest_sha256']!='619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b'):
            raise ValueError('Frozen new checkpoint architecture/page contract differs')
        fences(binding,bsha,'inference',claim,claim_sha,a,'gpu')
        rows=[];torch.cuda.reset_peak_memory_stats(device);started=time.monotonic()
        for case in binding['cases']:
            t=time.monotonic();image=checked_rgb(case['image'],case['image_sha256'])
            p,overview=context_probabilities(model,image,512,128,512,device)
            validate_probability(p)
            if p.shape!=(3,*image.shape[:2]):raise ValueError('New heads must preserve original native pixel grid')
            name=case['id']+'.probabilities.npz';sha=a.arrays(name,probability=p,overview_interior=overview)
            rows.append({'id':case['id'],'group':case['group'],'site':case['site'],'status':'ok',
                         'image':case['image'],'image_sha256':case['image_sha256'],
                         'checkpoint_sha256':c.PINS['new_checkpoint'][1],'width':image.shape[1],'height':image.shape[0],
                         'probabilities':str(a.output/name),'probabilities_sha256':sha,'head_sha256':head_hashes(p),
                         'head_names':['interior','boundary','opening_closure'],'wall_seconds':time.monotonic()-t})
            print(json.dumps({'phase':'inference','completed':len(rows),'total':20}),flush=True)
        coverage(rows,[r['id'] for r in binding['cases']])
        report={**base_report(binding,bsha,'gpu'),'cases':rows,'inference':c.INFERENCE,
                'checkpoint_sha256':c.PINS['new_checkpoint'][1],'wall_seconds':time.monotonic()-started,
                'cuda_device':torch.cuda.get_device_name(device),'peak_cuda_allocated_mib':torch.cuda.max_memory_allocated(device)/2**20,
                'references_decoded':False,'actual_inference_performed':False}
        inference_rows(report,binding,{'emitted_bindings':a.hashes})
        return finish(binding,bsha,'inference',claim,claim_sha,a,'gpu',report)
    except BaseException as exc:failed(a,'inference',exc);raise


def dependencies():
    partition=module('ensemble_frozen_partition',c.PARTITION)
    metrics=module('ensemble_frozen_metrics',c.REPO/'scripts/rooms/bench/metrics.py')
    complete=module('ensemble_frozen_completeness',c.REPO/'scripts/rooms/complete/report_completeness.py')
    return partition,metrics,complete


def checked_labels(path,expected,height,width):
    c.verify({str(path):expected});labels=np.fromfile(path,dtype='<i4')
    c.verify({str(path):expected})
    if labels.size!=height*width:raise ValueError('Exact labels export has wrong byte length')
    return labels.reshape(height,width)


def comparison(current,baseline):
    keys=['tp50','fp50','fn50','f1_50','recall50','precision50','tp75','fp75','fn75','f1_75','recall75','precision75',
          'merge_candidates','split_candidates','expected','predicted','failures']
    return {key:current[key]-baseline[key] for key in keys}


def scoring_coverage(report,binding,metrics,complete):
    group=report['result'];rows=group['cases'];coverage(rows,[r['id'] for r in binding['cases']])
    if any(row.get('metrics') is None or row.get('status') not in ('ok','failed') for row in rows):
        raise ValueError('Failures and partial cases cannot disappear from development coverage')
    if group['summary']!=metrics.aggregate(rows) or group['completeness']!=complete.completeness_metrics(rows):
        raise ValueError('Complete per-floor synthetic metrics disagree with aggregate/completeness')
    if group['summary']['expected']!=1321 or group['completeness']['evaluated_nonempty_floors']!=20 or group['completeness']['partial_floors_skipped']!=0:
        raise ValueError('All 20 original complete synthetic floors/1321 references must remain')
    if report.get('historical_baseline')!=binding['baseline'] or report.get('baseline_report_sha256')!=c.PINS['hierarchy_report'][1]:
        raise ValueError('Use only the pinned historical hierarchy result, without rerunning it')
    if report.get('delta_vs_historical')!=comparison(group['summary'],binding['baseline']['summary']):
        raise ValueError('Historical comparison disagrees with fixed result')


def score_development(binding_path):
    # The completion chain is validated before spending the scoring attempt.
    binding,bsha=c.read_binding(binding_path,scope='cpu',require_clear=True)
    inferred,infer_done=completed_phase(binding,bsha,'inference');new_rows=inference_rows(inferred,binding,infer_done)
    binding,bsha,claim,claim_sha,a=begin(binding_path,'scoring','cpu')
    try:
        part,metrics,complete=dependencies();predictions=[];started=time.monotonic()
        for case in binding['cases']:
            t=time.monotonic();newrow=new_rows[case['id']]
            old=checked_probability(case['probabilities'],case['old_probability_sha256'])
            new=checked_probability(newrow['probabilities'],newrow['probabilities_sha256'])
            if new.shape!=(3,newrow['height'],newrow['width']) or head_hashes(new)!=newrow['head_sha256']:
                raise ValueError('Completed new inference dimensions/head bytes changed')
            p=compose_probability(old,new);heads=head_hashes(p)
            if heads!=[head_hashes(old)[0],*head_hashes(new)[1:]]:raise RuntimeError('Exact component-copy violation')
            name=case['id'];p_sha=a.arrays(name+'.probabilities.npz',probability=p)
            try:
                labels,rooms,diagnostics=part.partition_rooms(p,c.PRESET);status,error='ok',None
            except (ValueError,RuntimeError) as exc:
                labels=np.zeros(p.shape[1:],dtype=np.int32);rooms=[];diagnostics={};status,error='failed',str(exc)
            labels_sha=a.labels(name+'.labels.i32',labels);room_sha=a.json(name+'.rooms.json',rooms)
            predictions.append({'id':name,'group':case['group'],'site':case['site'],'status':status,'error':error,
                'width':p.shape[2],'height':p.shape[1],'probabilities_sha256':p_sha,'head_sha256':heads,
                'old_probability_sha256':case['old_probability_sha256'],'new_probability_sha256':newrow['probabilities_sha256'],
                'labels':str(a.output/(name+'.labels.i32')),'labels_sha256':labels_sha,'rooms_sha256':room_sha,
                'exported_polygons':len(rooms),'diagnostics':diagnostics,'timing':{'wall_ms':(time.monotonic()-t)*1000}})
            print(json.dumps({'phase':'partition','completed':len(predictions),'total':20}),flush=True)
        coverage(predictions,[r['id'] for r in binding['cases']])
        # Strong ordering: all twenty fixed, exported predictions exist before
        # the first complete procedural reference is ever decoded.
        fences(binding,bsha,'scoring',claim,claim_sha,a,'cpu');completed_phase(binding,bsha,'inference')
        source_cases={case['id']:case for case in binding['cases']};rows=[]
        for prediction in predictions:
            case=source_cases[prediction['id']];path=case['targets']
            c.verify({path:case['targets_sha256']})
            with np.load(path,allow_pickle=False) as arrays:truth,known=arrays['truth'].copy(),arrays['known'].copy()
            c.verify({path:case['targets_sha256']})
            if truth.shape!=(prediction['height'],prediction['width']) or not np.all(known==1):
                raise ValueError('Only original complete aligned procedural references are eligible')
            labels=checked_labels(prediction['labels'],prediction['labels_sha256'],prediction['height'],prediction['width'])
            rows.append({**prediction,'metrics':metrics.score(truth,labels)})
        group={'cases':rows,'summary':metrics.aggregate(rows),'completeness':complete.completeness_metrics(rows)}
        report={**base_report(binding,bsha,'cpu'),'result':group,'historical_baseline':binding['baseline'],
            'baseline_report_sha256':c.PINS['hierarchy_report'][1],
            'delta_vs_historical':comparison(group['summary'],binding['baseline']['summary']),
            'inference_completion_sha256':c.digest(Path(binding['output'])/'inference/completed.json'),
            'fixed_partition':part.FIXED,'fixed_hierarchical_preset':part.PRESETS[c.PRESET],
            'wall_seconds':time.monotonic()-started,'all_predictions_finished_before_reference_decode':True,
            'all_space_scoring_scope':'Original 20 procedural development floors only; 1321 source-generated references.'}
        scoring_coverage(report,binding,metrics,complete)
        return finish(binding,bsha,'scoring',claim,claim_sha,a,'cpu',report)
    except BaseException as exc:failed(a,'scoring',exc);raise


def overlay(image,labels,rooms,a):
    from PIL import Image,ImageDraw
    pixels=np.uint8(np.clip(image*255,0,255));height,width=labels.shape
    colors=np.zeros((len(rooms)+1,3),dtype=np.float32)
    for ident in range(1,len(colors)):colors[ident]=np.array(colorsys.hsv_to_rgb((ident*.61803398875)%1,.8,.95))*255
    positive=labels>0;out=pixels.astype(np.float32)
    out[positive]=out[positive]*.65+colors[labels[positive]]*.35
    canvas=Image.fromarray(out.astype(np.uint8));draw=ImageDraw.Draw(canvas)
    for room in rooms:
        for ring in [room['shape']['points'],*room['shape'].get('holes',[])]:
            points=[(p['x']*width,p['y']*height) for p in ring]
            draw.line(points+[points[0]],fill='blue',width=max(1,width//1600))
    canvas.save(a.output/'overlay-native.png');a.capture(a.output/'overlay-native.png')
    canvas.thumbnail((1800,1800));canvas.save(a.output/'overlay-preview.png');a.capture(a.output/'overlay-preview.png')


def actual(binding_path):
    binding,bsha=c.read_binding(binding_path,scope='cpu',require_clear=True)
    scored,score_done=completed_phase(binding,bsha,'scoring');part,metrics,complete=dependencies()
    scoring_coverage(scored,binding,metrics,complete)
    binding,bsha,claim,claim_sha,a=begin(binding_path,'actual','cpu')
    try:
        t=time.monotonic();case=binding['actual']
        old=checked_probability(case['old_probability'],c.PINS['old_actual_map'][1])
        new=checked_probability(case['new_probability'],c.PINS['new_actual_map'][1])
        p=compose_probability(old,new)
        if p.shape!=(3,case['height'],case['width']):raise ValueError('Actual cached maps must match native input grid')
        heads=head_hashes(p)
        if heads!=[head_hashes(old)[0],*head_hashes(new)[1:]]:raise RuntimeError('Actual component-copy violation')
        p_sha=a.arrays('probabilities.npz',probability=p)
        labels,rooms,diagnostics=part.partition_rooms(p,c.PRESET)
        labels_sha=a.labels('labels.i32',labels);rooms_sha=a.json('rooms.json',rooms)
        image=checked_rgb(case['image'],c.PINS['actual_image'][1])
        if image.shape[:2]!=p.shape[1:]:raise ValueError('Actual source and cache dimensions differ')
        overlay(image,labels,rooms,a)
        areas=np.bincount(labels.ravel())[1:]
        report={**base_report(binding,bsha,'cpu'),'synthetic_development_only':False,
            'width':case['width'],'height':case['height'],'rooms':rooms,'diagnostics':diagnostics,
            'input_sha256':c.PINS['actual_image'][1],'old_probability_sha256':c.PINS['old_actual_map'][1],
            'new_probability_sha256':c.PINS['new_actual_map'][1],'ensemble_probability_sha256':p_sha,
            'head_sha256':heads,'labels_sha256':labels_sha,'rooms_sha256':rooms_sha,
            'rooms_with_holes':sum(bool(r['shape'].get('holes')) for r in rooms),
            'largest_component_pixels':int(areas.max()) if len(areas) else 0,
            'largest_component_page_fraction':float(areas.max()/labels.size) if len(areas) else 0,
            'scoring_report_sha256':score_done['report_sha256'],'fixed_partition':part.FIXED,
            'fixed_hierarchical_preset':part.PRESETS[c.PRESET],'wall_seconds':time.monotonic()-t,
            'all_space_scoring_eligible':False,'actual_inference_performed':False,
            'limitations':'One qualitative A511 fixed ensemble from independently completed cached maps. No reference/count/accuracy claim; every proposal still requires review. Holes and exact native pixel-cell exports retained.'}
        completed_phase(binding,bsha,'scoring')
        return finish(binding,bsha,'actual',claim,claim_sha,a,'cpu',report)
    except BaseException as exc:failed(a,'actual',exc);raise


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['inference','scoring','actual']);parser.add_argument('--binding',type=Path,required=True)
    args=parser.parse_args();os.umask(0o077)
    report={'inference':infer,'scoring':score_development,'actual':actual}[args.phase](args.binding)
    print(json.dumps({'phase':args.phase,'completed':True,'rooms':len(report['rooms']) if args.phase=='actual' else None,
                      'summary':report.get('result',{}).get('summary')}),flush=True)
