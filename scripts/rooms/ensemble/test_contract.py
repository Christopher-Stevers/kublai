"""Fabricated metadata/arrays only; no real source pixels or references."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import contract as c
import run as r


def fabricated_cases(root):
    records=[];cases=[];hashes={};caches=[];historical=[]
    for i in range(20):
        ident=f'fabricated-{i}';image=str(root/(ident+'.png'));target=str(root/(ident+'.npz'))
        probability=str(root/(ident+'.probabilities.npz'));group=f'fabricated-site:{i}'
        row={'id':ident,'split':'validation','source':'synthetic-msd','group':group,'site':str(i),
             'image':Path(image).name,'targets':Path(target).name,'image_sha256':'image'+str(i),'targets_sha256':'target'+str(i)}
        records.append(row);cases.append({'id':ident,'group':group,'image':image,'targets':target,'probabilities':probability})
        hashes.update({image:row['image_sha256'],target:row['targets_sha256'],probability:'probability'+str(i)})
        caches.append({'id':ident,'probabilities_sha256':'probability'+str(i)});historical.append({'id':ident})
    return {'records':records},{'cases':cases,'input_hashes':hashes},\
           {'ids':[row['id'] for row in records],'results':{'baseline_low_barrier':{'cases':caches}}},\
           {'results':{c.PRESET:{'cases':historical,'summary':{'expected':1321}}}}


class OriginalIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.rows=fabricated_cases(self.root)
        self.pins=patch.dict(c.PINS,{'manifest':(self.root/'manifest.json','unused'),
                                    'old_cache_report':(self.root/'report.json','unused')});self.pins.start()
    def tearDown(self):self.pins.stop();self.temp.cleanup()

    def test_exact_associations_not_counts(self):
        self.assertEqual(len(c.exact_cases(*self.rows)),20)
        for part,key in ((0,'source'),(0,'group'),(0,'image_sha256'),(1,'group'),(1,'probabilities')):
            changed=copy.deepcopy(self.rows)
            row=changed[part]['records' if part==0 else 'cases'][0];row[key]='substitution'
            with self.subTest(key=key),self.assertRaises((ValueError,KeyError)):c.exact_cases(*changed)
        changed=copy.deepcopy(self.rows);changed[1]['cases'][0]['id']='protected-new-site'
        with self.assertRaises(ValueError):c.exact_cases(*changed)

    def test_duplicate_and_partial_coverage_rejected(self):
        for part in range(4):
            changed=copy.deepcopy(self.rows)
            sequence=(changed[0]['records'],changed[1]['cases'],changed[2]['ids'],changed[3]['results'][c.PRESET]['cases'])[part]
            sequence[0]=copy.deepcopy(sequence[1])
            with self.subTest(part=part),self.assertRaises(ValueError):c.exact_cases(*changed)

    def test_changed_bytes_rejected_before_decode(self):
        path=self.root/'fake.npz';path.write_bytes(b'not an archive')
        with patch.object(r.np,'load',side_effect=AssertionError('decoder must not run')) as decoder:
            with self.assertRaises(RuntimeError):r.checked_probability(path,'0'*64)
            decoder.assert_not_called()
        with patch.object(c.json,'loads',side_effect=AssertionError('metadata must not parse')) as decoder:
            with self.assertRaises(ValueError):c.pinned_json(path,'0'*64)
            decoder.assert_not_called()

    def test_gpu_and_artifacts_wait_for_audit_gate(self):
        with patch.object(c,'read_binding',side_effect=ValueError('audit not clear')) as gate,\
             patch.object(c,'claim_phase',side_effect=AssertionError('claim must not run')) as claim,\
             patch.object(r,'Artifacts',side_effect=AssertionError('no output before gate')) as output:
            with self.assertRaises(ValueError):r.begin(self.root/'binding.json','inference','gpu')
            gate.assert_called_once_with(self.root/'binding.json',scope='gpu',require_clear=True)
            claim.assert_not_called();output.assert_not_called()


class AttemptCompletionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.claimpatch=patch.object(c,'CLAIM',self.root/'original.claim.json');self.claimpatch.start()
        self.output=self.root/'out';self.output.mkdir()
        self.binding={'binding_path':str(self.output/'binding.json'),'output':str(self.output),
                      'input_bindings':{},'source_bindings':{}}
        c.write(self.binding['binding_path'],self.binding);self.bsha=c.digest(self.binding['binding_path'])
        c.write(c.CLAIM,{'contract':c.CONTRACT,'binding_path':self.binding['binding_path'],'binding_sha256':self.bsha,
                         'output':str(self.output),'fixed_mix':c.MIX,'preset':c.PRESET})
        c.write(self.output/'AUDIT_CLEAR.json',{'decision':'CLEAR','binding_sha256':self.bsha,'source_bindings':{}})
    def tearDown(self):self.claimpatch.stop();self.temp.cleanup()

    def test_claim_cannot_reset_by_switching_output(self):
        path,sha=c.claim_phase(self.binding,self.bsha,'scoring')
        c.verify_phase(self.binding,self.bsha,'scoring',path,sha)
        other={**self.binding,'output':str(self.root/'different-output')}
        (self.root/'different-output').mkdir();c.write(self.root/'different-output/AUDIT_CLEAR.json',{})
        with self.assertRaises(FileExistsError):c.claim_phase(other,'different-hash','scoring')
        changed={**self.binding,'output':str(self.root/'different-output')}
        with self.assertRaises(ValueError):c.verify_phase(changed,self.bsha,'scoring',path,sha)

    def test_emission_hash_is_immediate_and_completion_rechecks(self):
        claim,sha=c.claim_phase(self.binding,self.bsha,'scoring');a=r.Artifacts(self.output/'scoring')
        a.json('fake-result.json',{'count':1});receipts=list(a.receipts.glob('*.json'))
        self.assertEqual(len(receipts),1)
        before=json.loads(receipts[0].read_text());self.assertEqual(before['sha256'],c.digest(a.output/'fake-result.json'))
        (a.output/'fake-result.json').write_text('{"count":2}')
        report={**r.base_report(self.binding,self.bsha,'cpu')}
        with patch.object(c,'sources',return_value={}):
            with self.assertRaises(RuntimeError):r.finish(self.binding,self.bsha,'scoring',claim,sha,a,'cpu',report)
        self.assertFalse(c.phase_path('scoring',True).exists());self.assertFalse((a.output/'completed.json').exists())

    def test_original_completion_chain_rejects_tamper(self):
        claim,sha=c.claim_phase(self.binding,self.bsha,'scoring');a=r.Artifacts(self.output/'scoring')
        report=r.base_report(self.binding,self.bsha,'cpu')
        with patch.object(c,'sources',return_value={}):r.finish(self.binding,self.bsha,'scoring',claim,sha,a,'cpu',report)
        loaded,done=r.completed_phase(self.binding,self.bsha,'scoring');self.assertEqual(loaded,report)
        self.assertEqual(done['report_sha256'],c.digest(a.output/'report.json'))
        (a.output/'report.json').write_text('{}')
        with self.assertRaises(RuntimeError):r.completed_phase(self.binding,self.bsha,'scoring')


class ScopeMetricsTests(unittest.TestCase):
    def test_failed_floor_retains_denominator_and_no_partial_disappears(self):
        _,metrics,complete=r.dependencies();rows=[]
        for i in range(20):
            n=67 if i==19 else 66;truth=np.arange(1,n+1,dtype=np.int32).reshape(1,n)
            prediction=np.zeros_like(truth) if i==0 else truth
            rows.append({'id':f'fabricated-{i}','status':'failed' if i==0 else 'ok',
                         'metrics':metrics.score(truth,prediction),'timing':{'wall_ms':1}})
        group={'cases':rows,'summary':metrics.aggregate(rows),'completeness':complete.completeness_metrics(rows)}
        self.assertEqual(group['summary']['expected'],1321);self.assertEqual(group['summary']['fn50'],66)
        self.assertEqual(group['summary']['failures'],1);self.assertEqual(group['completeness']['evaluated_nonempty_floors'],20)
        self.assertEqual(group['completeness']['thresholds']['50']['floors_with_zero_missed_spaces'],19)
        binding={'cases':[{'id':row['id']} for row in rows],'baseline':copy.deepcopy(group)}
        report={'result':group,'historical_baseline':binding['baseline'],'baseline_report_sha256':c.PINS['hierarchy_report'][1],
                'delta_vs_historical':r.comparison(group['summary'],binding['baseline']['summary'])}
        r.scoring_coverage(report,binding,metrics,complete)
        for mutation in ('missing','partial','duplicate'):
            changed=copy.deepcopy(report)
            if mutation=='missing':changed['result']['cases'].pop()
            elif mutation=='partial':changed['result']['cases'][0]['metrics']=None
            else:changed['result']['cases'][0]=copy.deepcopy(changed['result']['cases'][1])
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):r.scoring_coverage(changed,binding,metrics,complete)

    def test_selected_heads_keep_bits_and_native_hole_export(self):
        old=np.zeros((3,8,8),np.float32);new=np.full_like(old,.2);old[0,1:7,1:7]=.8
        combined=r.compose_probability(old,new)
        self.assertEqual(r.head_hashes(combined),[r.head_hashes(old)[0],*r.head_hashes(new)[1:]])
        part,_,_=r.dependencies();mask=np.zeros((8,8),bool);mask[1:7,1:7]=1;mask[3:5,3:5]=0
        polygon=part.exact_cell_polygon(mask)
        self.assertEqual(polygon.area,int(mask.sum()));self.assertEqual(len(polygon.interiors),1)


if __name__=='__main__':unittest.main()
