"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SupplierFormDialog } from "./SupplierFormDialog";
import { SupplierPartsDialog } from "./SupplierPartsDialog";
import { MoreVerticalIcon, PlusIcon, TrashIcon, EditIcon, PackageIcon } from "lucide-react";

export function SupplierList() {
  const [editSupplierId, setEditSupplierId] = useState<string | undefined>();
  const [viewPartsSupplierId, setViewPartsSupplierId] = useState<
    string | undefined
  >();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: suppliers, isLoading } = api.supplier.list.useQuery();
  const deleteSupplier = api.supplier.delete.useMutation({
    onSuccess: () => {
      void api.useUtils().supplier.list.invalidate();
    },
  });

  const handleDelete = (id: string, name: string) => {
    if (
      confirm(
        `Are you sure you want to delete "${name}"? This will also remove all parts associated with this supplier.`,
      )
    ) {
      deleteSupplier.mutate({ id });
    }
  };

  const editingSupplier = suppliers?.find((s) => s.id === editSupplierId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading suppliers...</p>
      </div>
    );
  }

  if (!suppliers || suppliers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Suppliers</h2>
            <p className="text-muted-foreground mt-1">
              Manage your suppliers and their parts
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Supplier
          </Button>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <PackageIcon className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No suppliers yet</h3>
          <p className="text-muted-foreground mt-2">
            Get started by adding your first supplier.
          </p>
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            className="mt-4"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Supplier
          </Button>
        </div>
        <SupplierFormDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Suppliers</h2>
          <p className="text-muted-foreground mt-1">
            Manage your suppliers and their parts
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <PlusIcon className="mr-2 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="divide-y">
          {suppliers.map((supplier) => (
            <div
              key={supplier.id}
              className="flex items-center justify-between p-4 hover:bg-gray-50"
            >
              <div className="flex-1">
                <h3 className="font-semibold">{supplier.name}</h3>
                <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {supplier.location && (
                    <span>
                      📍 {supplier.location.name}
                      {supplier.location.city || supplier.location.region
                        ? ` - ${[supplier.location.city, supplier.location.region]
                            .filter(Boolean)
                            .join(", ")}`
                        : ""}
                    </span>
                  )}
                  {supplier.contactEmail && (
                    <span>{supplier.contactEmail}</span>
                  )}
                  {supplier.contactPhone && (
                    <span>{supplier.contactPhone}</span>
                  )}
                </div>
                {supplier.orderingNotes && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {supplier.orderingNotes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewPartsSupplierId(supplier.id)}
                >
                  <PackageIcon className="mr-2 h-4 w-4" />
                  View Parts
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVerticalIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setEditSupplierId(supplier.id)}
                    >
                      <EditIcon className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setViewPartsSupplierId(supplier.id)}
                    >
                      <PackageIcon className="mr-2 h-4 w-4" />
                      View Parts
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleDelete(supplier.id, supplier.name)}
                    >
                      <TrashIcon className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SupplierFormDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      {editingSupplier && (
        <SupplierFormDialog
          open={!!editSupplierId}
          onOpenChange={(open) => {
            if (!open) setEditSupplierId(undefined);
          }}
          supplierId={editSupplierId}
          initialData={{
            name: editingSupplier.name,
            contactEmail: editingSupplier.contactEmail,
            contactPhone: editingSupplier.contactPhone,
            orderingNotes: editingSupplier.orderingNotes,
            locationId: editingSupplier.locationId,
          }}
        />
      )}

      {viewPartsSupplierId && (
        <SupplierPartsDialog
          open={!!viewPartsSupplierId}
          onOpenChange={(open) => {
            if (!open) setViewPartsSupplierId(undefined);
          }}
          supplierId={viewPartsSupplierId}
        />
      )}
    </div>
  );
}

