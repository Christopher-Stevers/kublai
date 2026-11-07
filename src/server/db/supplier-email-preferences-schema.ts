import { pgTableCreator, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users, suppliers, organizations } from "./schema";
const table=pgTableCreator(name=>`kublai_${name}`);
export const supplierEmailPreferences=table("supplier_email_preference",d=>({
 userId:d.varchar({length:255}).notNull().references(()=>(users as {id:AnyPgColumn}).id,{onDelete:"cascade"}),
 supplierId:d.uuid().notNull().references(()=>suppliers.id as AnyPgColumn,{onDelete:"cascade"}),
 organizationId:d.uuid().notNull().references(()=>organizations.id as AnyPgColumn,{onDelete:"cascade"}),
 includeSupplierSku:d.boolean().notNull().default(false),
}),t=>[primaryKey({columns:[t.userId,t.supplierId]})]);
