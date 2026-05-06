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
import { MoreVerticalIcon, PlusIcon, TrashIcon, EditIcon, PackageIcon, WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineSuppliers } from "~/hooks/use-offline-suppliers";

export function SupplierList() {
  const [editSupplierId, setEditSupplierId] = useState<string | undefined>();
  const [viewPartsSupplierId, setViewPartsSupplierId] = useState<
    string | undefined
  >();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const isBrowserOnline = useOnlineStatus();
  const { data: serverSuppliers, isLoading } = api.supplier.list.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const { data: suppliers, cacheLoaded, isOfflineFallback } = useOfflineSuppliers(serverSuppliers);
  const utils = api.useUtils();
  const deleteSupplier = api.supplier.delete.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.supplier.list.cancel();

      // Snapshot previous value
      const previousSuppliers = utils.supplier.list.getData();

      // Optimistically remove supplier from list
      utils.supplier.list.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((supplier) => supplier.id !== variables.id);
      });

      return { previousSuppliers };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousSuppliers !== undefined) {
        utils.supplier.list.setData(undefined, context.previousSuppliers);
      }
    },
    onSettled: () => {
      void utils.supplier.list.invalidate();
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

  if ((isLoading || !cacheLoaded) && !suppliers) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading suppliers...</p>
      </div>
    );
  }

  if (!suppliers || suppliers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">Suppliers</h2>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Manage your suppliers and their parts
            </p>
          </div>
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            className="h-11 w-full sm:w-auto"
          >
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">Suppliers</h2>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Manage your suppliers and their parts
          </p>
          {isOfflineFallback && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
              <WifiOffIcon className="h-3 w-3" /> Offline cached suppliers
            </p>
          )}
        </div>
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          className="h-11 w-full sm:w-auto"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="divide-y">
          {suppliers.map((supplier) => (
            <div
              key={supplier.id}
              className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50 sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold sm:text-lg">
                  {supplier.name}
                </h3>
                <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-4 sm:text-sm">
                  {supplier.location && (
                    <span className="truncate">
                      📍 {supplier.location.name}
                      {supplier.location.city || supplier.location.region
                        ? ` - ${[supplier.location.city, supplier.location.region]
                            .filter(Boolean)
                            .join(", ")}`
                      : ""}
                    </span>
                  )}
                  {supplier.contactName && (
                    <span className="truncate">{supplier.contactName}</span>
                  )}
                  {supplier.contactEmail && (
                    <span className="truncate">{supplier.contactEmail}</span>
                  )}
                  {supplier.contactPhone && (
                    <span className="truncate">{supplier.contactPhone}</span>
                  )}
                </div>
                {supplier.orderingNotes && (
                  <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
                    {supplier.orderingNotes}
                  </p>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewPartsSupplierId(supplier.id)}
                  className="hidden h-11 sm:inline-flex"
                >
                  <PackageIcon className="mr-2 h-4 w-4" />
                  View Parts
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      aria-label={`Actions for ${supplier.name}`}
                    >
                      <MoreVerticalIcon className="h-5 w-5" />
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
                      className="sm:hidden"
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
            contactName: editingSupplier.contactName,
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
