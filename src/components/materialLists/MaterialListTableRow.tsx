"use client";
import { SupplierLabel } from "~/components/suppliers/SupplierLabel";

import { QuotedBadge } from "~/components/jobPricing/QuotedBadge";
import type { SentMaterialOrder } from "./SentMaterialStatus";
import {
  ReceiveCounter,
  ReceiveSummary,
  receiveTint,
  useTableReceive,
  type TableReceive,
} from "./TableReceive";

import { purchaseLineTotal } from "~/lib/purchase-quantity";
import { FinancialOnly, useFinancialVisibility } from "~/components/permissions/FinancialVisibility";

import Image from "next/image";
import { MaterialListSyncIndicator } from "./MaterialListSyncIndicator";
import { resolveReplicacheSyncStatus } from "~/hooks/use-replicache-material-list";
import { memo, useRef, type ReactNode } from "react";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { AlertCircle, TrashIcon } from "lucide-react";
import { useWorkspaceMutations } from "~/hooks/use-workspace-mutations";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";

export interface MaterialListTableRowProps {
  item: {
    jobPriceStatus?: string;
    sentOrderItemId?: string | null;
    priceBookNameSnapshot?: string | null;
    supplierVersion?: import("~/lib/job-supplier-defaults").SupplierVersion | null;
    sentOrder?: SentMaterialOrder | null;
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    roomId?: string | null;
    roomName?: string | null;
    partDefinition?: {
      id: string;
      displayName: string;
      assetTracking?: string | null;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      imageUrl: string | null;
      material: string | null;
    } | null;
    oneOff?: {
      displayName: string;
      piecesPerPack?: number | null;
      bulkUnit?: string | null;
      individualUnit?: string | null;
      description: string | null;
      material: string | null;
      sizeNominal: string | null;
      sizeUnitId: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierId?: string | null;
    supplierPart?: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
    packSize?: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
    uom?: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
    pendingSync?: boolean;
  };
  materialListId: string;
  suppliers?: ReplicacheSupplier[];
  isReplicacheSyncing?: boolean;
  /** Tool request lines go to the tool room: no supplier, no prices. */
  isToolRequest?: boolean;
  /** Receive this ordered part right on the row. */
  receive?: TableReceive | null;
}

export const MATERIAL_LIST_SHEET_COLUMNS =
  "grid-cols-[3rem_minmax(16rem,1fr)_10rem_10rem_12rem_6rem_7rem_3rem_3rem]";

export const MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY =
  "grid-cols-[3rem_minmax(16rem,1fr)_10rem_10rem_12rem_3rem_3rem]";

/** Ordered parts: photo, description, ordered, received, back ordered, room, supplier, then the rest. */
export const MATERIAL_LIST_ORDERED_COLUMNS =
  "grid-cols-[3rem_minmax(16rem,1fr)_6rem_9rem_7rem_10rem_12rem_6rem_7rem_3rem_3rem]";

export const MATERIAL_LIST_ORDERED_COLUMNS_NO_MONEY =
  "grid-cols-[3rem_minmax(16rem,1fr)_6rem_9rem_7rem_10rem_12rem_3rem_3rem]";

type Item = MaterialListTableRowProps["item"];

const partNameOf = (item: Item) =>
  item.oneOff?.displayName ||
  item.partDefinition?.displayName ||
  item.descriptionSnapshot ||
  "Unknown Part";

function PhotoCell({ item }: { item: Item }) {
  return (
    <td className="relative min-h-11 w-12 overflow-hidden">
      {item.partDefinition?.imageUrl ? (
        <Image
          src={item.partDefinition.imageUrl}
          alt={item.partDefinition.displayName}
          fill
          sizes="32px"
          className="part-photo object-contain p-1"
        />
      ) : (
        <div className="text-muted-foreground/70 flex h-full items-center justify-center">
          <AlertCircle className="h-4 w-4" />
        </div>
      )}
    </td>
  );
}

function DescriptionCell({ item, children }: { item: Item; children?: ReactNode }) {
  return (
    <td className="content-center">
      <div className="text-sm leading-snug font-medium">
        {partNameOf(item)}
        {item.oneOff && (
          <span className="text-muted-foreground ml-2 text-xs">
            (One-off)
          </span>
        )}
      </div>
      <QuotedBadge status={item.jobPriceStatus} />
      {children}
      {item.oneOff?.sizeNominal && (
        <div className="text-muted-foreground text-xs">
          Size: {item.oneOff.sizeNominal}
        </div>
      )}
    </td>
  );
}

function RoomCell({ item }: { item: Item }) {
  return (
    <td className="content-center text-sm text-muted-foreground">
      {item.roomName ?? "—"}
    </td>
  );
}

function SupplierCell({ item, materialListId, suppliers, isToolRequest }: Pick<MaterialListTableRowProps, "item" | "materialListId" | "suppliers" | "isToolRequest">) {
  return (
    <td className="content-center">
      <div className="w-full max-w-[200px]">
        {isToolRequest ? (
          <div className="text-muted-foreground text-sm">Tool room</div>
        ) : item.partDefinition?.id && !item.sentOrderItemId ? (
          <SupplierSelector
                  currentVersion={item.supplierVersion}
            itemId={item.id}
            partDefinitionId={item.partDefinition.id}
            currentSupplierPartId={item.supplierPart?.id}
            currentSupplierId={
              item.selectedSupplierId ??
              item.supplierId ??
              item.supplierPart?.supplierId
            }
            materialListId={materialListId}
            suppliers={suppliers}
            compact
          />
        ) : (
          <div className="text-muted-foreground text-sm">
            <SupplierLabel name={item.supplierPart?.supplier?.name} supplierId={item.supplierPart?.supplierId} partId={item.partDefinition?.id} listingId={item.supplierPart?.id} bookName={item.sentOrderItemId ? item.priceBookNameSnapshot ?? "Not recorded" : undefined} fallback="—" />
          </div>
        )}
      </div>
    </td>
  );
}

function MoneyCells({ item, isToolRequest }: { item: Item; isToolRequest: boolean }) {
  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.sentOrderItemId ? Number(item.extendedPrice ?? 0) : purchaseLineTotal(quantity, unitCost, isToolRequest ? null : item.supplierPart?.packSize, isToolRequest ? null : item.partDefinition?.piecesPerPack);
  return (
    <FinancialOnly>
    <td className="content-center">
      <div className="text-muted-foreground text-sm">
        {isToolRequest ? "" : unitCost > 0 ? `$${unitCost.toFixed(2)}` : "—"}
      </div>
    </td>
    <td className="content-center">
      <div className="text-foreground text-sm font-semibold">
        {isToolRequest ? "" : `$${lineTotal.toFixed(2)}`}
      </div>
    </td>
    </FinancialOnly>
  );
}

function SyncAndActionCells({ item, materialListId, isReplicacheSyncing }: { item: Item; materialListId: string; isReplicacheSyncing: boolean }) {
  const { getReplicache: getMaterialListReplicache, mutateAndSync: mutateMaterialListAndSync } = useWorkspaceMutations();
  const removeInFlightRef = useRef(false);

  const removeItem = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void mutateMaterialListAndSync(
      getMaterialListReplicache().mutate.removeItem({
        materialListId,
        itemId: item.id,
      }),
    );
  };

