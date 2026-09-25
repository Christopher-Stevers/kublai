"use client";
import {
  MaterialListTableRow,
  MATERIAL_LIST_SHEET_COLUMNS,
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
  const syncing = useReplicacheSyncing();
  return (
    <div className={`parts-sheet-scroll ${className}`}>
      <table
        aria-label="Material list"
        className="parts-sheet block w-full min-w-[60rem]"
      >
        <thead className="sticky top-0 z-10 block">
          <tr
            className={`grid ${MATERIAL_LIST_SHEET_COLUMNS} parts-sheet-header`}
          >
            {[
              "Photo",
              "Part description",
              "Qty",
              isToolRequest ? "From" : "Supplier",
              isToolRequest ? " " : "Each",
              isToolRequest ? "  " : "Total",
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
              isToolRequest={isToolRequest}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
