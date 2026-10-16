import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TitleBlockWord } from "~/lib/drawing-title-block";
const execute=promisify(execFile);
export type EquipmentIndex={pages:Array<{page:number;words:TitleBlockWord[]}>;incomplete:boolean};
const cache=new Map<string,{value:EquipmentIndex;bytes:number}>();
let cachedBytes=0;
const pending=new Map<string,Promise<EquipmentIndex>>();
let running=0;
const waiting:Array<()=>void>=[];
async function slot(){if(running>=2)await new Promise<void>(resolve=>waiting.push(resolve));else running++;return()=>{const next=waiting.shift();if(next)next();else running--;};}
export async function equipmentIndex(file:string,format:"pdf"|"office"):Promise<EquipmentIndex>{
 const key=`${file}.equipment-v1.json`;
 const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached.value;}
 const existing=pending.get(key);if(existing)return existing;
 const promise=(async()=>{
  const read=async()=>{
   const bytes=(await stat(key)).size;if(bytes>48*1024*1024)throw Error("Invalid text index size");
   const value=JSON.parse(await readFile(key,"utf8")) as EquipmentIndex;
   if(bytes<=8*1024*1024){cache.set(key,{value,bytes});cachedBytes+=bytes;while(cache.size>4||cachedBytes>12*1024*1024){const first=cache.keys().next().value!;cachedBytes-=cache.get(first)!.bytes;cache.delete(first);}}
   return value;
  };
  try{return await read();}catch{/* Build immutable-source index in an isolated worker. */}
  const release=await slot();
  try{await execute(process.execPath,["--max-old-space-size=512","--import","tsx",path.join(process.cwd(),"src/server/drawings/equipment-index-worker.ts"),file,key,format],{timeout:60_000,maxBuffer:65536});return await read();}finally{release();}
 })();
 pending.set(key,promise);
 try{return await promise;}finally{pending.delete(key);}
}
export function drawingPdfLocation(imageUrl:string,jobId:string){
 const match=/^\/api\/job-rooms\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/floor-([1-9]\d*)\.webp$/i.exec(imageUrl);
 return match?.[1]===jobId?{file:path.join(process.cwd(),"uploads/job-floor-plans",match[1],match[2]!,"plan.pdf"),page:Number(match[3])}:null;
}
