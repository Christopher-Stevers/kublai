import "dotenv/config";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/server/db";
import { pricingMaterialLists as materialLists } from "../../src/server/job-pricing-schema";
import { getJobPriceBook, lockJobPurchasing } from "../../src/server/job-pricing";
import { recalculatePurchaseTotals } from "../../src/server/purchasing";
import { replicacheClientGroups } from "../../src/server/db/schema";

const jobId=z.string().uuid().parse(process.argv[2]);
try {
 const [job]=await db.execute<{id:string;organizationId:string}>(sql`select id,"organizationId" from kublai_job where id=${jobId}`);
 if(!job)throw new Error("Job not found");
 const book=await getJobPriceBook(db,job.organizationId,job.id);if(!book.policy?.active)throw new Error("Job has no active price list");
 const before=await db.execute(sql`select id,"unitCostAtOrderTime",quantity,"requestedQuantity","receivedQuantity" from kublai_order_item where "orderId" in (select id from kublai_order where "jobId"=${jobId}) order by id`);
 const count=await db.transaction(async tx=>{
  await lockJobPurchasing(tx,job.organizationId,jobId);
  const lists=await tx.select({id:materialLists.id,quoteId:materialLists.quoteId}).from(materialLists).where(and(eq(materialLists.jobId,jobId),eq(materialLists.organizationId,job.organizationId)));
  for(const list of lists)if(list.quoteId)await recalculatePurchaseTotals(tx,list.quoteId);
  await tx.update(replicacheClientGroups).set({cvrVersion:sql`${replicacheClientGroups.cvrVersion}+1`,updatedAt:new Date()}).where(eq(replicacheClientGroups.organizationId,job.organizationId));
  return lists.length;
 });
 const after=await db.execute(sql`select id,"unitCostAtOrderTime",quantity,"requestedQuantity","receivedQuantity" from kublai_order_item where "orderId" in (select id from kublai_order where "jobId"=${jobId}) order by id`);
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Historical order records changed unexpectedly");
 console.log({jobId,priceEntries:book.entries.length,materialListsRefreshed:count,historicalOrderLinesPreserved:before.length});
} finally {await db.$client.end();}
