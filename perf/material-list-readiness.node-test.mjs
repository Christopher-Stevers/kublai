// Synthetic browser fixture only; no app server, database or timing evidence.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';import {installMaterialReadiness} from './material-list-readiness.mjs';
test('exact route/first-control visibility, unmounted safety, one-time readiness and disconnect',{timeout:15000},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage();await page.route('http://127.0.0.1:39999/**',route=>route.fulfill({contentType:'text/html',body:'<main id="fixture"></main>'}));
 await page.goto('http://127.0.0.1:39999/source');
 await page.evaluate(installMaterialReadiness,'/destination');
 const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
 const read=()=>page.evaluate(()=>performance.getEntriesByName('material-cpu:ready').length);
 // A visible later control on the wrong route cannot latch.
 await page.evaluate(()=>document.querySelector('main').innerHTML='<button aria-label="Increase quantity">later</button>');await flush();assert.equal(await read(),0);
 // Hidden first exact element must not fall through to the visible second.
 await page.evaluate(()=>{history.replaceState(null,'','/destination');document.querySelector('main').innerHTML='<button aria-label="Increase quantity" style="visibility:hidden">first</button><button aria-label="Increase quantity">second</button>';});await flush();assert.equal(await read(),0);
 // An element inserted and removed before observer delivery must not latch.
 await page.evaluate(()=>{document.querySelector('main').innerHTML='';const b=document.createElement('button');b.setAttribute('aria-label','Increase quantity');b.textContent='removed';document.querySelector('main').append(b);b.remove();});await flush();assert.equal(await read(),0);
 // No geometry walk: the first check latches once and disconnects immediately.
 await page.evaluate(()=>{document.querySelector('main').innerHTML='<button aria-label="Increase quantity">visible</button><button aria-label="Increase quantity">second</button>';window.__rectReads=0;const original=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){window.__rectReads++;return original.call(this);};});await flush();assert.equal(await read(),1);
 assert.equal(await page.evaluate(()=>window.__rectReads),1);
 await page.evaluate(()=>document.querySelector('main').setAttribute('data-change','later'));await flush();assert.equal(await read(),1);assert.equal(await page.evaluate(()=>window.__rectReads),1);
 const observed=await page.evaluate(()=>window.__materialCpu.finish());assert.equal(observed.quantityCount,2);assert.equal(observed.ready.firstExactControlVisible,true);
 }finally{await browser.close();}
});
