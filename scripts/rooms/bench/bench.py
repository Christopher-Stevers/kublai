#!/usr/bin/env python3
"""Offline, reproducible room geometry experiments. See README.md next to this file."""
import argparse,datetime,hashlib,json,os,platform,shutil,subprocess,time,uuid
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,__version__ as pillow_version
from metrics import score,aggregate,VERSION
from report import run_report,leaderboard,comparison
HERE=Path(__file__).resolve().parent; REPO=HERE.parents[2]
DEFAULT_CORPUS=Path('/home/tim/datasets/foremanhq-room-detection')

def digest(data):return hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(path):return digest(path.read_bytes())
def write_json(path,data):path.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
def read_json(path):return json.loads(path.read_text())

def check_config(c):
    required={'name','threshold','openRadius','join','bandLengthFraction','doorFraction','gapFactor','windowFactor','envelope','grow','maxRoomFactor','maxUnlabelledFraction','nudgeFraction'}
    if set(c)!=required:raise ValueError('Config must contain exactly: '+', '.join(sorted(required)))
    if not isinstance(c['name'],str) or not c['name']:raise ValueError('Missing config name')
    for k in ['envelope','grow']:
        if not isinstance(c[k],bool):raise ValueError(k+' must be boolean')
    for k in required-{'name','envelope','grow'}:
        if isinstance(c[k],bool) or not isinstance(c[k],(float,int)) or not np.isfinite(c[k]) or c[k]<0:raise ValueError('Invalid '+k)
    if not 1<=c['threshold']<=255 or any(not isinstance(c[k],int) or c[k]>30 for k in ['join','openRadius']):raise ValueError('Invalid pixel parameters')
    if any(c[k]>1 for k in ['doorFraction','bandLengthFraction','maxUnlabelledFraction','nudgeFraction']):raise ValueError('Fractions must be <= 1')
    if c['gapFactor']>10 or c['windowFactor']>20 or c['maxRoomFactor']>100:raise ValueError('Unbounded morphology parameters')
    return c

