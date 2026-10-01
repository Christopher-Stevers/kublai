"""Fabricated objects only; no completed-data gate or GPU is executed."""
import copy
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch
import contract as c
import run


class DomainTrialTests(unittest.TestCase):
    def authorization(self):
        return {'decision':'AUTHORIZE','reviewer':'fabricated-root','dataset_audit_outcome':'CLEAR','plan':c.fixed_plan(),
                'source_bindings':{'fabricated':'sha'},**{key:'a'*64 for key in
                ('manifest_sha256','dataset_completed_sha256','dataset_original_receipt_sha256','dataset_binding_sha256','dataset_claim_sha256')}}

    def test_exact_authorization_plan_source_and_dataset_pins(self):
        good=self.authorization();c.validate_authorization(good,{'fabricated':'sha'})
        for key,value in [('decision','CLEAR'),('reviewer',''),('dataset_audit_outcome','pending'),
                          ('manifest_sha256','unbound'),('source_bindings',{}),('plan',{})]:
            changed=copy.deepcopy(good);changed[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):c.validate_authorization(changed,{'fabricated':'sha'})

    def test_authorization_required_before_builder_or_decode(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(c,'AUTH',Path(folder)/'missing.json'),\
             patch.object(c,'sources',return_value={}),patch.object(c,'completed_data_gate',side_effect=AssertionError('no decode')) as build:
            with self.assertRaises(FileNotFoundError):c.prepare('gpu')
            build.assert_not_called()

    def test_import_alias_restored_on_success_and_failure(self):
        import sys
        sentinel=object();old=sys.modules.get('contract')
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fabricated.py';path.write_text('import contract\nvalue=contract\n')
            module=c.load_module('fabricated_success',path,{'contract':sentinel});self.assertIs(module.value,sentinel)
            self.assertIs(sys.modules.get('contract'),old)
            path.write_text('raise RuntimeError("fabricated")\n')
            with self.assertRaises(RuntimeError):c.load_module('fabricated_failure',path,{'contract':sentinel})
            self.assertIs(sys.modules.get('contract'),old)

    def test_original_phase_claim_cannot_repeat(self):
        prepared=(self.authorization(),{},None,None,None,'b'*64)
        with tempfile.TemporaryDirectory() as folder,patch.object(c,'PREFIX',Path(folder)/'single'),\
             patch.object(c,'runtime',return_value={'fabricated':True}):
            run.original_phase('training',prepared)
            with self.assertRaises(FileExistsError):run.original_phase('training',prepared)

    def test_incomplete_previous_phase_blocks_execution(self):
        prepared=(self.authorization(),{},None,None,None,'b'*64)
        with patch.object(c,'prepare',return_value=prepared),patch.object(run,'require_phase',side_effect=ValueError('not complete')),\
             patch.object(run,'original_phase',side_effect=AssertionError('no claim')) as claim:
            with self.assertRaises(ValueError):run.execute('heads')
            claim.assert_not_called()

    def test_empty_emissions_and_changed_runtime_receipt_fail(self):
        prepared=(self.authorization(),{},None,None,None,'b'*64)
        for phase in c.OUTPUTS:
            with self.subTest(phase=phase),self.assertRaises(ValueError):run.validate_emissions(phase,{},prepared)
        with tempfile.TemporaryDirectory() as folder,patch.object(c,'PREFIX',Path(folder)/'single'):
            claim=run.expected_claim('training',prepared);c.write(run.marker('training'),claim)
            done={**claim,'status':'completed','claim_sha256':c.digest(run.marker('training')),'emitted_bindings':{},'runtime':c.CPU_RUNTIME}
            c.write(run.marker('training',True),done)
            with self.assertRaises(ValueError):run.require_phase('training',prepared)

    def test_control_bytes_checked_after_parse(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'receipt.json';c.write(path,{'value':1});pin=c.digest(path)
            original=json.loads
            def mutate(raw):
                value=original(raw);path.write_text('{"value":2}');return value
            with patch.object(run.json,'loads',side_effect=mutate):
                with self.assertRaises(ValueError):run.read_json(path,pin)

    def test_completed_child_hashes_precede_helper_execution(self):
        with patch.object(c,'verify',side_effect=ValueError('wrong completed child pin')),\
             patch.object(c,'load_module',side_effect=AssertionError('helper must not execute')) as load:
            with self.assertRaises(ValueError):c.completed_data_gate(self.authorization())
            load.assert_not_called()

    def test_genuine_control_completed_lineage_role(self):
        claim_path,claim_sha=c.CONTROL_METADATA['original-claim']
        values={'run':{'checkpoint_sha256':c.OLD_SHA,'manifest_sha256':c.BASELINE_SHA,'heads':c.HEADS,'parameters':2456454,
                       'history':[{'epoch':i} for i in range(1,49)],'config':c.CONFIG,
                       'source_hashes':{p.name:sha for p,sha in c.PINS.items() if p.parent==c.MODELS}},
                'binding':{'output':str(c.CONTROL_ROOT),'config':c.CONFIG,'assets':{str(claim_path):claim_sha},
                           'approved_for_production':False,'all_space_scoring_eligible':False},
                'completed':{'returncode':0,'checkpoint_sha256':c.OLD_SHA,'run_sha256':c.CONTROL_METADATA['run'][1],
                             'binding_sha256':c.CONTROL_METADATA['binding'][1]},
                'original-claim':{'output':str(c.CONTROL_ROOT),'config':c.CONFIG,'manifest_sha256':c.BASELINE_SHA}}
        c.validate_control_metadata(values)
        for role,key in [('run','checkpoint_sha256'),('run','manifest_sha256'),('completed','binding_sha256'),('original-claim','output')]:
            wrong=copy.deepcopy(values);wrong[role][key]='centerline-substitution'
            with self.subTest(role=role,key=key),self.assertRaises(ValueError):c.validate_control_metadata(wrong)


class HappyCompletionTests(unittest.TestCase):
    """Minimal writer-shaped metadata + fake bytes, never NPZ/PIL/Torch decode."""
    def authorization(self):return DomainTrialTests.authorization(self)
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name);self.stack=ExitStack()
        rooms=root/'rooms';rooms.mkdir();source=rooms/'helper.py';source.write_text('# fabricated source\n')
        outputs={p:root/p for p in ('training','heads','actual')};outputs['hierarchical']=outputs['actual']/'hierarchical'
        for name,value in {'ROOMS':rooms,'PREFIX':root/'single','OUTPUTS':outputs,'DATA':root/'manifest.json',
                           'CLAIM':root/'legacy-training.claim.json','AUTH':root/'authorization.json'}.items():
            self.stack.enter_context(patch.object(c,name,value))
        metadata={}
        for role in ('run','binding','completed','original-claim'):
            path=root/(role+'.control.json');c.write(path,{'fabricated_control_metadata':role});metadata[role]=(path,c.digest(path))
        self.stack.enter_context(patch.object(c,'CONTROL_METADATA',metadata))
        c.write(c.DATA,{'fabricated':True});c.write(c.CLAIM,{'original':'fabricated'})
        auth=self.authorization();auth['manifest_sha256']=c.digest(c.DATA);auth['source_bindings']={str(source):c.digest(source)}
        c.write(c.AUTH,auth)
        rows=[{'id':f'case-{i}','site':str(i),'split':'validation','image_sha256':f'image-{i}','targets_sha256':f'target-{i}'} for i in range(20)]
        self.prepared=(auth,auth['source_bindings'],{'records':rows},None,None,c.digest(c.AUTH))
        self.initial_inventories={}
        for phase,folder in outputs.items():
            folder.mkdir(parents=True,exist_ok=True)
            if phase!='hierarchical':
                archive=folder/'frozen_sources';archive.mkdir();shutil.copyfile(source,archive/source.name)
                c.write(archive/'hashes.json',{source.name:c.digest(source)})
                control=archive/'control-lineage';control.mkdir()
                for role,(path,_) in metadata.items():shutil.copyfile(path,control/(role+'.json'))

    def tearDown(self):self.stack.close();self.temp.cleanup()

    def raw(self,path):
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fabricated native bytes, never decoded');return c.digest(path)

    def make_training(self):
        folder=c.OUTPUTS['training'];checkpoint=self.raw(folder/'training/best.pt');self.raw(folder/'training.stdout.jsonl')
        binding={'output':str(folder),'config':c.CONFIG,'runtime':c.GPU_RUNTIME,'source_bindings':self.prepared[1],
                 'assets':{str(c.DATA):c.digest(c.DATA),str(c.CLAIM):c.digest(c.CLAIM)},
                 'approved_for_production':False,'all_space_scoring_eligible':False}
        c.write(folder/'binding.json',binding)
        run_meta={'checkpoint_sha256':checkpoint,'manifest_sha256':c.digest(c.DATA),'config':c.CONFIG,
                  'history':[{'epoch':i,'loss':{'train':1.,'validation':1.}} for i in range(1,49)]}
        c.write(folder/'training/run.json',run_meta)
        c.write(folder/'completed.json',{'returncode':0,'binding_sha256':c.digest(folder/'binding.json'),
                'run_sha256':c.digest(folder/'training/run.json'),'checkpoint_sha256':checkpoint})

    def make_heads(self):
        folder=c.OUTPUTS['heads'];model_sha={'frozen_long48':c.OLD_SHA,'true_opening48':c.digest(c.OUTPUTS['training']/'training/best.pt')}
        start={'case_ids':[r['id'] for r in self.prepared[2]['records']],'model_sha256':model_sha}
        c.write(folder/'evaluation_started.json',start);methods={};caches={}
        for name,sha in model_sha.items():
            rows=[]
            for source in self.prepared[2]['records']:
                path=folder/name/(source['id']+'.npz');p_sha=self.raw(path);caches[str(path)]=p_sha
                rows.append({**source,'probabilities':str(path.relative_to(folder)),'probabilities_sha256':p_sha})
            methods[name]={'cases':rows,'checkpoint_sha256':sha}
        report={'manifest_sha256':c.digest(c.DATA),'threshold':.5,'runtime':c.GPU_RUNTIME,'source_bindings':self.prepared[1],
                'approved_for_production':False,'all_space_scoring_eligible':False,'methods':methods,
                'training_binding_sha256':c.digest(c.OUTPUTS['training']/'binding.json'),
                'asset_bindings':{str(c.DATA):c.digest(c.DATA)},'cache_bindings':caches}
        c.write(folder/'report.json',report)
        c.write(folder/'evaluation_completed.json',{'report_sha256':c.digest(folder/'report.json'),
                'started_sha256':c.digest(folder/'evaluation_started.json')})

    def make_actual(self):
        folder=c.OUTPUTS['actual'];prob=self.raw(folder/'probabilities.npz');labels=self.raw(folder/'plain-labels.i32')
        c.write(folder/'plain.json',{'rooms':[],'approved_for_production':False,'all_space_scoring_eligible':False})
        emitted={str(folder/'probabilities.npz'):prob,str(folder/'plain-labels.i32'):labels,str(folder/'plain.json'):c.digest(folder/'plain.json')}
        binding={'input_sha256':c.ACTUAL_SHA,'output':str(folder),'training_manifest_sha256':c.digest(c.DATA),
                'runtime':c.GPU_RUNTIME,'source_bindings':self.prepared[1],'probabilities_sha256':prob,'plain_labels_sha256':labels,
                'plain_sha256':c.digest(folder/'plain.json'),'emitted_bindings':emitted,
                'checkpoint_sha256':c.digest(c.OUTPUTS['training']/'training/best.pt'),
                'head_report_sha256':c.digest(c.OUTPUTS['heads']/'report.json'),
                'asset_bindings':{str(c.DATA):c.digest(c.DATA)},'approved_for_production':False,'all_space_scoring_eligible':False}
        c.write(folder/'probe_binding.json',binding)
        c.write(folder/'probe_completed.json',{'probe_binding_sha256':c.digest(folder/'probe_binding.json'),'emitted_bindings':emitted})

    def make_hierarchical(self):
        folder=c.OUTPUTS['hierarchical'];files={}
        for name in ('labels.i32','overlay.png','overlay-preview.png'):files[str(folder/name)]=self.raw(folder/name)
        for name in ('plain-overlay.png','plain-overlay-preview.png','interior-probability-preview.png',
                     'boundary-probability-preview.png','opening-probability-preview.png'):
            path=c.OUTPUTS['actual']/name;files[str(path)]=self.raw(path)
        report={'runtime':c.CPU_RUNTIME,'preset':'hierarchical_basins','output_bindings':files,
                'asset_source_bindings':{str(c.DATA):c.digest(c.DATA)},'approved_for_production':False,'all_space_scoring_eligible':False}
        c.write(folder/'prediction.json',report)
        c.write(folder/'completed.json',{'prediction_sha256':c.digest(folder/'prediction.json'),'output_bindings':files})

    def make_all(self):
        for phase,make in [('training',self.make_training),('heads',self.make_heads),('actual',self.make_actual),('hierarchical',self.make_hierarchical)]:
            make();self.initial_inventories[phase]=run.inventory(phase)
            run.validate_emissions(phase,self.initial_inventories[phase],self.prepared)

    def test_happy_path_four_writer_schemas_and_original_receipts(self):
        self.make_all()
        with patch.object(c,'prepare',return_value=self.prepared),patch.object(c,'runtime',side_effect=lambda s:c.CPU_RUNTIME if s=='cpu' else c.GPU_RUNTIME):
            for phase in ('training','heads','actual','hierarchical'):
                with self.subTest(phase=phase):
                    claim,sha=run.original_phase(phase,self.prepared)
                    emitted=self.initial_inventories[phase];receipt_sha=run.seal_completion(phase,self.prepared,sha,emitted)
                    self.assertEqual(receipt_sha,c.digest(run.marker(phase,True)))
                    row=run.require_phase(phase,self.prepared);self.assertEqual(row['emitted_bindings'],emitted)

    def test_late_receipt_and_output_mutation_detected(self):
        self.make_all()
        for mutation in ('receipt','output'):
            phase='hierarchical' if mutation=='receipt' else 'heads'
            claim,sha=run.original_phase(phase,self.prepared);emitted=self.initial_inventories[phase]
            def mutate(scope):
                path=run.marker(phase,True) if mutation=='receipt' else c.OUTPUTS[phase]/'report.json'
                path.write_text('{"late":true}');return self.prepared
            with self.subTest(mutation=mutation),patch.object(c,'prepare',side_effect=mutate),\
                 patch.object(c,'runtime',side_effect=lambda s:c.CPU_RUNTIME if s=='cpu' else c.GPU_RUNTIME):
                with self.assertRaises(ValueError):run.seal_completion(phase,self.prepared,sha,emitted)

    def test_spent_failure_marker_blocks_even_valid_completed_receipt(self):
        self.make_all();phase='training';claim,sha=run.original_phase(phase,self.prepared)
        with patch.object(c,'prepare',return_value=self.prepared),patch.object(c,'runtime',return_value=c.GPU_RUNTIME):
            run.seal_completion(phase,self.prepared,sha,self.initial_inventories[phase])
        c.write(run.failure_marker(phase),{'status':'failed'})
        with self.assertRaises(ValueError):run.require_phase(phase,self.prepared)


if __name__=='__main__':unittest.main()
