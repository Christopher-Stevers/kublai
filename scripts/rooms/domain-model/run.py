"""Source-only driver; every phase requires later explicit root authorization."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import contract as c


def marker(phase,completed=False):
    return c.PREFIX.with_name(c.PREFIX.name+'.'+phase+('.completed.json' if completed else '.phase.claim.json'))


def failure_marker(phase):
    return c.PREFIX.with_name(c.PREFIX.name+'.'+phase+'.failed.json')


def expected_claim(phase,prepared):
    authorization,source,_,_,_,auth_sha=prepared
    return {'phase':phase,'output':str(c.OUTPUTS[phase]),'plan':c.fixed_plan(),'authorization_sha256':auth_sha,
            'manifest_sha256':authorization['manifest_sha256'],'dataset_completed_sha256':authorization['dataset_completed_sha256'],
            'source_bindings':source,'runtime':c.CPU_RUNTIME if phase=='hierarchical' else c.GPU_RUNTIME,
            'approved_for_production':False,'all_space_scoring_eligible':False}


def read_json(path,pin):
    raw=Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=pin:raise ValueError('Changed control bytes before metadata decode')
    value=json.loads(raw);c.verify({str(path):pin});return value


def required(phase):
    names={'training':['binding.json','completed.json','training/run.json','training/best.pt','training.stdout.jsonl'],
           'heads':['evaluation_started.json','report.json','evaluation_completed.json'],
           'actual':['probe_binding.json','probe_completed.json','probabilities.npz','plain-labels.i32','plain.json'],
           'hierarchical':['prediction.json','completed.json','labels.i32','overlay.png','overlay-preview.png']}[phase]
    return {str((c.OUTPUTS[phase]/name).resolve()) for name in names}


def inventory(phase):
    paths=[p for p in sorted(c.OUTPUTS[phase].rglob('*')) if p.is_file()]
    if phase=='hierarchical':
        paths += [c.OUTPUTS['actual']/name for name in ('plain-overlay.png','plain-overlay-preview.png',
                  'interior-probability-preview.png','boundary-probability-preview.png','opening-probability-preview.png')]
    return {str(p.resolve()):c.digest(p) for p in paths}


def validate_emissions(phase,files,prepared):
    if not files or not required(phase)<=set(files):raise ValueError('All mandatory original phase emissions are required')
    allowed=c.OUTPUTS['actual'] if phase=='hierarchical' else c.OUTPUTS[phase]
    if any(not Path(name).resolve().is_relative_to(allowed.resolve()) for name in files):raise ValueError('Output escape in completed phase')
    if phase!='hierarchical':
        for path,sha in prepared[1].items():
            archive=str((c.OUTPUTS[phase]/'frozen_sources'/Path(path).relative_to(c.ROOMS)).resolve())
            if files.get(archive)!=sha:raise ValueError('Complete unchanged executable source archive required')
        for role,(_,sha) in c.CONTROL_METADATA.items():
            archive=str((c.OUTPUTS[phase]/'frozen_sources/control-lineage'/(role+'.json')).resolve())
            if files.get(archive)!=sha:raise ValueError('Archived genuine Swissv4 completed-control lineage required')
    c.verify(files)
    pin=lambda name:files[str((c.OUTPUTS[phase]/name).resolve())]
    meta=lambda name:read_json(c.OUTPUTS[phase]/name,pin(name))
    manifest_sha=prepared[0]['manifest_sha256']
    if phase=='training':
        binding=meta('binding.json');done=meta('completed.json');run=meta('training/run.json')
        if (done.get('returncode')!=0 or done.get('binding_sha256')!=pin('binding.json') or done.get('run_sha256')!=pin('training/run.json') or
            done.get('checkpoint_sha256')!=pin('training/best.pt') or run.get('checkpoint_sha256')!=pin('training/best.pt') or
            run.get('manifest_sha256')!=manifest_sha or len(run.get('history',[]))!=48 or
            [row.get('epoch') for row in run['history']]!=list(range(1,49)) or
            any(run.get('config',{}).get(k)!=v for k,v in c.CONFIG.items()) or binding.get('config')!=c.CONFIG or
            binding.get('output')!=str(c.OUTPUTS['training']) or binding.get('runtime')!=c.GPU_RUNTIME or
            binding.get('source_bindings')!=prepared[1] or binding.get('assets',{}).get(str(c.DATA))!=manifest_sha or
            binding.get('assets',{}).get(str(c.CLAIM))!=c.digest(c.CLAIM) or binding.get('approved_for_production') is not False or
            binding.get('all_space_scoring_eligible') is not False):raise ValueError('Original completed fixed48 training associations differ')
        c.verify(binding['assets']);c.verify(binding['source_bindings'])
    elif phase=='heads':
        start=meta('evaluation_started.json');done=meta('evaluation_completed.json');report=meta('report.json')
        expected=[r['id'] for r in prepared[2]['records'] if r['split']=='validation']
        new_checkpoint=c.digest(c.OUTPUTS['training']/'training/best.pt')
        model_sha={'frozen_long48':c.OLD_SHA,'true_opening48':new_checkpoint}
        if (done.get('report_sha256')!=pin('report.json') or done.get('started_sha256')!=pin('evaluation_started.json') or
            report.get('manifest_sha256')!=manifest_sha or report.get('threshold')!=.5 or report.get('runtime')!=c.GPU_RUNTIME or
            report.get('source_bindings')!=prepared[1] or report.get('approved_for_production') is not False or
            report.get('all_space_scoring_eligible') is not False or start.get('case_ids')!=expected or
            start.get('model_sha256')!=model_sha or report.get('training_binding_sha256')!=c.digest(c.OUTPUTS['training']/'binding.json') or
            set(report.get('methods',{}))!=set(model_sha)):raise ValueError('Exact original paired masked20 head completion required')
        records={r['id']:r for r in prepared[2]['records']}
        for name,group in report['methods'].items():
            if group.get('checkpoint_sha256')!=model_sha[name]:raise ValueError('Original paired checkpoint association differs')
            rows=group['cases']
            if len(rows)!=20 or {r['id'] for r in rows}!=set(expected):raise ValueError('Partial/duplicate head coverage')
            for row in rows:
                source=records[row['id']]
                if any(row.get(k)!=source.get(k) for k in ('site','image_sha256','targets_sha256')):
                    raise ValueError('Paired case image/target/site association differs')
                path=str((c.OUTPUTS['heads']/row['probabilities']).resolve())
                if files.get(path)!=row['probabilities_sha256']:raise ValueError('Original head cache emission differs')
        c.verify(report['asset_bindings']);c.verify(report['cache_bindings'])
    elif phase=='actual':
        binding=meta('probe_binding.json');done=meta('probe_completed.json')
        if (done.get('probe_binding_sha256')!=pin('probe_binding.json') or done.get('emitted_bindings')!=binding.get('emitted_bindings') or
            binding.get('input_sha256')!=c.ACTUAL_SHA or binding.get('output')!=str(c.OUTPUTS['actual']) or
            binding.get('training_manifest_sha256')!=manifest_sha or binding.get('runtime')!=c.GPU_RUNTIME or
            binding.get('source_bindings')!=prepared[1] or binding.get('checkpoint_sha256')!=c.digest(c.OUTPUTS['training']/'training/best.pt') or
            binding.get('head_report_sha256')!=c.digest(c.OUTPUTS['heads']/'report.json') or
            binding.get('probabilities_sha256')!=pin('probabilities.npz') or
            binding.get('plain_labels_sha256')!=pin('plain-labels.i32') or binding.get('plain_sha256')!=pin('plain.json') or
            binding.get('approved_for_production') is not False or binding.get('all_space_scoring_eligible') is not False):
            raise ValueError('Exact original qualitative map/input/checkpoint completion required')
        c.verify(binding['asset_bindings']);c.verify(binding['emitted_bindings'])
    else:
        report=meta('prediction.json');done=meta('completed.json')
        if (done.get('prediction_sha256')!=pin('prediction.json') or report.get('runtime')!=c.CPU_RUNTIME or
            report.get('preset')!='hierarchical_basins' or report.get('approved_for_production') is not False or
            report.get('all_space_scoring_eligible') is not False or done.get('output_bindings')!=report.get('output_bindings')):
            raise ValueError('Exact unchanged qualitative hierarchy completion required')
        c.verify(report['asset_source_bindings']);c.verify(report['output_bindings'])
    c.verify(files)


def original_phase(phase,prepared):
    authorization,source,data,done,builder,auth_sha=prepared
    row=expected_claim(phase,prepared)
    marker(phase).parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    c.write(marker(phase),row);return row,c.digest(marker(phase))


def require_phase(phase,prepared):
    authorization,source,_,_,_,auth_sha=prepared
    if failure_marker(phase).exists():raise ValueError('A failed/spent original phase cannot be consumed')
    controls={str(marker(phase,True)):c.digest(marker(phase,True)),str(marker(phase)):c.digest(marker(phase))}
    receipt=read_json(marker(phase,True),controls[str(marker(phase,True))]);claim=read_json(marker(phase),controls[str(marker(phase))])
    expected=expected_claim(phase,prepared)
    if (claim!=expected or any(receipt.get(k)!=v for k,v in expected.items()) or
        receipt.get('claim_sha256')!=controls[str(marker(phase))] or receipt.get('status')!='completed'):
        raise ValueError('Only original completed phase/source/authorization associations may be consumed')
    files=receipt['emitted_bindings']
    validate_emissions(phase,files,prepared);c.verify(controls);c.verify(source)
    return receipt


def seal_completion(phase,prepared,claim_sha,emitted):
    """Capture the new outer receipt immediately and fence it before return."""
    scope='cpu' if phase=='hierarchical' else 'gpu';receipt=marker(phase,True)
    c.write(receipt,{**expected_claim(phase,prepared),'status':'completed','claim_sha256':claim_sha,'emitted_bindings':emitted})
    receipt_sha=c.digest(receipt)
    controls={str(receipt):receipt_sha,str(marker(phase)):claim_sha,str(c.AUTH):prepared[-1]}
    c.verify(controls);c.verify(emitted);c.verify(prepared[1])
    repeated=c.prepare(scope)
    if repeated[0]!=prepared[0] or repeated[1]!=prepared[1] or repeated[-1]!=prepared[-1]:
        raise ValueError('Root authorization/completed build/source changed after receipt emission')
    if c.runtime(scope)!=(c.CPU_RUNTIME if scope=='cpu' else c.GPU_RUNTIME):raise ValueError('Runtime changed after completed receipt')
    c.verify(emitted);c.verify(prepared[1]);c.verify(controls)
    return receipt_sha


def execute(phase):
    scope='cpu' if phase=='hierarchical' else 'gpu';prepared=c.prepare(scope)
    for previous in {'training':[],'heads':['training'],'actual':['training','heads'],'hierarchical':['training','heads','actual']}[phase]:
        require_phase(previous,prepared)
    row,claim_sha=original_phase(phase,prepared)
    try:
        if phase=='hierarchical':
            adapter=c.load_module('domain_swiss_partition_verified',c.SWISS/'partition_actual.py')
            if adapter.runtime()!=c.CPU_RUNTIME:raise ValueError('Pinned CPU partition runtime differs')
            adapter.run(c.OUTPUTS['actual'])
        else:
            legacy=c.legacy_contract(prepared)
            name={'training':'train_trial.py','heads':'evaluate_heads.py','actual':'qualitative.py'}[phase]
            adapter=c.load_module('domain_swiss_'+phase+'_verified',c.SWISS/name,{'contract':legacy})
            if phase=='training':adapter.run(c.OUTPUTS[phase])
            elif phase=='heads':adapter.run(c.OUTPUTS['training']/'binding.json',c.OUTPUTS[phase])
            else:adapter.run(c.OUTPUTS['training']/'binding.json',c.OUTPUTS['heads']/'report.json',c.OUTPUTS[phase])
        output=c.OUTPUTS[phase]
        # Original audited modules capture checkpoint/cache/label emissions
        # immediately; this outer receipt also binds every file/log/snapshot.
        emitted=inventory(phase);validate_emissions(phase,emitted,prepared)
        repeated=c.prepare(scope)
        if repeated[0]!=prepared[0] or repeated[1]!=prepared[1] or repeated[-1]!=prepared[-1]:
            raise ValueError('Root authorization/completed data/source changed during phase')
        c.verify(emitted)
        if c.digest(marker(phase))!=claim_sha:raise ValueError('Original phase claim changed')
        seal_completion(phase,prepared,claim_sha,emitted)
    except BaseException as exc:
        failed=failure_marker(phase)
        if not failed.exists():c.write(failed,{'phase':phase,'status':'failed','claim_sha256':claim_sha,'error':str(exc)})
        raise


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('phase',choices=['training','heads','actual','hierarchical'])
    args=p.parse_args();os.umask(0o077);execute(args.phase)
