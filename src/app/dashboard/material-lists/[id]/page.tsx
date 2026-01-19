"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button, LargeButton } from "~/components/ui/button";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { JobInfoModal } from "~/components/materialLists/JobInfoModal";
import { QuotePreviewSheet } from "~/components/materialLists/QuotePreviewSheet";
import { OrdersPreviewSheet } from "~/components/materialLists/OrdersPreviewSheet";
import { AddPartDialog } from "~/components/materialLists/AddPartDialog";
import { MaterialListNameModal } from "~/components/materialLists/MaterialListNameModal";
import { ExistingQuotesOrdersDialog } from "~/components/materialLists/ExistingQuotesOrdersDialog";
import { useState } from "react";
import { PlusIcon, FileTextIcon, ShoppingCartIcon } from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { Card, CardContent } from "~/components/ui/card";
import { PartsTable, type TableColumn } from "~/components/ui/parts-table";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { TrashIcon } from "lucide-react";

export default function MaterialListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [showJobInfoModal, setShowJobInfoModal] = useState(false);
  const [showQuoteSheet, setShowQuoteSheet] = useState(false);
  const [showOrdersSheet, setShowOrdersSheet] = useState(false);
  const [showAddPartDialog, setShowAddPartDialog] = useState(false);
  const [showMaterialListNameModal, setShowMaterialListNameModal] =
    useState(false);
  const [showExistingQuotesDialog, setShowExistingQuotesDialog] =
    useState(false);
  const [showExistingOrdersDialog, setShowExistingOrdersDialog] =
    useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | undefined>();
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const { data: materialList, isLoading } =
    api.materialList.getMaterialList.useQuery(
      { materialListId: id },
      { enabled: !!id },
    );

  const utils = api.useUtils();

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading material list...</p>
      </div>
    );
  }

  if (!materialList) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Material list not found</p>
          <Button onClick={() => router.push("/dashboard")}>
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  const handleJobInfoClick = () => {
    setShowJobInfoModal(true);
  };

  const handleGenerateQuote = () => {
    const jobName = (materialList?.job as { name?: string } | undefined)?.name;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowExistingQuotesDialog(true);
  };

  const handleGenerateOrder = () => {
    const jobName = (materialList?.job as { name?: string } | undefined)?.name;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowExistingOrdersDialog(true);
  };

  const handleGenerateNewQuote = () => {
    setSelectedQuoteId(undefined);
    setShowQuoteSheet(true);
  };

  const handleGenerateNewOrder = () => {
    setSelectedOrderId(undefined);
    setShowOrdersSheet(true);
  };

  const handleOpenExistingQuote = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setShowQuoteSheet(true);
  };

  const handleOpenExistingOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setShowOrdersSheet(true);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top Bar */}
      <div className="border-b bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex flex-col content-start items-start gap-2">
                <button
                  onClick={() => setShowMaterialListNameModal(true)}
                  className="text-left"
                >
                  <h1 className="cursor-pointer text-xl font-bold text-gray-900 transition-colors hover:text-gray-700 sm:text-2xl">
                    {(materialList.materialList as { name?: string } | undefined)?.name || "Material List"}
                  </h1>
                </button>
                <button
                  onClick={() => {
                    const jobId = (materialList.job as { id?: string } | undefined)?.id;
                    if (jobId) {
                      router.push(`/dashboard/jobs/${jobId}`);
                    } else {
                      handleJobInfoClick();
                    }
                  }}
                  className="text-muted-foreground mt-1 h-11 text-sm hover:text-gray-900"
                >
                  Job: {(materialList.job as { name?: string } | undefined)?.name || "Not set"}
                </button>
              </div>
            </div>
            <ViewToggle view={viewMode} onViewChange={setViewMode} />
          </div>
        </div>
      </div>

      {/* Main Area - Parts List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          {materialList.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">No parts added</p>
              <LargeButton onClick={() => setShowAddPartDialog(true)}>
                <PlusIcon className="mr-2 h-4 w-4" />
                Add Part now
              </LargeButton>
            </div>
          ) : (
            <>
              {/* Grid View */}
              {viewMode === "grid" && (
                <div className="space-y-2">
                  {materialList.items.map((item) => (
                    <MaterialListItem
                      key={String(item.id)}
                      item={
                        item as {
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
                        }
                      }
                      materialListId={id}
                    />
                  ))}
                </div>
              )}
              {/* Table View */}
              {viewMode === "table" && (
                <Card className="hidden md:block">
                  <CardContent className="p-0">
                    <MaterialListTableView
                      items={
                        materialList.items as Array<{
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
                        }>
                      }
                      materialListId={id}
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer - Always Visible */}
      <div className="border-t bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-600">Material Total</p>
              <p className="text-xl font-bold sm:text-2xl">
                ${materialList.materialTotal.toFixed(2)}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => setShowAddPartDialog(true)}
                className="h-11 w-full sm:w-auto"
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Add Part
              </Button>
              <Button
                variant="outline"
                onClick={handleGenerateQuote}
                className="h-11 w-full sm:w-auto"
              >
                <FileTextIcon className="mr-2 h-4 w-4" />
                Generate Quote
              </Button>
              <Button
                onClick={handleGenerateOrder}
                className="h-11 w-full sm:w-auto"
              >
                <ShoppingCartIcon className="mr-2 h-4 w-4" />
                Generate Order
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals and Sheets */}
      <JobInfoModal
        open={showJobInfoModal}
        onOpenChange={setShowJobInfoModal}
        materialListId={id}
        initialName={(materialList?.job as { name?: string } | undefined)?.name ?? undefined}
        initialLocationId={(materialList?.job as { locationId?: string } | undefined)?.locationId ?? undefined}
      />

      {showQuoteSheet && (
        <QuotePreviewSheet
          open={showQuoteSheet}
          onOpenChange={(open) => {
            setShowQuoteSheet(open);
            if (!open) {
              setSelectedQuoteId(undefined);
            }
          }}
          materialListId={id}
          jobName={(materialList?.job as { name?: string } | undefined)?.name ?? ""}
          quoteId={selectedQuoteId}
        />
      )}

      {showOrdersSheet && (
        <OrdersPreviewSheet
          open={showOrdersSheet}
          onOpenChange={(open) => {
            setShowOrdersSheet(open);
            if (!open) {
              setSelectedOrderId(undefined);
            }
          }}
          materialListId={id}
          orderId={selectedOrderId}
        />
      )}

      <AddPartDialog
        open={showAddPartDialog}
        onOpenChange={setShowAddPartDialog}
        materialListId={id}
      />

      <MaterialListNameModal
        open={showMaterialListNameModal}
        onOpenChange={setShowMaterialListNameModal}
        materialListId={id}
        initialName={
          (materialList?.materialList?.name as string | undefined) ?? null
        }
      />

      <ExistingQuotesOrdersDialog
        open={showExistingQuotesDialog}
        onOpenChange={setShowExistingQuotesDialog}
        materialListId={id}
        type="quote"
        onGenerateNew={handleGenerateNewQuote}
        onOpenExisting={handleOpenExistingQuote}
      />

      <ExistingQuotesOrdersDialog
        open={showExistingOrdersDialog}
        onOpenChange={setShowExistingOrdersDialog}
        materialListId={id}
        type="order"
        onGenerateNew={handleGenerateNewOrder}
        onOpenExisting={handleOpenExistingOrder}
      />
    </div>
  );
}

