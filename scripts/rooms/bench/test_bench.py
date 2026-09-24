import unittest,tempfile,json
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
import numpy as np
from metrics import score,match_at,aggregate
from bench import ground_truth,check_config,HERE,load_case,corpus_cases,execute
from report import comparison

class MetricsTests(unittest.TestCase):
 def setUp(self):
  self.truth=np.zeros((20,20),np.uint32);self.truth[2:8,2:8]=1;self.truth[12:18,12:18]=2
 def test_perfect_ignores_instance_ids(self):
  prediction=self.truth*37;r=score(self.truth,prediction);self.assertEqual(r['f1_50'],1);self.assertEqual(r['mean_iou_all_gt'],1)
 def test_missing(self):
  p=self.truth.copy();p[p==2]=0;r=score(self.truth,p);self.assertEqual(r['fn50'],1);self.assertEqual(r['recall50'],.5)
 def test_extra(self):
  p=self.truth.copy();p[:2,:2]=3;self.assertEqual(score(self.truth,p)['fp50'],1)
 def test_merged_rooms(self):
  p=(self.truth>0).astype(np.uint32);r=score(self.truth,p);self.assertEqual(r['merge_candidates'],1);self.assertEqual(r['fn50'],1);self.assertEqual(r['f1_75'],0)
 def test_split(self):
  p=self.truth.copy();p[2:5,2:8]=3;r=score(self.truth,p);self.assertEqual(r['split_candidates'],1);self.assertEqual(r['fp50'],1)
 def test_missed_all_and_failed_run_penalty(self):
  r=score(self.truth,np.zeros_like(self.truth));self.assertEqual(r['f1_50'],0)
  result=aggregate([{'metrics':r,'status':'timeout','timing':{}}]);self.assertEqual(result['failures'],1);self.assertEqual(result['fn50'],2)
 def test_no_background_label(self):
  p=np.ones((2,2),np.uint32);self.assertEqual(score(p,p)['f1_50'],1)
 def test_maximum_matching_not_greedy(self):
  self.assertEqual(len(match_at(np.array([[.8,.7],[.6,.1]]),.5)),2)
 def test_invalid_dimensions(self):
  with self.assertRaises(ValueError):score(self.truth,self.truth[:2])
 def test_fractional_or_negative_labels_rejected(self):
  with self.assertRaises(ValueError):score(self.truth,self.truth.astype(float))
  with self.assertRaises(ValueError):score(self.truth,np.full((20,20),-1))
 def test_empty_masks(self):
  z=np.zeros((3,3),np.uint32);self.assertEqual(score(z,z)['f1_50'],1)

class HarnessTests(unittest.TestCase):
 def test_holes_remain_background(self):
  c={'width':21,'height':21,'annotation':{'rooms':[{'polygon':{'type':'Polygon','coordinates':[[[.1,.1],[.9,.1],[.9,.9],[.1,.9],[.1,.1]],[[.4,.4],[.6,.4],[.6,.6],[.4,.6],[.4,.4]]]}}]}}
  mask=ground_truth(c);self.assertEqual(mask[10,10],0);self.assertEqual(mask[5,5],1)
 def test_bad_config(self):
  c=json.loads((HERE/'configs/baseline.json').read_text());c['gapFactor']=float('nan')
  with self.assertRaises(ValueError):check_config(c)
 def test_mismatched_suites_not_comparable(self):
  with tempfile.TemporaryDirectory() as t:
   with self.assertRaises(ValueError):comparison({'comparison_key':'a'},{'comparison_key':'b'},Path(t)/'result.json')
 def test_split_is_stable_and_holdout_disjoint(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'sources').mkdir();rows=[{'id':str(i),'split':'development' if i<20 else 'holdout'} for i in range(30)];(p/'sources/resplan-manifest.json').write_text(json.dumps(rows))
   a=corpus_cases(p,'smoke');self.assertEqual(a,corpus_cases(p,'smoke'));self.assertEqual(len(a),12);self.assertFalse({r['id'] for r in a}&{r['id'] for r in corpus_cases(p,'holdout')})
 def test_changed_input_checksum_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'input.png').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'checksum'):load_case(p,{'id':'a','path':'input.png','annotation_path':'a.json','sha256':'wrong'},1024)

class CacheTests(unittest.TestCase):
 def test_source_change_rejected_before_cache_write(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);cache=root/'cache';cache.mkdir();folder=root/'case';folder.mkdir()
   case={'image':root/'input.png','image_sha':'image','seeds':[], 'width':2,'height':2}
   def fake_run(command,**kwargs):
    request=json.loads(Path(command[-1]).read_text());Path(request['output']).write_bytes(bytes(16))
    return SimpleNamespace(returncode=0,stdout=json.dumps({'width':2,'height':2,'detect_ms':1,'peak_rss_kb':1}),stderr='')
   with patch('bench.source_fingerprint',side_effect=[{'core':'v1'},{'core':'v2'}]),patch('bench.subprocess.check_output',return_value='v26'),patch('bench.subprocess.run',side_effect=fake_run):
    with self.assertRaisesRegex(RuntimeError,'not cached'):execute(case,{'name':'test'},folder,cache,{'core':'v1'},30,False)
   self.assertEqual(list(cache.iterdir()),[])
   with patch('bench.source_fingerprint',return_value={'core':'v2'}),patch('bench.subprocess.run') as run:
    with self.assertRaisesRegex(RuntimeError,'source changed'):execute(case,{'name':'test'},folder,cache,{'core':'v1'},30,False)
    run.assert_not_called()
 def test_cache_changes_with_code_config_inputs_seeds_timeout_and_corruption(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);cache=root/'cache';cache.mkdir();case={'image':root/'input.png','image_sha':'image-one','seeds':[{'x':.5,'y':.5}], 'width':2,'height':2};config={'name':'test','threshold':245}
   counter=[0]
   def fake_run(command,**kwargs):
    counter[0]+=1;r=json.loads(Path(command[-1]).read_text());Path(r['output']).write_bytes(np.ones((2,2),dtype='<u4').tobytes());return SimpleNamespace(returncode=0,stdout=json.dumps({'width':2,'height':2,'detect_ms':1,'peak_rss_kb':100}),stderr='')
   def go(source={'core':'v1'},timeout=30,fresh=False):
    folder=root/('case-'+str(len(list(root.glob('case-*')))));folder.mkdir()
    with patch('bench.source_fingerprint',return_value=source):return execute(case,config,folder,cache,source,timeout,fresh)
   with patch('bench.subprocess.check_output',return_value='v26'),patch('bench.subprocess.run',side_effect=fake_run):
    self.assertFalse(go()[3]);self.assertTrue(go()[3]);self.assertEqual(counter[0],1)
    config['threshold']=220;self.assertFalse(go()[3])
    case['image_sha']='image-two';self.assertFalse(go()[3])
    case['seeds']=[{'x':.6,'y':.5}];self.assertFalse(go()[3])
    self.assertFalse(go(source={'core':'v2'})[3])
    self.assertFalse(go(timeout=2)[3])
    self.assertFalse(go(fresh=True)[3])
    cached=go();self.assertTrue(cached[3]);(cache/cached[4]/'mask.u32').write_bytes(b'bad');self.assertFalse(go()[3])

if __name__=='__main__':unittest.main()
