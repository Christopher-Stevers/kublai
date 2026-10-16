"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import { equipmentTagCandidates, normalizeEquipmentTag, tagPattern } from "~/lib/equipment-tags";
import type { DrawingMarkupLink, DrawingPoint } from "~/lib/drawing-workspace";
import type { DrawingText } from "~/lib/drawing-text";
export function EquipmentTagLinks({id,sheetId,points,savedTag,readWords,onAdd,onBusy,offline}:{
 id:string;sheetId:string;points:DrawingPoint[];savedTag?:string;readWords:()=>Promise<DrawingText[]>;
 onAdd:(links:DrawingMarkupLink[],tag:string)=>number;onBusy:(busy:boolean)=>void;offline:boolean;
}){
 const utils=api.useUtils();
 const [tag,setTag]=useState(savedTag??"");
 const [candidates,setCandidates]=useState<string[]>([]);
 const [status,setStatus]=useState("Reading the equipment tag…");
 const [warnings,setWarnings]=useState<string[]>([]);
 const [run,setRun]=useState(0);
 const [automatic,setAutomatic]=useState(false);
 const latest=useRef({readWords,onAdd,onBusy});latest.current={readWords,onAdd,onBusy};
 useEffect(()=>{
  if(savedTag){setStatus("Search this tag for related documents and drawings.");return;}
  let active=true;
  void latest.current.readWords().then(words=>{
   if(!active)return;
   const found=equipmentTagCandidates(words,points);setCandidates(found);
   if(found.length===1){setTag(found[0]!);setAutomatic(true);}
   else setStatus(found.length?"Several tags were found. Choose the equipment tag below.":"No readable equipment tag found. Enter the tag to search.");
  }).catch(()=>{if(active)setStatus("Enter the equipment tag, or recognize scanned text first.");});
  return()=>{active=false;};
  // Each draft gets one initial read; later edits use the explicit Search action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[id]);
 useEffect(()=>{
  if((!automatic&&run===0)||offline||!tagPattern(tag))return;
  let cancelled=false;
  latest.current.onBusy(true);setWarnings([]);
  void(async()=>{
   const found:DrawingMarkupLink[]=[];const issues:string[]=[];
   try{
    const {sources}=await utils.drawingsWorkspace.equipmentSources.fetch({sheetId});
    for(const [index,source]of sources.entries()){
     if(cancelled)return;
     setStatus(`Searching ${index+1} of ${sources.length}: ${source.name}`);
     try{
      const result=await utils.drawingsWorkspace.equipmentMatches.fetch({sheetId,tag:normalizeEquipmentTag(tag),source},{staleTime:60_000});
      found.push(...result.links);issues.push(...result.warnings);
      if(result.overflow)issues.push(`${source.name}: more than 50 occurrences; link the remaining locations manually.`);
     }catch{issues.push(`${source.name}: search failed or access changed.`);}
    }
    if(cancelled)return;
    const added=latest.current.onAdd(found,normalizeEquipmentTag(tag));
    if(added<found.length)issues.push("Some destinations were already linked or exceeded the 50-destination limit.");
    setStatus(`${added} related destination${added===1?"":"s"} added to this hyperlink. Save the hyperlink to keep them.`);
    setWarnings(issues);
   }catch{if(!cancelled)setStatus("Could not search related items. Try again when connected.");}
   finally{if(!cancelled)latest.current.onBusy(false);}
  })();
  return()=>{cancelled=true;latest.current.onBusy(false);};
  // Deliberately snapshot the tag on automatic detection or an explicit Search.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[automatic,run,sheetId,offline]);
 return <section className="grid gap-2 rounded-md border p-3" aria-label="Equipment tag links">
  <label className="text-sm font-medium" htmlFor={`equipment-tag-${id}`}>Equipment tag</label>
  <div className="flex gap-2"><Input id={`equipment-tag-${id}`} value={tag} list={`equipment-tags-${id}`} onChange={e=>setTag(e.target.value)} placeholder="e.g. HEX-2"/><Button type="button" variant="outline" disabled={offline||!tagPattern(tag)} onClick={()=>setRun(n=>n+1)}>Search links</Button></div>
  <datalist id={`equipment-tags-${id}`}>{candidates.map(value=><option key={value} value={value}/>)}</datalist>
  <p className="text-muted-foreground text-sm" role="status">{offline?"Reconnect to search related items.":status}</p>
  {warnings.length>0&&<details className="text-sm"><summary>{warnings.length} search notes</summary><ul className="mt-2 list-disc pl-4">{warnings.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
 </section>;
}