// Material List Table View Component
function MaterialListTableView({
  items,
  materialListId,
}: {
  items: Array<{
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
  }>;
  materialListId: string;
}) {
  const utils = api.useUtils();
  const removeItem = api.materialList.removeMaterialListItem.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await utils.materialList.getMaterialList.cancel({ materialListId });

      // Snapshot previous value
      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      // Optimistically remove item and recalculate totals
      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.filter(
          (item) => item.id !== variables.itemId,
        );

        // Recalculate material total
        const newMaterialTotal = updatedItems.reduce((sum, item) => {
          const price = item.extendedPrice
            ? parseFloat(item.extendedPrice.toString())
            : 0;
          return sum + price;
        }, 0);

        return {
          ...old,
          items: updatedItems,
          materialTotal: newMaterialTotal,
        };
      });

      return { previousMaterialList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousMaterialList) {
        utils.materialList.getMaterialList.setData(
          { materialListId },
          context.previousMaterialList,
        );
      }
    },
    onSettled: () => {
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
  });

  const columns: TableColumn<(typeof items)[number]>[] = [
    {
      key: "partName",
      label: "Part Name",
      render: (item) => (
        <div>
          <div className="text-sm font-medium text-gray-900">
            {item.partDefinition?.displayName ||
              item.descriptionSnapshot ||
              "Unknown Part"}
          </div>
          {item.partDefinition?.material && (
            <div className="mt-1 text-xs text-gray-500">
              {item.partDefinition.material}
            </div>
          )}
        </div>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "quantity",
      label: "Quantity",
      render: (item) => (
        <QuantityControls
          itemId={item.id}
          quantity={parseFloat(item.quantity)}
          materialListId={materialListId}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "unit",
      label: "Unit",
      render: (item) => (
        <div className="text-sm text-gray-600">
          {item.uom?.displayName || item.uom?.code || "—"}
        </div>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "supplier",
      label: "Supplier",
      render: (item) => (
        <div className="w-full max-w-[200px]">
          <SupplierSelector
            itemId={item.id}
            partDefinitionId={item.partDefinition?.id ?? ""}
            currentSupplierPartId={item.supplierPart?.id}
            materialListId={materialListId}
          />
        </div>
      ),
    },
    {
      key: "unitCost",
      label: "Unit Cost",
      render: (item) => {
        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
        return (
          <div className="text-sm text-gray-600">
            {unitCost > 0 ? `$${unitCost.toFixed(2)}` : "—"}
          </div>
        );
      },
      className: "whitespace-nowrap",
    },
    {
      key: "lineTotal",
      label: "Line Total",
      render: (item) => {
        const quantity = parseFloat(item.quantity);
        const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
        const lineTotal = item.extendedPrice
          ? parseFloat(item.extendedPrice)
          : quantity * unitCost;
        return (
          <div className="text-sm font-semibold text-gray-900">
            ${lineTotal.toFixed(2)}
          </div>
        );
      },
      className: "whitespace-nowrap",
    },
    {
      key: "actions",
      label: "Actions",
      render: (item) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeItem.mutate({ itemId: item.id })}
          disabled={removeItem.isPending}
          className="h-8 w-8 p-0"
          aria-label="Remove item"
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      ),
      className: "whitespace-nowrap",
    },
  ];

  return <PartsTable columns={columns} data={items} />;
}
