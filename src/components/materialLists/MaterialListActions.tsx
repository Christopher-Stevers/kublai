"use client";
import { PriorityActionBar, type BarSearch } from "~/components/ui/priority-action-bar";
import { FinancialOnly } from "~/components/permissions/FinancialVisibility";
import { useState, type ReactNode } from "react";
import {
  BoxesIcon,
  CheckCheckIcon,
  XIcon,
  FileTextIcon,
  PlusIcon,
  ShoppingCartIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { SaveAsPrefabDialog } from "~/components/materialLists/prefabs/SaveAsPrefabDialog";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useOnlineStatus } from "~/hooks/use-online-status";

export const MATERIAL_LIST_ACTION_CLASS =
  "h-9 min-h-9 w-full gap-1 px-1.5 py-1 text-[11px] leading-tight whitespace-normal [&_svg]:mr-0 sm:h-9 sm:text-xs";

export function MaterialTotalLabel({ total, orderLabel }: { total: number; orderLabel?: ReactNode }) {
  return <div className="flex w-full min-w-0 items-baseline justify-between gap-3">
    {orderLabel && <span className="min-w-0 font-semibold">{orderLabel}</span>}
    <FinancialOnly><span className={`flex flex-wrap items-baseline gap-x-1.5 ${orderLabel ? "ml-auto justify-end text-right" : ""}`}>
      <span className="text-muted-foreground">Material Total</span>
      <span className="font-bold tabular-nums">${total.toFixed(2)}</span>
    </span></FinancialOnly>
  </div>;
}

/** Receiving for one order: the verify page's bar, also shown on the
 * material list while that order's parts are on screen. */
export function OrderReceiveActions({
  search,
  label,
  onNotes,
  onAdd,
  packingSlips,
  onMarkAllReceived,
  onMarkNoneReceived,
  receivingAll = false,
  receiveDisabled = false,
}: {
  search?: BarSearch;
  /** Names the order when the bar sits on the material list. */
  label?: ReactNode;
  onNotes: () => void;
  onAdd?: () => void;
  packingSlips?: ReactNode;
  onMarkAllReceived?: () => void;
  onMarkNoneReceived?: () => void;
  receivingAll?: boolean;
  receiveDisabled?: boolean;
}) {
  const isOnline = useOnlineStatus();
  const style = MATERIAL_LIST_ACTION_CLASS;
  return (
    <PriorityActionBar
      search={search}
      role={label ? "group" : undefined}
      aria-label={label ? "Receive order" : undefined}
      label={label}
    >
      {onMarkNoneReceived && (
        <Button
          variant="outline"
          className={style}
          onClick={onMarkNoneReceived}
          disabled={receiveDisabled || receivingAll || !isOnline}
        >
          <XIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
          Mark none received
        </Button>
      )}
      {onMarkAllReceived && (
        <Button
          variant="outline"
          className={style}
          onClick={onMarkAllReceived}
          disabled={receiveDisabled || receivingAll || !isOnline}
        >
          <CheckCheckIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
          Mark all received
        </Button>
      )}
      <Button className={style} onClick={onNotes}>
        <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
        Notes
      </Button>
      {packingSlips}
      {onAdd && (
        <Button variant="outline" className={style} onClick={onAdd} data-tutorial="add-part">
          <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
          Add Part
        </Button>
      )}
    </PriorityActionBar>
  );
}

function FooterLayer({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!shown || undefined}
      inert={!shown}
      // The bar going away drops out first; the new one rises in just after.
      className={`col-start-1 row-start-1 self-end transition-[opacity,translate,scale] duration-500 ease-in-out motion-reduce:transition-none ${
        shown
          ? "translate-y-0 scale-100 opacity-100 delay-150"
          : "pointer-events-none translate-y-8 scale-95 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

export function MaterialListActions({
  search,
  total,
  totalOrderLabel,
  canGenerate,
  blockedReason,
  canQuote = false,
  canOrder = false,
  canAdd = false,
  orderLabel = "Order",
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
  search?: BarSearch;
  total: number;
  totalOrderLabel?: ReactNode;
  canGenerate: boolean;
  blockedReason?: string | null;
  /** Member may request quotes / send orders (permissions). */
  canQuote?: boolean;
  canOrder?: boolean;
  canAdd?: boolean;
  orderLabel?: string;
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
          search={search}
          label={<MaterialTotalLabel total={total} orderLabel={totalOrderLabel} />}
          onNotes={onNotes}
          onAdd={canAdd ? onAdd : undefined}
          packingSlips={packingSlips}
          onMarkAllReceived={onMarkAllReceived}
          onMarkNoneReceived={onMarkNoneReceived}
          receivingAll={receivingAll}
          receiveDisabled={receiveDisabled}
        />
      </div>
    );
  const listActions = (
    <div>
      <PriorityActionBar
        search={search}
        label={<MaterialTotalLabel total={total} orderLabel={totalOrderLabel} />}
      >
        {canQuote && (
          <Button
            variant="outline"
            className={style}
            onClick={onQuote}
            disabled={!canGenerate}
            title={blockedReason ?? undefined}
          >
            <FileTextIcon className="h-3.5 w-3.5 shrink-0" />
            Get Quote
          </Button>
        )}
        {canAdd && materialListId && !sandbox && (
          <Button
            variant="outline"
            className={style}
            onClick={() => setSavingPrefab(true)}
            disabled={!isOnline}
            title={!isOnline ? "Reconnect to save a prefab" : undefined}
          >
            <BoxesIcon className="h-3.5 w-3.5 shrink-0" />
            Save as Prefab
          </Button>
        )}
        {canOrder && (
          <Button
            className={style}
            onClick={onOrder}
            disabled={!canGenerate}
            title={blockedReason ?? "Order"}
          >
            <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
            {orderLabel}
          </Button>
        )}
        {packingSlips}
        {canAdd && (
          <Button
            variant="outline"
            className={style}
            onClick={onAdd}
            data-tutorial="add-part"
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
            Add Part
          </Button>
        )}
      </PriorityActionBar>
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
