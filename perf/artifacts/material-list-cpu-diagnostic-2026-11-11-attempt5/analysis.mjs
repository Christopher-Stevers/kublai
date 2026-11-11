// Offline descriptive analysis of the bounded synthetic diagnostic; never a gate.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const directory=path.resolve(process.argv[2]);
const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const round=n=>Math.round(n*1000)/1000;
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={protocol:'material-list-cpu-offline-summary-v2',acceptedGateEvidence:false,roles:{},limitations:[
 'One profiled navigation per source; no statistical, regression-pass or causal claim.',
 'Sampling/timeline instrumentation and the injected MutationObserver perturb execution.',
 'Sample weights approximate self time; raw negative deltas are retained and cumulative sample timestamps are sorted only for analysis, then interval edges are clipped to each phase.',
 'Minified webpack module markers identify code present, not necessarily the sampled component or render/commit phase.',
 'Trace duration rows can nest/overlap and must not be added together.',
 'Idle/program/native/automation samples are retained separately; missing IndexedDB samples do not prove no IndexedDB waiting.',
 'Provider startup uses synthetic auth and a nonhex lab build tag; no private-SW or physical-device proof.',
]};
for(const role of ['baseline','candidate']){
 const cpuPath=path.join(directory,role+'.cpuprofile'),tracePath=path.join(directory,role+'.trace.json');
 const cpu=JSON.parse(fs.readFileSync(cpuPath,'utf8')),trace=JSON.parse(fs.readFileSync(tracePath,'utf8')).traceEvents;
 const marks=Object.fromEntries(trace.filter(e=>e.name.startsWith('material-cpu:')).map(e=>[e.name.slice(13),e.ts]));
 if(!['pointerdown','click','ready','two-raf'].every(k=>Number.isFinite(marks[k])&&marks[k]>=cpu.startTime&&marks[k]<=cpu.endTime))throw Error('Missing/out-of-profile timing mark');
 const nodes=new Map(cpu.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of cpu.nodes)for(const child of n.children??[])parents.set(child,n.id);
 const chunks=new Map();
 function location(frame){
  let script=frame.url;try{script=new URL(script).pathname;}catch{script=script||'(no script URL)';}
  const base={function:frame.functionName||'(anonymous)',script,line0:frame.lineNumber,column0:frame.columnNumber};
  if(!script.startsWith('/_next/static/'))return base;
  const file=path.join(config[role].snapshot,'.next',script.slice('/_next/'.length));
  if(!fs.existsSync(file))return base;
  if(!chunks.has(file)){
   const text=fs.readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),modules=[];
   const visit=node=>{if(ts.isPropertyAssignment(node)&&/^\d+$/.test(node.name.getText(source))&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){const body=node.initializer.getText(source);modules.push({id:node.name.getText(source),start:node.getStart(source),end:node.end,markers:[...(body.includes('data-press-ignore')&&body.includes('data-pressed')?['press-gesture-code']:[]),...(body.includes('capitalize inline-flex items-center')?['shared-button-code']:[]),...(body.includes('Increase quantity')?['quantity-control-code']:[]),...(body.includes('Verify part')&&body.includes('Unknown Part')?['material-row-code']:[]),...(body.includes('hasPending')&&body.includes('queueMicrotask')&&body.includes('schedule')&&body.includes('cancel')?['queued-receipt-intent-code']:[]),...(body.includes('This receipt change could not be saved.')?['instant-receipt-code']:[]),...(body.includes('IDBDatabase')&&body.includes('replicache')?['replicache-idb-code']:[]),...(body.includes('Minified React error #')?['react-runtime-code']:[])]});}ts.forEachChild(node,visit);};visit(source);
   chunks.set(file,{source,modules,sha256:digest(file)});
  }
  const chunk=chunks.get(file),offset=chunk.source.getPositionOfLineAndCharacter(frame.lineNumber,frame.columnNumber);
  const module=chunk.modules.filter(m=>m.start<=offset&&m.end>offset).sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
  return {...base,scriptSha256:chunk.sha256,...(module?{webpackModule:module.id,moduleMarkers:module.markers}:{})};
 }
 let rawAt=cpu.startTime;const sortedSamples=cpu.samples.map((id,index)=>{rawAt+=cpu.timeDeltas[index];return {id,at:rawAt,index};}).sort((a,b)=>a.at-b.at||a.index-b.index);
 const phases=[['pre-input',cpu.startTime,marks.pointerdown],['pointer-to-click',marks.pointerdown,marks.click],['click-to-ready',marks.click,marks.ready],['ready-to-two-raf',marks.ready,marks['two-raf']],['tail',marks['two-raf'],cpu.endTime]];
 const phaseData={};
 for(const [name,start,end]of phases){
  const frames=new Map(),scripts=new Map(),moduleSelf=new Map(),moduleInclusive=new Map();let at=cpu.startTime,count=0;
  for(const sample of sortedSamples){
   const previous=at;at=sample.at;const weight=Math.max(0,Math.min(at,end)-Math.max(previous,start))/1000;if(!weight)continue;count++;
   const frame=location(nodes.get(sample.id).callFrame),key=JSON.stringify(frame),prior=frames.get(key)??{...frame,sampledSelfMs:0,sampleCount:0};prior.sampledSelfMs+=weight;prior.sampleCount++;frames.set(key,prior);
   const moduleRow=f=>({script:f.script,webpackModule:f.webpackModule??null,moduleMarkers:f.moduleMarkers??[]});const self=moduleRow(frame);const selfKey=JSON.stringify(self);moduleSelf.set(selfKey,(moduleSelf.get(selfKey)??0)+weight);
   const included=new Set();for(let n=nodes.get(sample.id);n;n=nodes.get(parents.get(n.id))){const f=location(n.callFrame);if(f.webpackModule)included.add(JSON.stringify(moduleRow(f)));}for(const id of included)moduleInclusive.set(id,(moduleInclusive.get(id)??0)+weight);
   const scriptKey=frame.script==='(no script URL)'?`native/automation/${frame.function}`:frame.script;scripts.set(scriptKey,(scripts.get(scriptKey)??0)+weight);
  }
  const groupModule=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([key,ms])=>({...JSON.parse(key),sampledMs:round(ms)}));
  phaseData[name]={byModuleSelf:groupModule(moduleSelf),byModuleInclusive:groupModule(moduleInclusive),durationMs:round((end-start)/1000),sampleCount:count,byScript:[...scripts].sort((a,b)=>b[1]-a[1]).map(([script,ms])=>({script,sampledSelfMs:round(ms)})),topFrames:[...frames.values()].sort((a,b)=>b.sampledSelfMs-a.sampledSelfMs).slice(0,24).map(x=>({...x,sampledSelfMs:round(x.sampledSelfMs)}))};
 }
 const stack=node=>{const frames=[];for(let n=node;n;n=nodes.get(parents.get(n.id)))frames.push(location(n.callFrame));return frames;};
 const observedStacks=cpu.nodes.filter(n=>['getClientRects','getBoundingClientRect'].includes(n.callFrame.functionName)&&n.hitCount).map(n=>({hitCount:n.hitCount,stack:stack(n)}));
 const events=trace.filter(e=>e.ph==='X'&&e.ts+(e.dur??0)>=marks.pointerdown&&e.ts<=marks['two-raf']);
 const observer=events.filter(e=>e.name==='FunctionCall'&&e.args?.data?.functionName==='observe');
 const eventRows=events.filter(e=>e.name==='EventDispatch'&&['pointerdown','pointerup','click'].includes(e.args?.data?.type)).map(e=>({type:e.args.data.type,durationMs:round(e.dur/1000)}));
 const topFunctions=events.filter(e=>e.name==='FunctionCall'&&e.dur>1000).sort((a,b)=>b.dur-a.dur).slice(0,12).map(e=>({durationMs:round(e.dur/1000),function:e.args.data.functionName||'(anonymous)',script:e.args.data.url?new URL(e.args.data.url).pathname:'(injected/unspecified)',line1:e.args.data.lineNumber,column1:e.args.data.columnNumber}));
 const idbFrames=cpu.nodes.filter(n=>/indexeddb|\bIDB|replicache/i.test(n.callFrame.functionName));
 result.roles[role]={rawSha256:{cpu:digest(cpuPath),trace:digest(tracePath)},sampleTimeHandling:{negativeRawDeltaCount:cpu.timeDeltas.filter(d=>d<0).length,method:'Accumulate original deltas into absolute sample timestamps, sort chronologically (stable original index tie-break), weight intervals since previous chronological sample, clip to phase; preserve raw profile unchanged.'},cpuRecordedMs:round((cpu.endTime-cpu.startTime)/1000),phases:phaseData,eventDispatch:eventRows,observerFunctionTraceMs:observer.map(e=>round(e.dur/1000)),nativeGeometryStacks:observedStacks,topFunctionTraceIntervals:topFunctions,namedIndexedDbFrames:idbFrames.map(n=>({frame:location(n.callFrame),hitCount:n.hitCount??0})),styleLayoutPaintIntervals:events.filter(e=>['UpdateLayoutTree','Layout','Paint'].includes(e.name)).map(e=>({name:e.name,durationMs:round(e.dur/1000)}))};
}
fs.writeFileSync(process.argv[4],JSON.stringify(result,null,2)+'\n');
