"use client";
import { supplierLabel } from "~/lib/supplier-label";
import { SupplierLabel } from "~/components/suppliers/SupplierLabel";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SupplierEmailPreferenceItem } from "./SupplierEmailPreferenceItem";
import { SupplierFormDialog } from "./SupplierFormDialog";
import { SupplierJobPricingToggle } from "./SupplierJobPricingToggle";
import { SupplierJobPricingDialog } from "./SupplierJobPricingDialog";
import { SupplierPriceBooksDialog } from "./SupplierPriceBooksDialog";
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
import { confirmAction } from "~/components/ui/app-dialogs";

export function SupplierList() {
  const [jobPricingSupplierId,setJobPricingSupplierId]=useState<string>();
  const [priceBooksSupplierId,setPriceBooksSupplierId]=useState<string>();
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
    userData?.permissions.can["suppliers.delete"] ?? true;
  const suppliers = useReplicacheSuppliers();
  const [pricingError,setPricingError]=useState<string|null>(null);
  const utils=api.useUtils();
  const pricingPreferences=api.supplierPriceBooks.preferences.useQuery(undefined,{enabled:isBrowserOnline});
  const setPricingPreference=api.supplierPriceBooks.setPreference.useMutation({
    onSuccess:async()=>{setPricingError(null);await Promise.all([utils.supplierPriceBooks.invalidate(),utils.jobPricing.invalidate(),utils.materialList.previewOrders.invalidate()]);},
    onError:e=>setPricingError(e.message),
  });

  const handleDelete = async (id: string, name: string) => {
    if (!canDeleteCoreRecords) return;

    if (
      await confirmAction({
        title: `Delete "${name}"?`,
        description:
          "This also removes all parts associated with this supplier.",
        confirmLabel: "Delete supplier",
        destructive: true,
      })
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
        <PageHeader
          title="Suppliers"
          description="Manage your suppliers and their parts"
          actions={
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              className="h-11 w-full sm:w-auto"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Supplier
            </Button>
          }
        />
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
      <PageHeader
        title="Suppliers"
        description="Manage your suppliers and their parts"
        actions={
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            className="h-11 w-full sm:w-auto"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Supplier
          </Button>
        }
      />

      {pricingError&&<p role="alert" className="text-destructive">{pricingError}</p>}
      <div className="rounded-lg border bg-card">
        <div className="divide-y">
          {suppliers.map((supplier) => {
            const contacts = normalizeSupplierContacts(
              supplier.contacts,
              supplier,
            );
            return (
              <div
                key={supplier.id}
                className="flex flex-col gap-3 p-4 hover:bg-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold sm:text-lg">
                    <SupplierLabel name={supplier.name} supplierId={supplier.id} bookName="Standard" />
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
                          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                        >
                          <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 font-medium uppercase text-foreground/80">
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
                <div className="ml-auto flex flex-wrap shrink-0 items-center gap-2">
                  <SupplierJobPricingToggle checked={pricingPreferences.data?.rows.find(p=>p.supplierId===supplier.id)?.preferJobPricing??true} disabled={!isBrowserOnline||!pricingPreferences.data?.canManage||pricingPreferences.isError||setPricingPreference.isPending} onChange={preferJobPricing=>{setPricingError(null);setPricingPreference.mutate({supplierId:supplier.id,preferJobPricing});}}/>
                  <Button variant="outline" size="sm" className="h-11" onClick={()=>setJobPricingSupplierId(supplier.id)}>Set Job Pricing</Button>
                  <Button variant="outline" size="sm" className="h-11" onClick={()=>setPriceBooksSupplierId(supplier.id)}>View Price Books</Button>
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
                        aria-label={`Actions for ${supplierLabel(supplier.name)}`}
                      >
                        <MoreVerticalIcon className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <SupplierEmailPreferenceItem supplierId={supplier.id} />
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
                            void handleDelete(supplier.id, supplierLabel(supplier.name))
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

      {jobPricingSupplierId && <SupplierJobPricingDialog supplierId={jobPricingSupplierId} onClose={()=>setJobPricingSupplierId(undefined)}/>}
      {priceBooksSupplierId && <SupplierPriceBooksDialog supplierId={priceBooksSupplierId} onClose={()=>setPriceBooksSupplierId(undefined)}/>}
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
