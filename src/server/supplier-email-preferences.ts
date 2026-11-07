import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db } from "~/server/db";
import { supplierEmailPreferences } from "~/server/db/supplier-email-preferences-schema";
import { suppliers } from "~/server/db/schema";
export async function readSupplierEmailPreference(reader:Pick<typeof db,"select">,userId:string,organizationId:string,supplierId:string){
 const [preference]=await reader.select({includeSupplierSku:supplierEmailPreferences.includeSupplierSku}).from(supplierEmailPreferences).where(and(eq(supplierEmailPreferences.userId,userId),eq(supplierEmailPreferences.organizationId,organizationId),eq(supplierEmailPreferences.supplierId,supplierId))).limit(1);
 return preference?.includeSupplierSku??false;
}
export async function saveSupplierEmailPreference(reader:Pick<typeof db,"select"|"insert">,userId:string,organizationId:string,supplierId:string,includeSupplierSku:boolean){
 const [supplier]=await reader.select({id:suppliers.id}).from(suppliers).where(and(eq(suppliers.id,supplierId),eq(suppliers.organizationId,organizationId))).limit(1);
 if(!supplier)throw new TRPCError({code:"NOT_FOUND",message:"Supplier not found."});
 await reader.insert(supplierEmailPreferences).values({userId,organizationId,supplierId,includeSupplierSku}).onConflictDoUpdate({target:[supplierEmailPreferences.userId,supplierEmailPreferences.supplierId],set:{organizationId,includeSupplierSku}});
 return {includeSupplierSku};
}
