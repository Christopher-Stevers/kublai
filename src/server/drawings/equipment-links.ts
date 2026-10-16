import { and, eq, sql } from "drizzle-orm";
import { drawingWorkspaceEntities } from "~/server/db/drawing-workspace-schema";
import { TRPCError } from "@trpc/server";
import { getDrawingWorkspace, type DrawingContext } from "./service";
import { assertDocumentAccess } from "~/server/documents/access";
import { documentOverview } from "~/server/documents/service";
import { documentBlobPath } from "~/server/documents/storage";
import { equipmentIndex, drawingPdfLocation } from "./equipment-index";
import { containsEquipmentTag, equipmentDrawingDestination, equipmentTagLocations, tagPattern } from "~/lib/equipment-tags";
import type { DrawingMarkupLink } from "~/lib/drawing-workspace";
export type EquipmentSource = {kind:"drawing"|"document";id:string;name:string};
async function documents(ctx:DrawingContext,jobId:string){
 const access=await assertDocumentAccess(ctx.userId,jobId,ctx.db);
 return {...await documentOverview(access),organizationId:access.job.organizationId};
}
export async function equipmentSources(ctx:DrawingContext,sheetId:string){
 const workspace=await getDrawingWorkspace(ctx,sheetId);
 const current=workspace.jobSheets.find(s=>s.id===sheetId);
 if(!current)throw new TRPCError({code:"NOT_FOUND"});
 const versions=await ctx.db.select({entity:drawingWorkspaceEntities.entity}).from(drawingWorkspaceEntities).where(and(eq(drawingWorkspaceEntities.jobId,workspace.jobId),sql`entity->>'kind'='version'`));
 const historical=new Set(versions.flatMap(row=>row.entity.kind==="version"?[row.entity.data.sourceSheetId]:[]));
 const sources:EquipmentSource[]=workspace.jobSheets.filter(s=>s.setId===current.setId&&s.id!==sheetId&&!historical.has(s.id)).map(s=>({kind:"drawing",id:s.id,name:s.name}));
 const docs=await documents(ctx,workspace.jobId);
 for(const doc of docs.documents.filter(d=>!d.deletedAt))sources.push({kind:"document",id:doc.id,name:doc.name});
 return {sources};
}
export async function equipmentMatches(ctx:DrawingContext,input:{sheetId:string;tag:string;source:EquipmentSource}){
 if(!tagPattern(input.tag))throw new TRPCError({code:"BAD_REQUEST",message:"Enter an equipment tag such as HEX-2 or FCU-1."});
 const workspace=await getDrawingWorkspace(ctx,input.sheetId);
 const jobId=workspace.jobId;
 const links:DrawingMarkupLink[]=[];
 const warnings:string[]=[];
 if(input.source.kind==="drawing"){
  const origin=workspace.jobSheets.find(s=>s.id===input.sheetId);
  const target=workspace.jobSheets.find(s=>s.id===input.source.id&&s.setId===origin?.setId);
  if(!target)throw new TRPCError({code:"NOT_FOUND",message:"Drawing is not in this drawing set."});
  const targetWorkspace=await getDrawingWorkspace(ctx,target.id);
  const source=targetWorkspace.jobSheets.find(s=>s.id===targetWorkspace.metadata.currentSourceSheetId)??target;
  const location=drawingPdfLocation(source.imageUrl,jobId);
  if(!location)return {links,warnings:[`${target.name}: no searchable source PDF.`]};
  try{
   const index=await equipmentIndex(location.file,"pdf");
   const page=index.pages.find(p=>p.page===location.page);
   if(!page?.words.length)warnings.push(`${target.name}: no embedded text; scanned recognition is needed.`);
   for(const [n,box]of equipmentTagLocations(page?.words??[],input.tag).entries()){
    const destination=equipmentDrawingDestination({jobId,setId:target.setId,sheetId:target.id,sourceSheetId:source.id,name:target.name,tag:input.tag,box});
    links.push({label:`${input.tag} — ${target.name}${n?` (${n+1})`:""}`.slice(0,255),url:destination.href});
   }
   if(index.incomplete&&!page)warnings.push(`${target.name}: source exceeds the indexing limit.`);
  }catch{warnings.push(`${target.name}: could not finish text search. Try again or link manually.`);}
 }else{
  const docs=await documents(ctx,jobId);
  const doc=docs.documents.find(d=>d.id===input.source.id&&!d.deletedAt);
  if(!doc)throw new TRPCError({code:"NOT_FOUND",message:"Document not available."});
  let found=containsEquipmentTag([doc.name,doc.description,...doc.tags,doc.submittal?.title,doc.submittal?.manufacturer,doc.submittal?.specSection].filter(Boolean).join(" "),input.tag);
  const version=docs.versions.find(v=>v.id===doc.currentVersionId);
  const office=version&&/\.(?:docx|xlsx|pptx)$/i.test(version.name);
  if(version&&(version.mimeType==="application/pdf"||office)){
   try{
    const index=await equipmentIndex(documentBlobPath(docs.organizationId,version.sha256),office?"office":"pdf");
    found ||= index.pages.some(p=>equipmentTagLocations(p.words,input.tag).length>0);
    if(!index.pages.some(p=>p.words.length))warnings.push(`${doc.name}: no searchable text; scanned recognition is needed.`);
    if(index.incomplete)warnings.push(`${doc.name}: only the first 2,000 PDF pages were searched.`);
   }catch{warnings.push(`${doc.name}: contents could not be searched. Metadata was checked.`);}
  }else if(version)warnings.push(`${doc.name}: only its name, tags and description were searched.`);
  if(found)links.push({label:`${input.tag} — ${doc.name}`.slice(0,255),url:`/dashboard/jobs/${jobId}/documents?document=${doc.id}`});
 }
 return {links:links.slice(0,50),warnings,overflow:links.length>50};
}