def corpus_cases(corpus,suite,manifest_path=None,target='functional-room'):
    path=manifest_path or corpus/'sources/resplan-manifest.json'
    manifest=[json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.suffix=='.jsonl' else read_json(path)
    split='holdout' if suite=='holdout' else 'development'
    rows=[r for r in manifest if r['split']==split and r.get('target','functional-room')==target]
    rows.sort(key=lambda r:digest(r['id'].encode()))
    if suite=='smoke':rows=rows[:12]
    if not rows:raise ValueError('Empty suite')
    if len({r['id'] for r in rows})!=len(rows):raise ValueError('Duplicate case IDs')
    return rows

def load_case(corpus,r,width):
    ident=r['id']
    if not ident or any(x not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for x in ident):raise ValueError('Unsafe ID')
    image=(corpus/r['path']).resolve();ann_path=(corpus/r['annotation_path']).resolve()
    if not image.is_relative_to(corpus.resolve()) or not ann_path.is_relative_to(corpus.resolve()):raise ValueError('Case path outside corpus')
    image_sha=sha(image)
    if image_sha!=r['sha256']:raise ValueError('Corpus image checksum mismatch: '+ident)
    ann=read_json(ann_path)
    if ann['id']!=ident or len(ann['rooms'])!=r['room_count']:raise ValueError('Annotation ID/count mismatch')
    with Image.open(image) as im:height=max(1,round(im.height*width/im.width))
    if height>4096:raise ValueError('Image too tall')
    seeds=[]
    for room in ann['rooms']:
        s=room['seed']
        if len(s)!=2 or any(not isinstance(v,(int,float)) or not np.isfinite(v) or not 0<=v<=1 for v in s):raise ValueError('Invalid seed')
        seeds.append({'x':s[0],'y':s[1],'name':room['name']})
    return {'id':ident,'image':image,'annotation':ann,'image_sha':image_sha,'annotation_sha':sha(ann_path),'seeds':seeds,'width':width,'height':height}

def ground_truth(case):
    width,height=case['width'],case['height'];out=np.zeros((height,width),np.uint32)
    for idx,r in enumerate(case['annotation']['rooms'],1):
        polygon=r['polygon'];polys=[polygon['coordinates']] if polygon['type']=='Polygon' else polygon['coordinates'] if polygon['type']=='MultiPolygon' else None
        if polys is None:raise ValueError('Only Polygon/MultiPolygon references supported')
        room=Image.new('1',(width,height));draw=ImageDraw.Draw(room)
        for rings in polys:
            for ring_idx,ring in enumerate(rings):
                if len(ring)<4 or any(len(pt)!=2 or any(not np.isfinite(x) or not 0<=x<=1 for x in pt) for pt in ring):raise ValueError('Invalid reference coordinates')
                draw.polygon([(x*(width-1),y*(height-1)) for x,y in ring],fill=1 if ring_idx==0 else 0)
        out[np.asarray(room,dtype=bool)]=idx
    if len(np.unique(out[out>0]))!=len(case['annotation']['rooms']):raise ValueError('A reference room disappears at this scoring resolution')
    return out

def visuals(case,truth,pred,folder):
    with Image.open(case['image']) as im:base=im.convert('RGB').resize((case['width'],case['height']))
    # Smaller previews keep repeated report generation cheap. Metrics always use full resolution.
    base.thumbnail((768,768));base.save(folder/'input.png')
    for name,mask in [('truth',truth),('prediction',pred)]:
        labels=Image.fromarray(mask.astype(np.int32),'I').resize(base.size,Image.Resampling.NEAREST)
        arr=np.array(labels);rgb=np.array(base).astype(float)
        for k in np.unique(arr):
            if not k:continue
            colour=np.array([70+(int(k)*73)%170,60+(int(k)*113)%170,50+(int(k)*157)%170])
            rgb[arr==k]=rgb[arr==k]*.4+colour*.6
        im=Image.fromarray(rgb.astype(np.uint8));draw=ImageDraw.Draw(im)
        for seed in case['seeds']:
            x,y=seed['x']*(im.width-1),seed['y']*(im.height-1);draw.ellipse((x-3,y-3,x+3,y+3),fill='cyan',outline='black')
        im.save(folder/f'{name}.png')

def source_fingerprint():
    paths=[HERE/'detect.ts',REPO/'src/server/rooms/raster-rooms.ts',REPO/'pnpm-lock.yaml']
    return {str(p.relative_to(REPO)):sha(p) for p in paths}

def scoring_fingerprint():
    return digest(canonical({'version':VERSION,'metrics':sha(HERE/'metrics.py'),'harness':sha(HERE/'bench.py'),'numpy':np.__version__,'pillow':pillow_version}))

def clean_env():
    # Do not pass app credentials or node injection flags into detector processes.
    return {k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL','TMPDIR']}

def execute(case,config,folder,cache,source,timeout,fresh):
    settings={k:v for k,v in config.items() if k!='name'}
    key=digest(canonical({'source':source,'config':settings,'image':case['image_sha'],'seeds':case['seeds'],'width':case['width'],'height':case['height'],'timeout':timeout,'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':platform.machine()}))
    cached=cache/key;cache_hit=False
    expected_size=case['width']*case['height']*4
    if not fresh and (cached/'result.json').exists() and (cached/'mask.u32').exists():
        saved=read_json(cached/'result.json')
        if saved.get('sha256')==sha(cached/'mask.u32') and (cached/'mask.u32').stat().st_size==expected_size:
            shutil.copyfile(cached/'mask.u32',folder/'mask.u32');cache_hit=True;timing=saved['timing'];diag=saved['diagnostics']
    if not cache_hit:
        request={'image':str(case['image']),'seeds':case['seeds'],'width':case['width'],'config':config,'output':str(folder/'mask.u32')}
        write_json(folder/'request.json',request);t=time.perf_counter()
        result=subprocess.run(['node','--import','tsx',str(HERE/'detect.ts'),str(folder/'request.json')],cwd=REPO,env=clean_env(),text=True,capture_output=True,timeout=timeout)
        (folder/'detector.log').write_text(result.stdout+'\n'+result.stderr)
        if result.returncode:raise RuntimeError(f'Detector exited {result.returncode}; see detector.log')
        diag=json.loads(result.stdout.strip());timing={'wall_ms':(time.perf_counter()-t)*1000,'detect_ms':diag['detect_ms'],'peak_rss_kb':diag['peak_rss_kb']}
        if diag['width']!=case['width'] or diag['height']!=case['height'] or (folder/'mask.u32').stat().st_size!=expected_size:raise ValueError('Wrong prediction size')
        cached.mkdir(parents=True,exist_ok=True);shutil.copyfile(folder/'mask.u32',cached/'mask.u32');write_json(cached/'result.json',{'sha256':sha(cached/'mask.u32'),'timing':timing,'diagnostics':diag})
    pred=np.fromfile(folder/'mask.u32',dtype='<u4').reshape(case['height'],case['width'])
    return pred,timing,diag,cache_hit,key

def run(args,config_path):
    corpus=args.corpus.resolve();root=args.output.resolve();root.mkdir(parents=True,exist_ok=True)
    if args.suite=='holdout' and not args.allow_holdout:raise ValueError('Holdout is protected; use --allow-holdout only for final evaluation')
    if not 256<=args.width<=2048 or args.timeout<=0:raise ValueError('Width must be 256..2048 and timeout positive')
    config=check_config(read_json(config_path));rows=corpus_cases(corpus,args.suite,args.manifest,args.target)
    cases=[load_case(corpus,r,args.width) for r in rows]
    # Validate every reference before starting; a bad dataset must not become a detector failure.
    for c in cases:ground_truth(c)
    identity=[{'id':c['id'],'image':c['image_sha'],'annotation':c['annotation_sha'],'seeds':digest(canonical(c['seeds']))} for c in cases]
    compare_key=digest(canonical({'cases':identity,'target':args.target,'mode':'known-seed','width':args.width,'metrics':scoring_fingerprint(),'timeout':args.timeout}))
    source=source_fingerprint();run_id=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:6]
    folder=root/run_id;folder.mkdir();cache=root/'cache';cache.mkdir(exist_ok=True);started=time.perf_counter()
    write_json(folder/'config.json',config)
    for relative in source:
        saved=folder/'source'/relative;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REPO/relative,saved)
    for name in ['bench.py','metrics.py','report.py','requirements.txt']:
        saved=folder/'source/scripts/rooms/bench'/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(HERE/name,saved)
    metadata={'run_id':run_id,'suite':args.suite,'width':args.width,'comparison_key':compare_key,'target':args.target,'mode':'known-seed','timeout_seconds':args.timeout,'config':config,'source_hashes':source,'scorer':scoring_fingerprint(),'case_identity':identity,'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'python':platform.python_version(),'machine':platform.machine(),'cases':[]}
    write_json(folder/'provenance.json',metadata)
    for idx,c in enumerate(cases):
        target=folder/c['id'];target.mkdir();truth=ground_truth(c);pred=np.zeros_like(truth);record={'id':c['id'],'status':'ok','cache_hit':False,'visuals':True,'timing':{}}
        try:
            pred,timing,diag,hit,key=execute(c,config,target,cache,source,args.timeout,args.fresh)
            record.update(timing=timing,diagnostics=diag,cache_hit=hit,cache_key=key)
            record['metrics']=score(truth,pred)
        except (subprocess.TimeoutExpired,RuntimeError,ValueError,OSError,KeyError) as e:
            record.update(status='timeout' if isinstance(e,subprocess.TimeoutExpired) else 'error',error=str(e));pred=np.zeros_like(truth);record['metrics']=score(truth,pred)
        visuals(c,truth,pred,target);metadata['cases'].append(record)
        write_json(folder/'partial.json',metadata)
        print(f'[{idx+1}/{len(cases)}] {c["id"]}: {record["status"]} F1={record["metrics"]["f1_50"]:.3f}'+(' cached' if record['cache_hit'] else ''),flush=True)
    metadata['elapsed_seconds']=time.perf_counter()-started;metadata['summary']=aggregate(metadata['cases']);write_json(folder/'run.json',metadata);run_report(metadata,folder)
    all_runs=[read_json(p) for p in root.glob('*/run.json')];leaderboard(all_runs,root)
    print(json.dumps({'run_id':run_id,'elapsed_seconds':metadata['elapsed_seconds'],'summary':metadata['summary'],'report':str(folder/'index.html')}),flush=True)
    return metadata

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    for command in ['run','sweep']:
        c=sub.add_parser(command);c.add_argument('--corpus',type=Path,default=DEFAULT_CORPUS);c.add_argument('--output',type=Path,default=DEFAULT_CORPUS/'experiments');c.add_argument('--suite',choices=['smoke','development','holdout'],default='smoke');c.add_argument('--width',type=int,default=1024);c.add_argument('--timeout',type=float,default=30);c.add_argument('--fresh',action='store_true');c.add_argument('--manifest',type=Path);c.add_argument('--target',choices=['functional-room','suite'],default='functional-room');c.add_argument('--allow-holdout',action='store_true')
        if command=='run':c.add_argument('--config',type=Path,default=HERE/'configs/baseline.json')
        else:c.add_argument('--configs',type=Path,nargs='+',default=sorted((HERE/'configs').glob('*.json')))
    c=sub.add_parser('compare');c.add_argument('baseline',type=Path);c.add_argument('candidate',type=Path)
    args=p.parse_args()
    if args.command=='compare':
        a,b=read_json(args.baseline/'run.json'),read_json(args.candidate/'run.json');print(json.dumps(comparison(a,b,args.candidate.parent/f'compare-{a["run_id"]}-{b["run_id"]}.json'),indent=2));return
    if args.command=='sweep':
        if args.suite=='holdout':raise ValueError('Sweeps cannot tune on holdout; use a single explicitly authorized run')
        results=[run(args,c) for c in args.configs]
        for r in results[1:]:comparison(results[0],r,args.output/f'compare-{results[0]["run_id"]}-{r["run_id"]}.json')
        leaderboard([read_json(p) for p in args.output.glob('*/run.json')],args.output)
        if any(r['summary']['failures'] for r in results):raise SystemExit(1)
    else:
        result=run(args,args.config)
        if result['summary']['failures']:raise SystemExit(1)
if __name__=='__main__':main()
