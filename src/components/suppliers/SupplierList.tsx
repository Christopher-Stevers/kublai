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
import {
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  PackageIcon,
  UsersIcon,
} from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import { normalizeSupplierContacts } from "~/lib/supplier-contacts";

export function SupplierList() {
  const [editSupplierId, setEditSupplierId] = useState<string | undefined>();
  const [viewPartsSupplierId, setViewPartsSupplierId] = useState<
    string | undefined
  >();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const isBrowserOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const canDeleteCoreRecords =
    userData?.permissions.canDeleteCoreRecords ?? true;
  const suppliers = useReplicacheSuppliers();

  const handleDelete = (id: string, name: string) => {
    if (!canDeleteCoreRecords) return;

    if (
      confirm(
        `Are you sure you want to delete "${name}"? This will also remove all parts associated with this supplier.`,
      )
    ) {
      void mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.deleteSupplier({ supplierId: id }),
      );
    }
  };

  const editingSupplier = suppliers.find((s) => s.id === editSupplierId);

  if (suppliers.length === 0) {
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
          <PackageIcon className="text-muted-foreground mx-auto h-12 w-12" />
          <h3 className="mt-4 text-lg font-semibold">No suppliers yet</h3>
          <p className="text-muted-foreground mt-2">
            Get started by adding your first supplier.
          </p>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="mt-4">
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
          {suppliers.map((supplier) => {
            const contacts = normalizeSupplierContacts(
              supplier.contacts,
              supplier,
            );
            return (
              <div
                key={supplier.id}
                className="flex flex-col gap-3 p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold sm:text-lg">
                    {supplier.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {contacts.length === 0 ? (
                      <span className="text-muted-foreground rounded-md border border-dashed px-2 py-1 text-xs">
                        No contacts
                      </span>
                    ) : (
                      contacts.map((contact) => (
                        <span
                          key={contact.id}
                          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-gray-50 px-2 py-1 text-xs"
                        >
                          <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 font-medium uppercase text-gray-700">
                            {contact.emailRole === "cc" ? "CC" : "To"}
                          </span>
                          <span className="truncate">
                            {[contact.name, contact.email, contact.phone]
                              .filter(Boolean)
                              .join(" - ")}
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                  {supplier.orderingNotes && (
                    <p className="text-muted-foreground mt-2 text-xs sm:text-sm">
                      {supplier.orderingNotes}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditSupplierId(supplier.id)}
                    className="h-11"
                  >
                    <UsersIcon className="mr-2 h-4 w-4" />
                    Edit Contacts
                  </Button>
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
                      {canDeleteCoreRecords && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            handleDelete(supplier.id, supplier.name)
                          }
                        >
                          <TrashIcon className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
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
            contacts: editingSupplier.contacts,
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
