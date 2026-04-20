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
import { PlusIcon, FileTextIcon, ShoppingCartIcon, WifiOffIcon } from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { TrashIcon } from "lucide-react";
import { useOfflineMaterialList } from "~/hooks/use-offline-material-list";
import Image from "next/image";
import {
  applyOfflineRemoveItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";

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

  const { data: serverMaterialList, isLoading } =
    api.materialList.getMaterialList.useQuery(
      { materialListId: id },
      { enabled: !!id },
    );

  const { data: materialList, isOfflineFallback, isOnline } =
    useOfflineMaterialList(id, serverMaterialList);

  const utils = api.useUtils();

  if (isLoading && !materialList) {
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {!isOnline && (
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                <WifiOffIcon className="h-4 w-4" />
                Offline mode
              </div>
            )}
            {isOfflineFallback && (
              <div className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900">
                Showing cached material list data
              </div>
            )}
          </div>
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
            <ViewToggle view={viewMode} onViewChange={setViewMode} showOnMobile />
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
              {/* List View */}
              {viewMode === "table" && (
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
      await utils.materialList.getMaterialList.cancel({ materialListId });

      const previousMaterialList = utils.materialList.getMaterialList.getData({
        materialListId,
      });

      utils.materialList.getMaterialList.setData({ materialListId }, (old) => {
        if (!old) return old;

        const updatedItems = old.items.filter(
          (item) => item.id !== variables.itemId,
        );

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
    onError: (_err, _variables, context) => {
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

  const handleRemove = (itemId: string) => {
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      applyOfflineRemoveItem(materialListId, itemId);
      enqueueOfflineMutation({
        type: "removeItem",
        materialListId,
        itemId,
        queuedAt: new Date().toISOString(),
      });
      void utils.materialList.getMaterialList.invalidate({ materialListId });
      return;
    }

    removeItem.mutate({ itemId });
  };

  return (
    <div className="space-y-2 overflow-x-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex min-w-max flex-nowrap items-center gap-2 rounded-lg border p-2 sm:gap-3"
        >
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100">
            {item.partDefinition?.imageUrl ? (
              <Image
                src={item.partDefinition.imageUrl}
                alt={item.partDefinition.displayName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-max flex-1">
            <div className="whitespace-nowrap text-sm font-medium sm:text-base">
              {item.partDefinition?.displayName ||
                item.descriptionSnapshot ||
                "Unknown Part"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <QuantityControls
              itemId={item.id}
              quantity={parseFloat(item.quantity)}
              materialListId={materialListId}
            />
          </div>
          <div className="min-w-[11rem] shrink-0 sm:min-w-[13rem]">
            <SupplierSelector
              itemId={item.id}
              partDefinitionId={item.partDefinition?.id ?? ""}
              currentSupplierPartId={item.supplierPart?.id}
              materialListId={materialListId}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRemove(item.id)}
            disabled={removeItem.isPending}
            className="shrink-0"
            aria-label="Remove item"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
