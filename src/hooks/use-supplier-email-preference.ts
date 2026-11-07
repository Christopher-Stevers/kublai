"use client";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "./use-online-status";
import { notify } from "~/components/ui/app-dialogs";
export function useSupplierEmailPreference(supplierId?:string){
 const online=useOnlineStatus(),utils=api.useUtils();
 const {data:me}=api.user.getMe.useQuery(undefined,{enabled:online&&!!supplierId});
 const query=api.user.getSupplierEmailPreference.useQuery({supplierId:supplierId??"",expectedUserId:me?.id??""},{enabled:online&&!!supplierId&&!!me});
 const mutation=api.user.setSupplierEmailPreference.useMutation({onSuccess:(preference,input)=>{
  utils.user.getSupplierEmailPreference.setData({supplierId:input.supplierId,expectedUserId:input.expectedUserId},preference);
 },onError:()=>notify("Could not remember the supplier email preference. Try again when connected.","error")});
 return {includeSupplierSku:query.data?.includeSupplierSku,ready:!!me&&query.isFetched,disabled:!online||!me||!query.isFetched||query.isError||mutation.isPending,set:(includeSupplierSku:boolean)=>{
  if(supplierId&&me)mutation.mutate({supplierId,includeSupplierSku,expectedUserId:me.id});
 }};
}
