#!/usr/bin/env python3
"""Offline descriptive analysis. Reads preserved profiles only; never a gate."""
import collections,hashlib,json,pathlib,sys,urllib.parse
root=pathlib.Path(sys.argv[1]);report=json.loads((root/'report.json').read_text())
result={'kind':'supplemental-offline-descriptive-analysis','acceptedGateEvidence':False,'samples':[],'limits':['One instrumented operation/source/cell; not a distribution, gate, or causal intervention.','CPU weights are approximate sorted cumulative sample intervals; raw negative deltas preserved.','Inclusive stacks and nested timeline intervals overlap: never add categories or subtract to infer causes.','EventTiming may arrive after stop or omit unsupported/short events; absence is not zero cost.', 'Numerous negative raw CPU deltas limit interval-derived self weights; these are not exact native/component costs or additive causal explanations.', 'Profiler startup bookkeeping precedes the action; whole-profile totals include this and cannot be compared as app action cost.','Trace stack line/columns retained as received (usually1-based); CPU frames are0-based.']}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def script(url):
 try:return urllib.parse.urlparse(url).path or '(native/injected)'
 except:return '(unclassified)'
def frame(f):return {'name':f.get('functionName') or '(anonymous)','script':script(f.get('url','')),'line0':f.get('lineNumber'),'column0':f.get('columnNumber')}
for row in report['samples']:
 stem=row['sampleId'];cp=root/(stem+'.cpuprofile');tp=root/(stem+'.trace.json');cpu=json.loads(cp.read_text());events=json.loads(tp.read_text())['traceEvents'];obs=report['observations'][stem];nodes={n['id']:n for n in cpu['nodes']};parents={c:n['id'] for n in cpu['nodes'] for c in n.get('children',[])}
 marks={e['name'].split(':',1)[1]:e['ts'] for e in events if e['name'].startswith('failed-cells-diagnostic:')}
 phases={'before-pointer':(cpu['startTime'],marks.get('pointerdown',cpu['endTime'])),'pointer-to-click':(marks.get('pointerdown',cpu['startTime']),marks.get('click',cpu['endTime'])),'after-click-to-profile-stop':(marks.get('click',cpu['startTime']),cpu['endTime'])}
 stamps=[];at=cpu['startTime']
 for i,(sample,delta) in enumerate(zip(cpu.get('samples',[]),cpu.get('timeDeltas',[]))):at+=delta;stamps.append((at,i,sample))
 stamps.sort();selftime=collections.Counter();inclusive=collections.Counter();focus=[];byphase={p:collections.Counter() for p in phases};previous=cpu['startTime']
 for at,i,node in stamps:
  low=max(cpu['startTime'],previous);high=min(cpu['endTime'],at);weight=max(0,high-low)/1000;previous=at
  if node not in nodes:continue
  f=nodes[node]['callFrame'];key=json.dumps(frame(f),sort_keys=True);selftime[key]+=weight
  for phase,(lo,hi) in phases.items():byphase[phase][script(f.get('url',''))]+=max(0,min(high,hi)-max(low,lo))/1000
  stack=[];cur=node;seen=set()
  while cur in nodes and cur not in seen:
   seen.add(cur);nf=nodes[cur]['callFrame'];stack.append(frame(nf));cur=parents.get(cur)
  for path in set(f['script'] for f in stack):inclusive[path]+=weight
  if any('app-press-browser-' in f['script'] for f in stack):focus.append({'sampleIndex':i,'atUs':at,'weightMs':round(weight,3),'stack':stack})
 layouts=[]
 for e in events:
  if e.get('ph')!='X' or e['name'] not in ['Layout','UpdateLayoutTree','Paint']:continue
  stack=e.get('args',{}).get('beginData',{}).get('stackTrace',[])
  layouts.append({'name':e['name'],'tsUs':e['ts'],'durationMs':e.get('dur',0)/1000,'relativeToClickMs':(e['ts']-marks['click'])/1000 if 'click'in marks else None,'initiatorStack':[{**s,'url':script(s.get('url',''))} for s in stack]})
 topfunctions=sorted([e for e in events if e.get('ph')=='X' and e['name']=='FunctionCall'],key=lambda e:e.get('dur',0),reverse=True)[:12]
 summary={'sampleId':stem,'role':row['role'],'journey':row['journey'],'link':row['link'],'variant':row.get('variant'),'raw':{'cpuSHA256':sha(cp),'traceSHA256':sha(tp)},'nodeAdapterMs':obs['adapterDurationMs'],'recordedCaptureMs':row['captureMs'],'browserEvents':obs['observed']['events'],'inputCommits':obs['observed']['commits'],'longTasks':obs['observed']['longTasks'],'eventTiming':obs['observed']['eventTiming'],'marksTraceUs':marks,'cpuRecordedMs':(cpu['endTime']-cpu['startTime'])/1000,'negativeRawDeltaCount':sum(d<0 for d in cpu.get('timeDeltas',[])),'topSampledSelfFrames':[{'frame':json.loads(k),'approxSelfMs':round(v,3)}for k,v in selftime.most_common(18)],'inclusiveScripts':[{'script':k,'approxInclusiveMs':round(v,3)}for k,v in inclusive.most_common(16)],'phaseSelfScripts':{p:[{'script':k,'approxSelfMs':round(v,3)}for k,v in counts.most_common(10)]for p,counts in byphase.items()},'pressContainingStacks':focus,'layoutStylePaintIntervals':layouts,'eventDispatchIntervals':[{'type':e.get('args',{}).get('data',{}).get('type'),'durationMs':e.get('dur',0)/1000}for e in events if e.get('ph')=='X'and e['name']=='EventDispatch'],'topFunctionCallIntervals':[{'durationMs':e.get('dur',0)/1000,**{k:v for k,v in e.get('args',{}).get('data',{}).items() if k in ['functionName','lineNumber','columnNumber']},'script':script(e.get('args',{}).get('data',{}).get('url',''))}for e in topfunctions]}
 summary['profilerBookkeepingIntervals']=[{'name':e['name'],'tsUs':e['ts'],'durationMs':e.get('dur',0)/1000,'beforeActionStart':e['ts']<marks.get('action-start',0)} for e in events if e.get('ph')=='X' and 'Profil' in e['name']]
 summary['timerEvents']= {name:sum(e['name']==name for e in events) for name in ['TimerInstall','TimerRemove']}
 summary['r19DeviceCacheScheduler']={}
 for name,column in [('TimerInstall',7154),('TimerRemove',7136)]:
  matched=[e for e in events if e['name']==name and any('8675-2a8bccb772f0215a.js' in f.get('url','') and f.get('lineNumber')==1 and f.get('columnNumber')==column for f in e.get('args',{}).get('data',{}).get('stackTrace',[]))]
  summary['r19DeviceCacheScheduler'][name]={'all':len(matched),'afterClick':sum(e['ts']>=marks.get('click',float('inf')) for e in matched)}
 result['samples'].append(summary)
pathlib.Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
