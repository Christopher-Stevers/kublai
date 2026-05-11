"use client";

import { useRef } from "react";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { Button } from "~/components/ui/button";
import { TrashIcon } from "lucide-react";
import {
  applyOfflineRemoveItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";

interface MaterialListTableRowProps {
  item: {
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    partDefinition: {
      id: string;
      displayName: string;
      imageUrl: string | null;
      material: string | null;
    } | null;
    oneOff: {
      displayName: string;
      description: string | null;
      material: string | null;
      sizeNominal: string | null;
      sizeUnitId: string | null;
    } | null;
    selectedSupplierId?: string | null;
    supplierPart: {
      id: string;
      supplierId: string;
      supplierSku: string | null;
      lastKnownUnitCost: string | null;
      supplier: {
        id: string;
        name: string;
      } | null;
    } | null;
    uom: {
      id: string;
      code: string;
      displayName: string | null;
    } | null;
  };
  materialListId: string;
}

export function MaterialListTableRow({
  item,
  materialListId,
}: MaterialListTableRowProps) {
  const removeInFlightRef = useRef(false);

  const removeItem = async () => {
    if (removeInFlightRef.current) return;
    removeInFlightRef.current = true;
    try {
      await applyOfflineRemoveItem(materialListId, item.id);
      await enqueueOfflineMutation({
        type: "removeItem",
        materialListId,
        itemId: item.id,
        queuedAt: new Date().toISOString(),
      });
    } catch (error) {
      removeInFlightRef.current = false;
      throw error;
    }
  };

  const quantity = parseFloat(item.quantity);
  const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
  const lineTotal = item.extendedPrice
    ? parseFloat(item.extendedPrice)
    : quantity * unitCost;

  return (
    <tr className="transition-colors hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-gray-900">
          {item.oneOff?.displayName ||
            item.partDefinition?.displayName ||
            item.descriptionSnapshot ||
            "Unknown Part"}
          {item.oneOff && (
            <span className="ml-2 text-xs text-gray-500">(One-off)</span>
          )}
        </div>
        {(item.oneOff?.material || item.partDefinition?.material) && (
          <div className="text-xs text-gray-500 mt-1">
            {item.oneOff?.material || item.partDefinition?.material}
          </div>
        )}
        {item.oneOff?.sizeNominal && (
          <div className="text-xs text-gray-500">
            Size: {item.oneOff.sizeNominal}
          </div>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <QuantityControls
          itemId={item.id}
          quantity={quantity}
          materialListId={materialListId}
        />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-600">
          {item.uom?.displayName || item.uom?.code || "—"}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="w-full max-w-[200px]">
          {item.partDefinition?.id ? (
            <SupplierSelector
              itemId={item.id}
              partDefinitionId={item.partDefinition.id}
              currentSupplierPartId={item.supplierPart?.id}
              currentSupplierId={item.selectedSupplierId}
              materialListId={materialListId}
            />
          ) : (
            <div className="text-sm text-gray-500">
              {item.supplierPart?.supplier?.name || "—"}
            </div>
          )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-600">
          {unitCost > 0 ? `$${unitCost.toFixed(2)}` : "—"}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-semibold text-gray-900">
          ${lineTotal.toFixed(2)}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void removeItem()}
          className="h-8 w-8 p-0"
          aria-label="Remove item"
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

