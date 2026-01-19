"use client";

import { PartsTable, type TableColumn } from "~/components/ui/parts-table";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";
import { formatSizeAsFraction } from "~/lib/size-utils";

interface PartsTableViewProps {
  parts: Array<{
    id: string;
    displayName: string;
    material: string | null;
    partType: string | null;
    size: string | null;
    categoryId: string | null;
  }>;
  categoryTree: Array<{ id: string; name: string }>;
  onEdit: (partId: string) => void;
  supplierInfoMap?: Record<
    string,
    {
      preferredSupplier: { id: string; name: string } | null;
      availableSuppliers: Array<{ id: string; name: string }>;
    }
  >;
}

export function PartsTableView({
  parts,
  categoryTree,
  onEdit,
  supplierInfoMap,
}: PartsTableViewProps) {
  // Helper to find category name by ID
  const findCategoryName = (
    tree: Array<{ id: string; name: string }>,
    id: string | null,
  ): string | null => {
    if (!id) return null;
    const cat = tree.find((c) => c.id === id);
    return cat?.name ?? null;
  };

  const columns: TableColumn<(typeof parts)[number]>[] = [
    {
      key: "name",
      label: "Name",
      render: (part) => (
        <button
          onClick={() => onEdit(part.id)}
          className="text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline"
        >
          {part.displayName}
        </button>
      ),
    },
    {
      key: "material",
      label: "Material",
      render: (part) => (
        <div className="text-sm text-gray-600">{part.material || "—"}</div>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (part) => (
        <div className="text-sm text-gray-600">{part.partType || "—"}</div>
      ),
    },
    {
      key: "size",
      label: "Size",
      render: (part) => (
        <div className="text-sm text-gray-600">
          {part.size ? formatSizeAsFraction(part.size) : "—"}
        </div>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (part) => (
        <div className="text-sm text-gray-600">
          {findCategoryName(categoryTree, part.categoryId) || "—"}
        </div>
      ),
    },
    {
      key: "preferredSupplier",
      label: "Preferred Supplier",
      render: (part) => {
        const supplierInfo = supplierInfoMap?.[part.id];
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <PartSuppliersDropdown
              partDefinitionId={part.id}
              currentPreferredSupplierId={
                supplierInfo?.preferredSupplier?.id || null
              }
              availableSuppliers={supplierInfo?.availableSuppliers ?? []}
            />
          </div>
        );
      },
    },
  ];

  return <PartsTable columns={columns} data={parts} />;
}

