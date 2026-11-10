"use client";
import { useRef } from "react";
import { Undo2Icon } from "lucide-react";
import { api } from "~/trpc/react";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import { requestMaterialListReplicacheSync } from "~/lib/replicache-material-list";

export function UndoOrderButton({orderId, disabled, onUndone, menuItem = false}: {orderId:string;disabled?:boolean;onUndone?:()=>Promise<unknown>;menuItem?:boolean}) {
  const utils = api.useUtils();
  const busy = useRef(false);
  const undo = api.materialList.undoOrder.useMutation();
  const handleUndo = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!await confirmAction({title:"Undo this order?", description:"This removes the order and all of its delivery records, and returns its linked material-list items to the editable, unsent state. It cannot recall an email or cancel a supplier's delivery—contact the supplier separately if needed.",confirmLabel:"Undo order",destructive:true})) return;
      await undo.mutateAsync({orderId});
      requestMaterialListReplicacheSync(0,"pull");
      await Promise.all([utils.materialList.listOrders.invalidate(),utils.materialList.previewOrders.invalidate(),utils.materialList.getOrdersForMaterialList.invalidate(),utils.job.getJob.invalidate()]);
      await onUndone?.();
      notify("Order undone. Its linked material-list items are editable again.","success");
    } catch(error) { notify(error instanceof Error ? error.message : "Could not undo order.","error"); }
    finally {busy.current=false;}
  };
  const content = <><Undo2Icon className="h-4 w-4" />{undo.isPending ? "Undoing…" : "Undo order"}</>;
  if (menuItem) return <DropdownMenuItem disabled={disabled || undo.isPending} onSelect={(event) => { event.preventDefault(); void handleUndo(); }}>{content}</DropdownMenuItem>;
  return <Button size="sm" variant="outline" disabled={disabled || undo.isPending} onClick={handleUndo}>{content}</Button>;
}
