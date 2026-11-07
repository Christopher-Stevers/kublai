/** Publish an existing image evaluation for read-only, authenticated in-app review.
 * Usage: node scripts/bench/import-slip-test-review.mjs <review.json> <organization UUID> <job UUID>
 * Never changes analyses, receipt quantities or catalogue entries. */
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';
const [source, organizationId, jobId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!source || !uuid.test(organizationId ?? '') || !uuid.test(jobId ?? '')) throw Error('Expected review JSON, organization UUID and job UUID');
const env = dotenv.parse(await fs.readFile('.env'));
const raw = JSON.parse(await fs.readFile(source, 'utf8'));
if (!uuid.test(raw.versionId) || !uuid.test(raw.documentId)) throw Error('Invalid source IDs');
const sql = postgres(env.DATABASE_URL, { max: 1 });
try {
 const [workspace] = await sql`select state from kublai_job_document_workspace where "organizationId"=${organizationId} and "jobId"=${jobId}`;
 const document = workspace?.state.documents.find(d => d.id === raw.documentId && !d.deletedAt && d.packingSlip);
 if (!document || document.currentVersionId !== raw.versionId) throw Error('Source is not a current packing slip in this job');
 const rect = b => ({x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top});
 const rows = raw.pages.flatMap(page => page.rows.map(row => {
  const b = row.locator.box;
  const answer = key => {
   const a = row.answers[key];
   const choice = a.choice;
   const value = key === 'part' && /^item\d+$/.test(choice) ? raw.items[Number(choice.slice(4))]?.description : /^v\d+$/.test(choice) ? choice.slice(1) : choice.replaceAll('_',' ');
   if (!value || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw Error('Invalid answer');
   return {value,confidence:a.confidence};
  };
  return {page:page.page,index:row.index,box:{x:0,y:Math.max(0,b.top-.008),width:1,height:Math.min(1,b.bottom+.008)-Math.max(0,b.top-.008)},header:rect(page.layout.answers.header.box),locationConfidence:row.locator.confidence,kind:answer('kind'),part:answer('part'),shipped:answer('shipped'),backordered:answer('backordered')};
 }));
 const review = {documentId:raw.documentId,versionId:raw.versionId,model:raw.pages[0].layout.model,rows};
 const dir=path.join(env.JOB_DOCUMENT_STORAGE_ROOT ?? 'uploads/job-documents','packing-slip-tests',organizationId,jobId);
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const dest=path.join(dir,raw.versionId+'.json');
 await fs.writeFile(dest+'.tmp',JSON.stringify(review),{mode:0o600});await fs.rename(dest+'.tmp',dest);
 console.log(`Imported ${rows.length} test rows for ${raw.name}`);
} finally {await sql.end();}