  return (
    <>
      <td className="content-center text-center">
        <MaterialListSyncIndicator
          status={resolveReplicacheSyncStatus(
            item.pendingSync,
            isReplicacheSyncing,
          )}
        />
      </td>
      <td className="content-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={removeItem}
          disabled={Boolean(item.sentOrderItemId)}
          className="h-8 w-8 p-0"
          aria-label="Remove item"
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </td>
    </>
  );
}

function OrderedRow({
  item,
  materialListId,
  suppliers,
  isReplicacheSyncing = false,
  isToolRequest = false,
  receive,
}: MaterialListTableRowProps) {
  const showMoney = useFinancialVisibility();
  const order = item.sentOrder;
  // Without receive controls the row shows where the order stands.
  const shown: TableReceive = receive ?? {
    ordered: order?.quantity ?? item.quantity,
    received: order?.receivedQuantity ?? 0,
    status: order?.verificationStatus,
    unit: item.partDefinition?.bulkUnit ?? item.uom?.code,
    readOnly: true,
    cancelled: order?.status === "cancelled",
  };
  const state = useTableReceive(shown);
  const tint = shown.cancelled ? "" : receiveTint(state.status);

  return (
    <tr
      className={`grid ${showMoney ? MATERIAL_LIST_ORDERED_COLUMNS : MATERIAL_LIST_ORDERED_COLUMNS_NO_MONEY} parts-picker-row parts-sheet-cells`}
    >
      <PhotoCell item={item} />
      <DescriptionCell item={item}>
        <ReceiveSummary receive={shown} state={state} />
      </DescriptionCell>
      <td className="content-center text-sm">
        {state.ordered}
        {state.unit}
      </td>
      <td className={`content-center ${tint}`}>
        <ReceiveCounter state={state} name={partNameOf(item)} />
      </td>
      <td className="content-center text-sm">
        {shown.cancelled ? "—" : `${state.ordered - state.received}${state.unit}`}
      </td>
      <RoomCell item={item} />
      <SupplierCell item={item} materialListId={materialListId} suppliers={suppliers} isToolRequest={isToolRequest} />
      <MoneyCells item={item} isToolRequest={isToolRequest} />
      <SyncAndActionCells item={item} materialListId={materialListId} isReplicacheSyncing={isReplicacheSyncing} />
    </tr>
  );
}

