"use client";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import { useState } from "react";
import {
  BoxesIcon,
  CheckCheckIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SendIcon,
  ShoppingCartIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SaveAsPrefabDialog } from "~/components/materialLists/prefabs/SaveAsPrefabDialog";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useOnlineStatus } from "~/hooks/use-online-status";

export function MaterialListActions({
  total,
  canGenerate,
  blockedReason,
  canQuote = true,
  canOrder = true,
  onQuote,
  onOrder,
  onAdd,
  onNotes,
  onMarkAllReceived,
  receivingAll = false,
  receiveDisabled = false,
  isToolRequest = false,
  materialListId,
}: {
  total: number;
  canGenerate: boolean;
  blockedReason?: string | null;
  /** Member may request quotes / send orders (permissions). */
  canQuote?: boolean;
  canOrder?: boolean;
  onQuote: () => void;
  onOrder: () => void;
  onAdd: () => void;
  onNotes?: () => void;
  onMarkAllReceived?: () => void;
  receivingAll?: boolean;
  receiveDisabled?: boolean;
  /** Tool requests: no totals or quotes; "Request" sends to the tool room. */
  isToolRequest?: boolean;
  /** The list, for "Save as Prefab" in the More menu. */
  materialListId?: string;
}) {
  const sandbox = useTutorialSandbox();
  const isOnline = useOnlineStatus();
  const [savingPrefab, setSavingPrefab] = useState(false);
  const style =
    "h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs";
  return (
    <div className="mx-auto max-w-6xl space-y-1.5">
      {!onNotes && !isToolRequest && (
        <FinancialOnly><div className="flex items-baseline gap-1.5">
          <span className="text-base text-muted-foreground sm:text-lg">
            Material Total
          </span>
          <span className="text-base font-bold sm:text-lg">
            ${total.toFixed(2)}
          </span>
        </div></FinancialOnly>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {onNotes ? (
          <>
            <Button variant="outline" className={`${onMarkAllReceived ? "col-span-1" : "col-span-3"} ${style}`} onClick={onNotes}>
              <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Notes
            </Button>
            {onMarkAllReceived && (
              <Button className={`col-span-2 ${style}`} onClick={onMarkAllReceived} disabled={receiveDisabled || receivingAll || !isOnline}>
                <CheckCheckIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                {receivingAll ? "Saving..." : "Mark all received"}
              </Button>
            )}
          </>
        ) : isToolRequest ? (
          <>
            <Button
              className={`col-span-2 ${style}`}
              onClick={onOrder}
              disabled={!canGenerate}
              title={blockedReason ?? "Send to the tool room"}
            >
              <SendIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Send to Tool Room
            </Button>
            <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
              <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Add Tool
            </Button>
          </>
        ) : (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className={style}>
                  <MoreHorizontalIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-48">
                <DropdownMenuItem
                  onSelect={onQuote}
                  disabled={!canGenerate || !canQuote}
                  title={!canQuote ? "You don't have permission to request quotes" : (blockedReason ?? undefined)}
                >
                  <FileTextIcon className="h-4 w-4" />
                  Get Quote
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setSavingPrefab(true)}
                  disabled={!materialListId || !!sandbox || !isOnline}
                  title={!isOnline ? "Reconnect to save a prefab" : undefined}
                >
                  <BoxesIcon className="h-4 w-4" />
                  Save as Prefab
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              className={style}
              onClick={onOrder}
              disabled={!canGenerate || !canOrder}
              title={!canOrder ? "You don't have permission to send orders" : (blockedReason ?? "Order")}
            >
              <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Order
            </Button>
            <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
              <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
              Add Part
            </Button>
          </>
        )}
      </div>
      {materialListId && savingPrefab && (
        <SaveAsPrefabDialog
          open={savingPrefab}
          onOpenChange={setSavingPrefab}
          materialListId={materialListId}
        />
      )}
    </div>
  );
}
