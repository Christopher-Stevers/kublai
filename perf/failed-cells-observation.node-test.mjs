import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantityPushIdentity,assertNavigationPreconditions,assertCaptureBounds } from './failed-cells-observation.mjs';
const permission={itemId:'item',materialListId:'list',quantity:11};
const body={mutations:[{id:1,clientID:'synthetic-client',name:'updateItemQuantity',args:{...permission,token:'one'}}]};
test('only one exact proven item increment and identical retry envelope are permitted',()=>{
 const latch=quantityPushIdentity(body,permission,null);assert.ok(latch);assert.equal(quantityPushIdentity(body,permission,latch),latch);
 assert.equal(quantityPushIdentity(body,null,null),null);
 for(const altered of [ {...body,mutations:[]},{mutations:[...body.mutations,...body.mutations]}, {mutations:[{...body.mutations[0],id:2}]},{mutations:[{...body.mutations[0],args:{...permission,quantity:12}}]},{mutations:[{...body.mutations[0],args:{...permission,itemId:'other'}}]},{mutations:[{...body.mutations[0],args:{...permission,extra:true}}]}]) assert.equal(quantityPushIdentity(altered,permission,latch),null);
});
test('visible unique target and negative destination/path guards fail closed',()=>{
 const good={targetVisible:true,targetEnabled:true,destinationVisible:false,pathname:'/jobs',expectedPathname:'/jobs'};assert.doesNotThrow(()=>assertNavigationPreconditions(good));
 for(const changed of [{targetVisible:false},{targetEnabled:false},{destinationVisible:true},{pathname:'/other'}])assert.throws(()=>assertNavigationPreconditions({...good,...changed}));
});
test('capture CPU/trace/aggregate bounds reject overrun rather than accepting a partial operation',()=>{
 assert.doesNotThrow(()=>assertCaptureBounds(3000,5*1024**2,20*1024**2,225*1024**2));
 for(const row of [[3001,0,0,0],[0,5*1024**2+1,0,0],[0,0,20*1024**2+1,0],[0,1,0,250*1024**2]])assert.throws(()=>assertCaptureBounds(...row));
});

test('observer drains queued entries, bounds records, restores only the selected input and performs no geometry reads',async()=>{
 const {JSDOM}=await import('jsdom');
 const dom=new JSDOM('<button id="target">Increase</button><input id="quantity" value="10"><input id="other" value="7">');
 const saved=new Map();for(const name of ['window','document','Element','HTMLInputElement','Node','PerformanceObserver'])saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
 const instances=[];
 class Observer {static supportedEntryTypes=['longtask','event'];constructor(callback){this.callback=callback;this.queue=[];this.disconnected=false;instances.push(this);}observe(){}takeRecords(){return this.queue.splice(0);}disconnect(){this.disconnected=true;}}
 try{
  for(const name of ['window','document','Element','HTMLInputElement','Node'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
  Object.defineProperty(globalThis,'PerformanceObserver',{configurable:true,value:Observer});
  const target=document.querySelector('#target'),input=document.querySelector('#quantity'),other=document.querySelector('#other');
  target.getBoundingClientRect=()=>{throw Error('No capture geometry');};input.getBoundingClientRect=target.getBoundingClientRect;
  const original=Object.getOwnPropertyDescriptor(input,'value');
  const {installFailedCellObservation}=await import('./failed-cells-observation.mjs');installFailedCellObservation({target,input});
  input.value='11';other.value='8';
  instances[0].queue=Array.from({length:110},()=>({name:'self',startTime:1,duration:51}));
  instances[1].queue=[{name:'click',startTime:2,duration:20,processingStart:3,processingEnd:9,interactionId:1}];
  const result=window.__failedCellsDiagnostic.finish();assert.equal(result.longTasks.length,100);assert.equal(result.dropped,10);assert.equal(result.eventTiming.length,1);assert.equal(result.commits.length,1);assert.equal(result.commits[0].after,11);
  assert.deepEqual(Object.getOwnPropertyDescriptor(input,'value'),original);assert.ok(instances.every(x=>x.disconnected));
  input.value='12';assert.equal(window.__failedCellsDiagnostic.finish().commits.length,1);
 }finally{dom.window.close();for(const[name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
