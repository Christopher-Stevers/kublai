"use client";
import { DropdownMenuCheckboxItem } from "~/components/ui/dropdown-menu";
import { useSupplierEmailPreference } from "~/hooks/use-supplier-email-preference";
export function SupplierEmailPreferenceItem({supplierId}:{supplierId:string}){
 const preference=useSupplierEmailPreference(supplierId);
 return <DropdownMenuCheckboxItem checked={preference.includeSupplierSku??false} disabled={preference.disabled} onCheckedChange={value=>preference.set(value===true)}>Include supplier SKU in my order emails</DropdownMenuCheckboxItem>;
}
