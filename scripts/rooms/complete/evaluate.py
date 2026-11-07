"""Repeatable full-space evaluation, including corridors and withheld labels."""
import argparse,hashlib,json,subprocess,sys,time
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).parents[1]/'bench'))
from metrics import score,aggregate
p=argparse.ArgumentParser();p.add_argument('--corpus',default='/home/tim/datasets/foremanhq-room-detection/all-spaces-msd');p.add_argument('--limit',type=int,default=40);p.add_argument('--split',choices=['development','holdout'],default='development');p.add_argument('--allow-holdout',action='store_true');p.add_argument('--seeds',choices=['none','partial'],default='none');a=p.parse_args()
if a.split=='holdout' and not a.allow_holdout:raise SystemExit('Holdout requires --allow-holdout; do not tune on it')
sources=lambda:{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [*Path('src/server/rooms/hybrid').glob('*.ts'),Path('src/server/rooms/raster-rooms.ts'),Path('src/lib/room-shape.ts'),Path(__file__)]}
source_hashes=sources()
root=Path(a.corpus);out=root/f'run-{time.strftime("%Y%m%d-%H%M%S")}-{a.split}-{a.seeds}';out.mkdir();cases=[r for r in json.loads((root/'manifest.json').read_text()) if r['split']==a.split][:a.limit];results={}
for mode in ['baseline','complete']:
 rows=[]
 for case in cases:
  if sources()!=source_hashes:raise RuntimeError("Detector source changed during evaluation; rerun without editing it")
  if hashlib.sha256((root/case["image"]).read_bytes()).hexdigest()!=case["image_sha256"]:raise RuntimeError("Corpus image changed")
  truth=np.load(root/case['truth']);anns=json.loads((root/case['annotations']).read_text());seeds=[{'x':r['seed'][0],'y':r['seed'][1],'name':r['name']} for i,r in enumerate(anns) if a.seeds=='partial' and i%3==0]
  mask=out/f'{mode}-{case["id"]}.bin';request=out/f'{mode}-{case["id"]}.request.json';request.write_text(json.dumps({'image':str(root/case['image']),'output':str(mask),'seeds':seeds,'mode':mode}))
  wall_start=time.perf_counter()
  try:
   proc=subprocess.run(['node','--max-old-space-size=768','--import','tsx','scripts/rooms/complete/predict.ts',str(request)],capture_output=True,text=True,timeout=90,check=True)
   pred=np.fromfile(mask,dtype='<i4').reshape(truth.shape);diagnostic=json.loads(proc.stdout.strip().splitlines()[-1]);error=None
  except Exception as e:pred=np.zeros_like(truth);diagnostic={};error=str(e)[:400]
  metrics=score(truth,pred);rows.append({'id':case['id'],'site':case['site'],'metrics':metrics,'diagnostic':diagnostic,'error':error,'status':'ok' if error is None else 'error','process_ms':diagnostic.get('ms',0),'detect_ms':diagnostic.get('ms',0),'timing':{'wall_ms':(time.perf_counter()-wall_start)*1000}})
  if len(rows)%10==0:print(mode,'cases',len(rows),flush=True)
 results[mode]={'cases':rows,'summary':aggregate(rows),'failures':sum(r['error'] is not None for r in rows)}
 print(mode,json.dumps(results[mode]['summary']), 'failures',results[mode]['failures'],flush=True)
report={'split':a.split,'seed_mode':a.seeds,'ids':[c['id'] for c in cases],'results':results,'source_hashes':source_hashes,'input_type':'generated MSD wall-boundary renders; not original PDF/OCR performance'}
if sources()!=source_hashes:raise RuntimeError('Detector source changed; result is not rankable')
(out/'report.json').write_text(json.dumps(report,indent=2));print('Report:',out/'report.json')
