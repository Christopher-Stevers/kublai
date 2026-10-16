"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { setEmailSupplierSkus, type SupplierSkuLine } from "~/lib/order-email-lines";
import { useSupplierEmailPreference } from "~/hooks/use-supplier-email-preference";
export function OrderEmailSkuOption({supplierId,body,lines=[],onChange}:{supplierId?:string;body:string;lines?:SupplierSkuLine[];onChange:(body:string)=>void}){
 const preference=useSupplierEmailPreference(supplierId);
 const latest=useRef({body,lines,onChange});
 useLayoutEffect(()=>{latest.current={body,lines,onChange};});
 useEffect(()=>{
  if(preference.includeSupplierSku===undefined)return;
  const current=latest.current;
  const next=setEmailSupplierSkus(current.body,current.lines,preference.includeSupplierSku);
  if(next!==current.body)current.onChange(next);
 },[preference.includeSupplierSku,supplierId]);
 const checked=lines.some(line=>body.split("\n").includes(line.withSku));
 return <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-primary" checked={checked} disabled={!lines.length||preference.disabled} onChange={event=>{onChange(setEmailSupplierSkus(body,lines,event.target.checked));preference.set(event.target.checked);}}/>Include supplier SKU</label>;
}
