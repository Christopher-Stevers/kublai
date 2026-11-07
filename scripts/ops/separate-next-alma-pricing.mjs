// Split the reviewed Alma price book into its own selectable supplier profile.
// Keeps original listings and sent order history intact. Dry-run unless --apply.
import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
throw new Error('Superseded: use migrate-alma-supplier-price-books.mjs. Alma is a price book, not a supplier.');
const manifestPath='scripts/data/alma-next-approved-2026-10-14.json';
const m=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const sourceId=m.originalSupplierId ?? m.supplierId;
const targetId='3ed92a3e-e82b-4493-98c1-45afc14a4284';
const apply=process.argv.includes('--apply');
const sql=postgres(process.env.DATABASE_URL,{max:1});
try {
 const result=await sql.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${`${m.organizationId}:${m.jobId}:orders`}))`;
  const [source]=await tx`select * from kublai_supplier where id=${sourceId} and "organizationId"=${m.organizationId}`;
  if(!source || source.name!=='Next')throw Error('Expected original Next supplier');
  const targets=await tx`select * from kublai_supplier where "organizationId"=${m.organizationId} and (id=${targetId} or name='Next (Alma)')`;
  if(targets.some(t=>t.id!==targetId || t.name!=='Next (Alma)'))throw Error('Conflicting target supplier');
  const [book]=await tx`select * from kublai_job_price_list where "jobId"=${m.jobId} and "organizationId"=${m.organizationId} for update`;
  if(!book)throw Error('Alma price book missing');
  const entries=await tx`select e.*,sp."supplierSku",sp."supplierId",sp."partDefinitionId" from kublai_job_price_entry e join kublai_supplier_part sp on sp.id=e."supplierPartId" where e."priceListId"=${book.id} and sp."supplierId" in (${sourceId},${targetId})`;
  const expected=new Set(m.rows.map(r=>r.supplierSku));
  if(entries.length!==728 || entries.some(e=>!expected.has(e.supplierSku)))throw Error('Reviewed 728-row list does not match the live book');
  const originals=await tx`select * from kublai_supplier_part where "supplierId"=${sourceId} and "organizationId"=${m.organizationId} and "supplierSku" in ${tx([...expected])}`;
  if(originals.length!==728)throw Error('Original supplier listings incomplete');
  const current=await tx`select * from kublai_supplier_part where "supplierId"=${targetId}`;
  const bySku=new Map(current.map(r=>[r.supplierSku,r]));
  const mapping=originals.map(old=>({old,newId:bySku.get(old.supplierSku)?.id ?? randomUUID(),existing:bySku.get(old.supplierSku)}));
  for(const row of mapping)if(row.existing && row.existing.partDefinitionId!==row.old.partDefinitionId)throw Error('Part mapping conflict');
  const pending=await tx`select qi.* from kublai_quote_item qi join kublai_material_list ml on ml."quoteId"=qi."quoteId" where ml."jobId"=${m.jobId} and ml."organizationId"=${m.organizationId} and qi."sentOrderItemId" is null and (qi."supplierId" is null or qi."supplierId"=${sourceId}) and qi."supplierPartId" in ${tx(originals.map(r=>r.id))}`;
  const report={createSupplier:!targets.length,createListings:728-current.length,movePriceEntries:entries.filter(e=>e.supplierId===sourceId).length,unsentItems:pending.length};
  if(!apply || (!report.createSupplier && !report.createListings && !report.movePriceEntries && !pending.length))return report;
  const folder=path.join(os.homedir(),'.local/share/foremanhq-import-backups',`next-alma-${Date.now()}`);
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  await fs.writeFile(path.join(folder,'before.json'),JSON.stringify({source,targets,book,entries,originals,current,pending,mapping},null,2),{mode:0o600});
  if(!targets.length)await tx`insert into kublai_supplier ${tx({...source,id:targetId,name:'Next (Alma)',createdAt:new Date(),updatedAt:new Date()})}`;
  for(const row of mapping){
   const entry=entries.find(e=>e.supplierSku===row.old.supplierSku);
   if(!row.existing)await tx`insert into kublai_supplier_part ${tx({...row.old,id:row.newId,supplierId:targetId,isPreferred:false,lastKnownUnitCost:entry.unitCost,createdAt:new Date()})}`;
   if(entry.supplierId===sourceId)await tx`update kublai_job_price_entry set "supplierPartId"=${row.newId},"updatedAt"=now() where id=${entry.id}`;
   const ids=pending.filter(p=>p.supplierPartId===row.old.id).map(p=>p.id);
   if(ids.length)await tx`update kublai_quote_item set "supplierPartId"=${row.newId},"supplierId"=${targetId},"updatedAt"=now() where id in ${tx(ids)} and "sentOrderItemId" is null`;
  }
  await tx`update kublai_job_price_list set revision=revision+1,"updatedAt"=now() where id=${book.id}`;
  await tx`insert into kublai_job_pricing_audit (id,"organizationId","jobId",action,detail) values (${randomUUID()},${m.organizationId},${m.jobId},'separate_supplier_pricing',${tx.json({sourceSupplierId:sourceId,targetSupplierId:targetId,...report})})`;
  const [verified]=await tx`select count(*)::int as count from kublai_job_price_entry e join kublai_supplier_part sp on sp.id=e."supplierPartId" where e."priceListId"=${book.id} and sp."supplierId"=${targetId}`;
  if(verified.count!==728)throw Error('Post-migration listing count mismatch');
  return {...report,backupFolder:folder,verifiedListings:verified.count};
 });
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',...result}));
}finally{await sql.end()}
