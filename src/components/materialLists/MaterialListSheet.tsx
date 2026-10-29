"use client";
import { MaterialFocusSection } from "./MaterialFocusSection";
import { MaterialSectionHeading, materialSections } from "./MaterialSectionHeading";
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
  focusedSectionKey,
  isToolRequest = false,
  receiveFor,
}: {
  items: MaterialListTableRowProps["item"][];
  materialListId: string;
  suppliers: MaterialListTableRowProps["suppliers"];
  isReplicacheSyncing?: boolean;
  className?: string;
  focusedSectionKey?: string;
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
  // Parts not ordered yet come first; each order follows under its own
  // receiving columns.
  const sections = materialSections(items, materialListId).map((section) =>
    section.ordered
      ? {
          ...section,
          columns: showMoney ? MATERIAL_LIST_ORDERED_COLUMNS : MATERIAL_LIST_ORDERED_COLUMNS_NO_MONEY,
          width: showMoney ? "min-w-[82rem]" : "min-w-[69rem]",
          headers: ["Photo", "Part description", "Ordered", "Received", section.hasReceivedItems ? "Back ordered" : "Awaiting delivery", "Room", supplierLabel, ...money, "Sync", "Actions"],
        }
      : {
          ...section,
          columns: showMoney ? MATERIAL_LIST_SHEET_COLUMNS : MATERIAL_LIST_SHEET_COLUMNS_NO_MONEY,
          width: showMoney ? "min-w-[70rem]" : "min-w-[58rem]",
          headers: ["Photo", "Part description", "Room", "Qty", supplierLabel, ...money, "Sync", "Actions"],
        },
  );
  return (
    <div data-tutorial={items.length ? "material-items" : undefined} className={`parts-sheet-scroll ${className}`}>
      {sections.map((section, index) => (
        <MaterialFocusSection key={section.key} focused={focusedSectionKey === section.key}>
        {section.label && (
          <MaterialSectionHeading
            label={section.label}
            detail={section.detail}
            href={section.href}
            count={section.items.length}
            orderId={section.orderId}
            sectionKey={section.key}
            className={`sticky left-0 px-3 pb-2 ${index ? "pt-5" : "pt-3"}`}
          />
        )}
        <table
          aria-label={section.label ? `${section.label} parts` : "Material list"}
          data-order-id={section.orderId}
          className={`parts-sheet block w-full ${section.width} ${section.label ? "border-t" : ""}`}
        >
          <thead className="sticky top-0 z-10 block">
            <tr
              className={`grid ${section.columns} parts-sheet-header`}
            >
              {section.headers.map((label) => (
                <th key={label} className="text-left font-semibold">
                  {label}
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
        </MaterialFocusSection>
      ))}
    </div>
  );
}
