"use client";

import Image from "next/image";
import { MaterialListSyncIndicator } from "./MaterialListSyncIndicator";
import { resolveReplicacheSyncStatus } from "~/hooks/use-replicache-material-list";
import { useRef } from "react";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { AlertCircle, TrashIcon } from "lucide-react";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";

export interface MaterialListTableRowProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    partDefinition?: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    oneOff?: {
      displayName: string;
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
}

export const MATERIAL_LIST_SHEET_COLUMNS = "grid-cols-[3rem_minmax(16rem,1fr)_10rem_12rem_6rem_7rem_3rem_3rem]";

export function MaterialListTableRow({
  item,
  materialListId,
  suppliers,
  isReplicacheSyncing = false,
}: MaterialListTableRowProps) {
  const removeInFlightRef = useRef(false);

  const removeItem = () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.removeItem({ materialListId, itemId: item.id }));
  };

  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  return (
    <tr className={`grid ${MATERIAL_LIST_SHEET_COLUMNS} parts-picker-row parts-sheet-cells`}>
      <td className="relative min-h-11 w-12 overflow-hidden">
        {item.partDefinition?.imageUrl ? (
          <Image src={item.partDefinition.imageUrl} alt={item.partDefinition.displayName} fill sizes="32px" className="object-contain p-1" />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400"><AlertCircle className="h-4 w-4" /></div>
        )}
      </td>
      <td className="content-center">
        <div className="text-sm leading-snug font-medium">
          {item.oneOff?.displayName ||
            item.partDefinition?.displayName ||
            item.descriptionSnapshot ||
            "Unknown Part"}
          {item.oneOff && (
            <span className="ml-2 text-xs text-gray-500">(One-off)</span>
          )}
        </div>
        {item.oneOff?.sizeNominal && (
          <div className="text-xs text-gray-500">
            Size: {item.oneOff.sizeNominal}
          </div>
        )}
      </td>
      <td className="content-center">
        <QuantityControls
          itemId={item.id}
          quantity={quantity}
          materialListId={materialListId}
          pendingSync={item.pendingSync}
          compact
        />
      </td>
      <td className="content-center">
        <div className="w-full max-w-[200px]">
          {item.partDefinition?.id ? (
            <SupplierSelector
              itemId={item.id}
              partDefinitionId={item.partDefinition.id}
              currentSupplierPartId={item.supplierPart?.id}
              currentSupplierId={item.selectedSupplierId ?? item.supplierId ?? item.supplierPart?.supplierId}
              materialListId={materialListId}
              suppliers={suppliers}
              compact
            />
          ) : (
            <div className="text-sm text-gray-500">
              {item.supplierPart?.supplier?.name || "—"}
            </div>
          )}
        </div>
      </td>
      <td className="content-center">
        <div className="text-sm text-gray-600">
          {unitCost > 0 ? `$${unitCost.toFixed(2)}` : "—"}
        </div>
      </td>
      <td className="content-center">
        <div className="text-sm font-semibold text-gray-900">
          ${lineTotal.toFixed(2)}
        </div>
      </td>
      <td className="content-center text-center"><MaterialListSyncIndicator status={resolveReplicacheSyncStatus(item.pendingSync, isReplicacheSyncing)} /></td>
      <td className="content-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={removeItem}
          className="h-8 w-8 p-0"
          aria-label="Remove item"
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}
