"use client";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import { useState, type ReactNode } from "react";
import {
  BoxesIcon,
  CheckCheckIcon,
  XIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PlusIcon,
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

export const MATERIAL_LIST_ACTION_CLASS =
  "h-9 min-h-9 w-full gap-1 px-1.5 py-1 text-[11px] leading-tight whitespace-normal [&_svg]:mr-0 sm:h-9 sm:text-xs";

/** Receiving for one order: the verify page's bar, also shown on the
 * material list while that order's parts are on screen. */
export function OrderReceiveActions({
  label,
  onNotes,
  packingSlips,
  onMarkAllReceived,
  onMarkNoneReceived,
  receivingAll = false,
  receiveDisabled = false,
}: {
  /** Names the order when the bar sits on the material list. */
  label?: ReactNode;
  onNotes: () => void;
  packingSlips?: ReactNode;
  onMarkAllReceived?: () => void;
  onMarkNoneReceived?: () => void;
  receivingAll?: boolean;
  receiveDisabled?: boolean;
}) {
  const isOnline = useOnlineStatus();
  const style = MATERIAL_LIST_ACTION_CLASS;
  const row = (
    <div data-bottom-menu className={`grid gap-1.5 ${packingSlips ? "grid-cols-4" : "grid-cols-3"}`}>
      <Button variant="outline" className={style} onClick={onMarkAllReceived} disabled={!onMarkAllReceived || receiveDisabled || receivingAll || !isOnline}>
        <CheckCheckIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
        Mark all received
      </Button>
      <Button className={style} onClick={onNotes}>
        <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
        Notes
      </Button>
      {packingSlips}
      <Button variant="outline" className={style} onClick={onMarkNoneReceived} disabled={!onMarkNoneReceived || receiveDisabled || receivingAll || !isOnline}>
        <XIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
        Mark none received
      </Button>
    </div>
  );
  if (!label) return row;
  return (
    <div role="group" aria-label="Receive order" className="space-y-1.5">
      <div className="flex items-baseline gap-1.5 text-sm sm:text-base">{label}</div>
      {row}
    </div>
  );
}

function FooterLayer({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!shown || undefined}
      inert={!shown}
      className={`col-start-1 row-start-1 self-end transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

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
  packingSlips,
  onMarkAllReceived,
  onMarkNoneReceived,
  receivingAll = false,
  receiveDisabled = false,
  materialListId,
  orderActions,
  orderActive = false,
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
  packingSlips?: ReactNode;
  onMarkAllReceived?: () => void;
  onMarkNoneReceived?: () => void;
  receivingAll?: boolean;
  receiveDisabled?: boolean;
  /** Kept for callers; tool routing is handled by the order preview. */
  isToolRequest?: boolean;
  /** The list, for "Save as Prefab" in the More menu. */
  materialListId?: string;
  /** Receiving for an order on the list, swapped in for the list's own
   * actions while `orderActive`. */
  orderActions?: ReactNode;
  orderActive?: boolean;
}) {
  const sandbox = useTutorialSandbox();
  const isOnline = useOnlineStatus();
  const [savingPrefab, setSavingPrefab] = useState(false);
  const style = MATERIAL_LIST_ACTION_CLASS;
  if (onNotes)
    return (
      <div className="mx-auto max-w-6xl">
        <OrderReceiveActions
          onNotes={onNotes}
          packingSlips={packingSlips}
          onMarkAllReceived={onMarkAllReceived}
          onMarkNoneReceived={onMarkNoneReceived}
          receivingAll={receivingAll}
          receiveDisabled={receiveDisabled}
        />
      </div>
    );
  const listActions = (
    <div className="space-y-1.5">
      <FinancialOnly><div className="flex items-baseline gap-1.5">
        <span className="text-base text-muted-foreground sm:text-lg">
          Material Total
        </span>
        <span className="text-base font-bold sm:text-lg">
          ${total.toFixed(2)}
        </span>
      </div></FinancialOnly>
      <div data-bottom-menu className={`grid gap-1.5 ${packingSlips ? "grid-cols-4" : "grid-cols-3"}`}>
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
        {packingSlips}
        <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
          <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
          Add Part
        </Button>
      </div>
    </div>
  );
  return (
    <div data-bottom-menu className="mx-auto max-w-6xl">
      {orderActions ? (
        // Both bars share one cell, so the footer keeps its height while
        // one slides away and the other comes up.
        <div className="grid">
          <FooterLayer shown={!orderActive}>{listActions}</FooterLayer>
          <FooterLayer shown={orderActive}>{orderActions}</FooterLayer>
        </div>
      ) : (
        listActions
      )}
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
