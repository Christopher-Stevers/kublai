#!/usr/bin/env node
// @ts-nocheck
// Idempotent organization-scoped addition. Existing catalogue records are never overwritten.
require('dotenv/config');
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const postgres=require('postgres');
const data=JSON.parse(fs.readFileSync('data/catalogue/megapressg.json','utf8'));
const apply=process.argv.includes('--apply'), source='viega-megapressg-20261103';
const hash=x=>createHash('sha256').update(x).digest('hex');
const stable=x=>{const h=hash(x);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
function validate(){
 const skus=new Set();
 for(const r of data.rows){
  if(!/^\d{5,}$/.test(r.sku)||skus.has(r.sku)||!r.displayName.includes('MegaPressG')||r.displayName.length>255||r.material!=='MegaPressG (Natural Gas)'||r.sizeNominal<.5||r.sizeNominal>4||!r.sourceUrl.startsWith(data.sourceUrl.slice(0,-5)+'/')||!data.images[r.imageKey])throw Error('Invalid article '+r.sku);
  skus.add(r.sku);
 }
 if(data.rows.length<100)throw Error('Incomplete catalogue');
 for(const im of Object.values(data.images)){
  if(!path.resolve(im.path).startsWith(path.resolve('public/images/catalog/uploads')+path.sep)||hash(fs.readFileSync(im.path))!==im.sha256||im.url!==`/api/catalogue/images/part-${im.sha256}.webp`)throw Error('Invalid image');
 }
 return {articles:data.rows.length,models:Object.keys(data.images).length};
}
async function main(){
 const validation=validate();
 if(process.argv.includes('--validate-only')){console.log(JSON.stringify(validation));return;}
 const sql=postgres(process.env.DATABASE_URL,{max:1});
 try{const result=await sql.begin(apply?'':'read only',async tx=>{
  const users=await tx`select id,"organizationId" from kublai_user where lower(email)=lower(${process.env.MEGAPRESSG_IMPORT_USER_EMAIL||'tim.j.saunders@gmail.com'})`;
  if(users.length!==1||!users[0].organizationId)throw Error('Expected one organization account');
  const org=users[0].organizationId;
  if(apply)await tx`select pg_advisory_xact_lock(hashtext(${source+org}))`;
  const existing=await tx`select id,"displayName" from kublai_part_definition where "organizationId"=${org} and "displayName" ilike '%megapress%'`;
  const prepared=data.rows.map(r=>({r,id:stable(source+org+r.sku)}));
  const ids=new Set(existing.map(x=>x.id));const pending=prepared.filter(p=>!ids.has(p.id));
  for(const p of pending)if(existing.some(e=>e.displayName.toLowerCase()===p.r.displayName.toLowerCase()))throw Error('Existing matching name requires review: '+p.r.displayName);
  if(!apply)return {mode:'dry-run',...validation,wouldCreate:pending.length,alreadyPresent:prepared.length-pending.length};
  fs.mkdirSync('state-backups',{recursive:true});
  const backup=`state-backups/${source}-${Date.now()}.json`;
  fs.writeFileSync(backup,JSON.stringify({org,existing,plannedNewIds:pending.map(p=>p.id),sourceHash:hash(fs.readFileSync('data/catalogue/megapressg.json'))},null,2));
  const named=async(table,name,extra={})=>{
   const [old]=await tx`select id from ${tx(table)} where "organizationId"=${org} and lower(name)=lower(${name})`;
   if(old)return old.id;
   const [v]=await tx`insert into ${tx(table)} ${tx({id:randomUUID(),organizationId:org,name,...extra})} returning id`;return v.id;
  };
  const catalogId=await named('kublai_catalog','Plumbing',{sortOrder:0,createdAt:new Date(),kind:'materials'});
  const categoryId=await named('kublai_category','Fitting',{sortOrder:1});
  const materialId=await named('kublai_material','MegaPressG (Natural Gas)',{createdAt:new Date()});
  await tx`update kublai_material set "groupPath"=${tx.json(['Press'])} where id=${materialId} and "groupPath"='[]'::jsonb`;
  const [unit]=await tx`select id from kublai_unit where code='in'`;if(!unit)throw Error('Missing inch unit');
  const sizes=new Map((await tx`select id,nominal from kublai_size where "organizationId"=${org} and "unitId"=${unit.id}`).map(s=>[Number(s.nominal),s.id]));
  for(const n of new Set(data.rows.map(r=>r.sizeNominal)))if(!sizes.has(n)){
   const [s]=await tx`insert into kublai_size ${tx({id:randomUUID(),organizationId:org,nominal:String(n),unitId:unit.id,createdAt:new Date()})} returning id`;sizes.set(n,s.id);
  }
  const assets=new Map();
  for(const [key,im] of Object.entries(data.images)){
   let [asset]=await tx`select id from kublai_photo_asset where "organizationId"=${org} and url=${im.url}`;
   if(!asset)[asset]=await tx`insert into kublai_photo_asset ${tx({id:randomUUID(),organizationId:org,storageKey:path.basename(im.path),url:im.url,originalFilename:`Viega-MegaPressG-${im.model}.webp`,contentType:'image/webp',byteSize:im.byteSize,checksum:im.sha256,sourceUrl:im.sourceUrl,notes:'Manufacturer product image; shared across model sizes.',createdAt:new Date(),updatedAt:new Date()})} returning id`;
   assets.set(key,asset.id);
  }
  for(const {id,r} of pending){
   await tx`insert into kublai_part_definition ${tx({id,organizationId:org,catalogId,categoryId,materialId,sizeId:sizes.get(r.sizeNominal),displayName:r.displayName,description:r.description,sizeLabel:r.sizeLabel,imageUrl:data.images[r.imageKey].url,imageAssetId:assets.get(r.imageKey),isActive:true,createdAt:new Date()})}`;
   const attrs={manufacturer:'Viega',manufacturer_model:r.model,manufacturer_part_number:r.sku,manufacturer_source:r.sourceUrl,source_import:source,application:'Natural gas / fuel gas',seal_material:'HNBR',connections:JSON.stringify(r.connections),availability:r.availability};
   await tx`insert into kublai_part_attribute ${tx(Object.entries(attrs).map(([key,valueText])=>({id:randomUUID(),partDefinitionId:id,key,valueText})))}`;
   await tx`insert into kublai_part_synonym ${tx([...new Set(r.aliases)].map(synonym=>({id:randomUUID(),partDefinitionId:id,synonym})))}`;
  }
  const [check]=await tx`select count(*)::int total,count(*) filter(where "imageAssetId" is null or "sizeId" is null)::int incomplete from kublai_part_definition where "organizationId"=${org} and id in ${tx(prepared.map(p=>p.id))}`;
  if(check.total!==data.rows.length||check.incomplete)throw Error('Catalogue verification failed');
  const [revision]=await tx`select revision from kublai_sync_revision where kind='catalogue' and scope=${org}`;
  return {mode:'apply',created:pending.length,alreadyPresent:prepared.length-pending.length,...check,revision:revision?.revision,backup};
 });console.log(JSON.stringify(result,null,2));}finally{await sql.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
