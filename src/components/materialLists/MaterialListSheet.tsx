"use client";
import { useFinancialVisibility } from "~/components/permissions/FinancialVisibility";
import {
  MaterialListTableRow,
  MATERIAL_LIST_SHEET_COLUMNS,
  MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY,
  type MaterialListTableRowProps,
} from "./MaterialListTableRow";
import { useReplicacheSyncing } from "~/hooks/use-replicache-material-list";

export function MaterialListSheet({
  items,
  materialListId,
  suppliers,
  isReplicacheSyncing,
  className = "",
  isToolRequest = false,
}: {
  items: MaterialListTableRowProps["item"][];
  materialListId: string;
  suppliers: MaterialListTableRowProps["suppliers"];
  isReplicacheSyncing?: boolean;
  className?: string;
  isToolRequest?: boolean;
}) {
  const showMoney = useFinancialVisibility();
  const syncing = useReplicacheSyncing();
  return (
    <div data-tutorial={items.length ? "material-items" : undefined} className={`parts-sheet-scroll ${className}`}>
      <table
        aria-label="Material list"
        className={`parts-sheet block w-full ${showMoney ? "min-w-[70rem]" : "min-w-[58rem]"}`}
      >
        <thead className="sticky top-0 z-10 block">
          <tr
            className={`grid ${showMoney ? MATERIAL_LIST_SHEET_COLUMNS : MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY} parts-sheet-header`}
          >
            {[
              "Photo",
              "Part description",
              "Room",
              "Qty",
              isToolRequest ? "From" : "Supplier",
              ...(showMoney ? [isToolRequest ? " " : "Each", isToolRequest ? "  " : "Total"] : []),
              "Sync",
              "Actions",
            ].map((label) => (
              <th key={label} className="text-left font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block">
          {items.map((item) => (
            <MaterialListTableRow
              key={item.id}
              item={item}
              materialListId={materialListId}
              suppliers={suppliers}
              isReplicacheSyncing={isReplicacheSyncing ?? syncing}
              isToolRequest={isToolRequest || !!item.partDefinition?.assetTracking}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
