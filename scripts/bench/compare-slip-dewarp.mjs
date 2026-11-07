/** Controlled Jev image rerun. Same questions/options/crop bounds, prepared pixels.
 * Usage: node scripts/bench/compare-slip-dewarp.mjs <benchmark-dir> <org> <job>
 * Saves full raw results privately and adds comparison answers to the test review.
 * Does not modify receipt quantities or the normal saved analysis. */
import fs from 'node:fs/promises';import path from 'node:path';import sharp from 'sharp';import dotenv from 'dotenv';
const [dir,org,job]=process.argv.slice(2);const uuid=/^[0-9a-f-]{36}$/i;
if(!dir||!uuid.test(org??'')||!uuid.test(job??''))throw Error('Expected benchmark directory, organization and job UUID');
const env=dotenv.parse(await fs.readFile('.env'));const source=JSON.parse(await fs.readFile(path.join(dir,'review.json')));
if(!uuid.test(source.versionId))throw Error('Invalid version');
const root=path.join(env.JOB_DOCUMENT_STORAGE_ROOT??'uploads/job-documents','packing-slip-tests',org,job);
const target=path.join(root,source.versionId+'.json');const review=JSON.parse(await fs.readFile(target));
if(review.documentId!==source.documentId)throw Error('Document mismatch');
async function crop(image,box){const m=await sharp(image).metadata();const top=Math.max(0,Math.floor((box.top-.008)*m.height)),bottom=Math.min(m.height,Math.ceil((box.bottom+.008)*m.height));let png=await sharp(image).extract({left:0,top,width:m.width,height:bottom-top}).resize({width:1568,height:1568,fit:'inside'}).png().toBuffer();const meta=await sharp(png).metadata();return sharp(png).extend({left:0,top:0,right:Math.max(0,280-meta.width),bottom:Math.max(0,280-meta.height),background:'white'}).png().toBuffer();}
for(const page of source.pages){if(!review.preparedPages?.includes(page.page))continue;const image=await fs.readFile(path.join(root,`${source.versionId}-page-${page.page}.png`));
for(const row of page.rows){const prefix=`p${page.page}-row${row.index}`;const request=JSON.parse(await fs.readFile(path.join(dir,prefix+'-read-request.json')));request.assets[request.state.row].data_base64=(await crop(image,row.locator.box)).toString('base64');request.assets[request.state.columnHeadings].data_base64=(await crop(image,page.layout.answers.header.box)).toString('base64');
const out=path.join(dir,prefix+'-dewarp-controlled.json');let result;
try{result=JSON.parse(await fs.readFile(out));}catch{const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${env.TYPESAFE_API_KEY}`,'Content-Type':'application/json','TypeSafe-Danger-Zone-Images':'true'},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Jev HTTP ${response.status}`);result=await response.json();await fs.writeFile(out,JSON.stringify(result),{mode:0o600});await fs.writeFile(path.join(dir,prefix+'-dewarp-controlled-request.json'),JSON.stringify(request),{mode:0o600});}
const saved=review.rows.find(r=>r.page===page.page&&r.index===row.index);if(!saved)throw Error('Row mismatch');const compared={};
for(const key of ['part','shipped','backordered']){const a=result.answers?.[key];if(!a||!(a.choice in request.questions[key].criteria)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid model answer');const value=key==='part'&&/^item\d+$/.test(a.choice)?source.items[Number(a.choice.slice(4))]?.description:/^v\d+$/.test(a.choice)?a.choice.slice(1):a.choice.replaceAll('_',' ');if(!value)throw Error('Invalid choice');compared[key]={value,confidence:a.confidence};}
saved.dewarped=compared;
console.log(JSON.stringify({page:page.page,row:row.index,before:Object.fromEntries(['part','shipped','backordered'].map(k=>[k,saved[k]])),after:compared}));
}}
await fs.writeFile(target+'.tmp',JSON.stringify(review),{mode:0o600});await fs.rename(target+'.tmp',target);
