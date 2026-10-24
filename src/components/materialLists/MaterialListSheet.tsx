"use client";
import { useFinancialVisibility } from "~/components/permissions/FinancialVisibility";
import {
  MaterialListTableRow,
  MATERIAL_LIST_SHEET_COLUMNS,
  MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY,
  MATERIAL_LIST_ORDERED_COLUMNS,
  MATERIAL_LIST_ORDERED_COLUMNS_NO_MONEY,
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
  receiveFor,
}: {
  items: MaterialListTableRowProps["item"][];
  materialListId: string;
  suppliers: MaterialListTableRowProps["suppliers"];
  isReplicacheSyncing?: boolean;
  className?: string;
  isToolRequest?: boolean;
  /** Receive controls for ordered parts, when the list is used to receive. */
  receiveFor?: (
    item: MaterialListTableRowProps["item"],
  ) => MaterialListTableRowProps["receive"];
}) {
  const showMoney = useFinancialVisibility();
  const syncing = useReplicacheSyncing();
  const supplierLabel = isToolRequest ? "From" : "Supplier";
  const money = showMoney ? [isToolRequest ? " " : "Each", isToolRequest ? "  " : "Total"] : [];
  // Ordered parts come first, under their own receiving columns.
  const ordered = items.filter((item) => item.sentOrderItemId);
  const notOrdered = items.filter((item) => !item.sentOrderItemId);
  const sections = [
    {
      key: "ordered",
      label: "Ordered",
      items: ordered,
      columns: showMoney ? MATERIAL_LIST_ORDERED_COLUMNS : MATERIAL_LIST_ORDERED_COLUMNS_NO_MONEY,
      width: showMoney ? "min-w-[82rem]" : "min-w-[69rem]",
      headers: ["Photo", "Part description", "Ordered", "Received", "Back ordered", "Room", supplierLabel, ...money, "Sync", "Actions"],
    },
    {
      key: "not-ordered",
      label: "Not ordered",
      items: notOrdered,
      columns: showMoney ? MATERIAL_LIST_SHEET_COLUMNS : MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY,
      width: showMoney ? "min-w-[70rem]" : "min-w-[58rem]",
      headers: ["Photo", "Part description", "Room", "Qty", supplierLabel, ...money, "Sync", "Actions"],
    },
  ].filter((section) => section.items.length || (section.key === "not-ordered" && !ordered.length));
  const split = sections.length > 1;
  return (
    <div data-tutorial={items.length ? "material-items" : undefined} className={`parts-sheet-scroll ${className}`}>
      {sections.map((section) => (
        <table
          key={section.key}
          aria-label={split ? `${section.label} parts` : "Material list"}
          className={`parts-sheet block w-full ${section.width} ${split && section.key === "not-ordered" ? "mt-4 border-t" : ""}`}
        >
          <thead className="sticky top-0 z-10 block">
            <tr
              className={`grid ${section.columns} parts-sheet-header`}
            >
              {section.headers.map((label, index) => (
                <th key={label} className="text-left font-semibold">
                  {index === 1 && split ? `${section.label}: ${label.toLowerCase()}` : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block">
            {section.items.map((item) => (
              <MaterialListTableRow
                key={item.id}
                item={item}
                materialListId={materialListId}
                suppliers={suppliers}
                isReplicacheSyncing={isReplicacheSyncing ?? syncing}
                isToolRequest={isToolRequest || !!item.partDefinition?.assetTracking}
                receive={receiveFor?.(item)}
              />
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