function MaterialListTableRowComponent(props: MaterialListTableRowProps) {
  const {
    item,
    materialListId,
    suppliers,
    isReplicacheSyncing = false,
    isToolRequest = false,
  } = props;
  const showMoney = useFinancialVisibility();
  if (item.sentOrderItemId) return <OrderedRow {...props} />;

  return (
    <tr
      className={`grid ${showMoney ? MATERIAL_LIST_SHEET_COLUMNS : MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY} parts-picker-row parts-sheet-cells`}
    >
      <PhotoCell item={item} />
      <DescriptionCell item={item} />
      <RoomCell item={item} />
      <td className="content-center">
        <QuantityControls
          itemId={item.id}
          quantity={parseFloat(item.quantity)}
                  orderMultiple={isToolRequest ? null : item.supplierPart?.packSize}
                  piecesPerPack={isToolRequest ? null : item.partDefinition?.piecesPerPack} bulkUnit={item.partDefinition?.bulkUnit} individualUnit={item.partDefinition?.individualUnit}
          materialListId={materialListId}
          pendingSync={item.pendingSync}
          compact
        />
      </td>
      <SupplierCell item={item} materialListId={materialListId} suppliers={suppliers} isToolRequest={isToolRequest} />
      <MoneyCells item={item} isToolRequest={isToolRequest} />
      <SyncAndActionCells item={item} materialListId={materialListId} isReplicacheSyncing={isReplicacheSyncing} />
    </tr>
  );
}

// Receive controls get a stable onChange per part. A slip badge is a fresh element each time, so those rows always render.
const sameReceive = (a: TableReceive | null | undefined, b: TableReceive | null | undefined) =>
  a === b ||
  (!a && !b) ||
  (!!a &&
    !!b &&
    !a.badge &&
    !b.badge &&
    a.ordered === b.ordered &&
    a.received === b.received &&
    a.status === b.status &&
    a.unit === b.unit &&
    a.readOnly === b.readOnly &&
    a.cancelled === b.cancelled &&
    a.onChange === b.onChange);

export const MaterialListTableRow = memo(
  MaterialListTableRowComponent,
  (previous, next) =>
    sameReceive(previous.receive, next.receive) &&
    previous.materialListId === next.materialListId &&
    previous.suppliers === next.suppliers &&
    previous.isReplicacheSyncing === next.isReplicacheSyncing &&
    previous.isToolRequest === next.isToolRequest &&
    (previous.item === next.item || JSON.stringify(previous.item) === JSON.stringify(next.item)),
);
