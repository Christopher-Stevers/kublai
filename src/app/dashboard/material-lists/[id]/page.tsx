"use client";

import { use, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";
import { Button, LargeButton } from "~/components/ui/button";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { JobInfoModal } from "~/components/materialLists/JobInfoModal";
import { QuotePreviewSheet } from "~/components/materialLists/QuotePreviewSheet";
import { OrdersPreviewSheet } from "~/components/materialLists/OrdersPreviewSheet";
import { AddPartDialog } from "~/components/materialLists/AddPartDialog";
import { MaterialListNameModal } from "~/components/materialLists/MaterialListNameModal";
import { ExistingQuotesOrdersDialog } from "~/components/materialLists/ExistingQuotesOrdersDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import {
  CheckCircle2Icon,
  Clock3Icon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  TrashIcon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import {
  resolveReplicacheSyncStatus,
  useReplicacheMaterialList,
  useReplicacheSyncing,
  type ReplicacheSyncStatus,
} from "~/hooks/use-replicache-material-list";
import { useReplicacheJobDetail } from "~/hooks/use-replicache-jobs";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";
import Image from "next/image";
import { markUserAction } from "~/lib/performance-marks";

function MaterialListSyncBadge({ status }: { status: ReplicacheSyncStatus }) {
  if (status === "syncing") {
    return (
      <div className="inline-flex h-6 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0 text-xs font-medium leading-none text-blue-900 whitespace-nowrap">
        <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="leading-none">Syncing</span>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="inline-flex h-6 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-0 text-xs font-medium leading-none text-orange-900 whitespace-nowrap">
        <Clock3Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="leading-none">Pending sync</span>
      </div>
    );
  }

  return (
    <div className="inline-flex h-6 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0 text-xs font-medium leading-none text-emerald-900 whitespace-nowrap">
      <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="leading-none">Synced</span>
    </div>
  );
}

function MaterialListSyncIndicator({ status }: { status: ReplicacheSyncStatus }) {
  if (status === "syncing") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 ring-1 ring-blue-200"
        title="Syncing"
        aria-label="Syncing"
      >
        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-orange-900 ring-1 ring-orange-200"
        title="Pending sync"
        aria-label="Pending sync"
      >
        <Clock3Icon className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200"
      title="Synced"
      aria-label="Synced"
    >
      <CheckCircle2Icon className="h-3.5 w-3.5" />
    </span>
  );
}

export default function MaterialListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: paramId } = use(params);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id =
    pathname.match(/^\/dashboard\/material-lists\/([^/?#]+)/)?.[1] ?? paramId;
  const verifyOrderId = searchParams.get("orderId");
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
  const [showVerifyNotesDialog, setShowVerifyNotesDialog] = useState(false);
  const [verifyOrderNotes, setVerifyOrderNotes] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | undefined>();
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const isBrowserOnline = useOnlineStatus();

  const { materialList: mlHeader, items, materialTotal, isLoading } =
    useReplicacheMaterialList(id);
  const { data: verifyOrder, isLoading: isLoadingVerifyOrder } =
    api.materialList.getOrderById.useQuery(
      { orderId: verifyOrderId ?? "" },
      { enabled: isBrowserOnline && !!verifyOrderId },
    );
  const suppliers = useReplicacheSuppliers();
  const jobDetail = useReplicacheJobDetail(mlHeader?.jobId ?? "");
  const jobName = jobDetail?.job.name;

  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const utils = api.useUtils();
  const updateOrderNotes = api.materialList.updateOrderNotes.useMutation({
    onSuccess: (updatedOrder) => {
      setVerifyOrderNotes(updatedOrder.notes ?? "");
      if (verifyOrderId) {
        void utils.materialList.getOrderById.invalidate({
          orderId: verifyOrderId,
        });
      }
      setShowVerifyNotesDialog(false);
    },
  });
  const updateOrderItemVerification =
    api.materialList.updateOrderItemVerification.useMutation();
  const canGenerateDocuments =
    userData?.permissions.canGenerateDocuments ?? true;
  const isReplicacheSyncing = useReplicacheSyncing();
  const hasPendingSync =
    (mlHeader?.pendingSync ?? false) || items.some((i) => i.pendingSync);
  const listSyncStatus = resolveReplicacheSyncStatus(
    hasPendingSync,
    isReplicacheSyncing,
  );
  const verifySupplierId = verifyOrder?.supplier?.id ?? null;
  const verifyOrderPartDefinitionIds = new Set(
    verifyOrder?.items
      .map((item) => item.partDefinitionId)
      .filter(
        (partDefinitionId): partDefinitionId is string => !!partDefinitionId,
      ) ?? [],
  );
  const verifyOrderSupplierPartIds = new Set(
    verifyOrder?.items
      .map((item) => item.supplierPartId)
      .filter((supplierPartId): supplierPartId is string => !!supplierPartId) ??
      [],
  );
  const visibleItems =
    verifyOrderId
      ? verifyOrder
        ? items.filter((item) => {
          if (
            item.supplierPart?.id &&
            verifyOrderSupplierPartIds.has(item.supplierPart.id)
          ) {
            return true;
          }

          const itemSupplierId =
            item.supplierId ?? item.supplierPart?.supplierId ?? null;
          return (
            !!item.partDefinition?.id &&
            verifyOrderPartDefinitionIds.has(item.partDefinition.id) &&
            (!verifySupplierId || itemSupplierId === verifySupplierId)
          );
        })
        : []
      : items;
  const visibleMaterialTotal = visibleItems.reduce((sum, item) => {
    const extendedPrice = item.extendedPrice
      ? Number.parseFloat(item.extendedPrice)
      : Number.NaN;
    if (Number.isFinite(extendedPrice)) return sum + extendedPrice;

    const quantity = Number.parseFloat(item.quantity);
    const unitCost = item.unitCost ? Number.parseFloat(item.unitCost) : 0;
    return sum + (Number.isFinite(quantity) ? quantity : 0) * unitCost;
  }, 0);
  const footerMaterialTotal = verifyOrderId ? visibleMaterialTotal : materialTotal;

  useEffect(() => {
    if (!verifyOrderId) {
      setVerifyOrderNotes("");
      return;
    }

    if (verifyOrder) {
      setVerifyOrderNotes(verifyOrder.notes ?? "");
    }
  }, [verifyOrderId, verifyOrder]);

  const openAddPartDialog = () => {
    markUserAction("add-part-open", { materialListId: id });
    setShowAddPartDialog(true);
  };

  const generationBlockReason = !isBrowserOnline
    ? "Reconnect before generating quotes or orders."
    : !canGenerateDocuments
      ? "Standard accounts cannot generate quotes or orders."
      : isLoading
        ? "Loading material list data..."
        : hasPendingSync
          ? "Finish syncing this material list before generating a quote or order."
          : null;
  const canGenerateQuoteOrOrder = !generationBlockReason;

  const handleJobInfoClick = () => {
    setShowJobInfoModal(true);
  };

  const handleGenerateQuote = () => {
    if (!canGenerateQuoteOrOrder) return;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowExistingQuotesDialog(true);
  };

  const handleGenerateOrder = () => {
    if (!canGenerateQuoteOrOrder) return;
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

  if (isLoading && !mlHeader) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col">
        <div className="border-b bg-white px-4 py-2 sm:px-6 sm:py-3">
          <div className="mx-auto max-w-6xl animate-pulse">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="h-5 w-44 rounded bg-gray-200" />
                <div className="h-4 w-28 rounded bg-gray-100" />
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="h-6 w-24 rounded-full bg-gray-100" />
                <div className="h-8 w-20 rounded-lg bg-gray-100" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl animate-pulse space-y-2">
            <div className="h-32 rounded-2xl bg-gray-100" />
            <div className="h-32 rounded-2xl bg-gray-100" />
            <div className="h-32 rounded-2xl bg-gray-100" />
          </div>
        </div>
        <div className="shrink-0 border-t bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-6xl animate-pulse space-y-2">
            <div className="h-5 w-36 rounded bg-gray-100" />
            <div className="grid grid-cols-3 gap-1.5">
              <div className="h-9 rounded bg-gray-100" />
              <div className="h-9 rounded bg-gray-100" />
              <div className="h-9 rounded bg-gray-100" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!mlHeader) {
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

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* Top Bar */}
      <div className="border-b bg-white px-4 py-2 sm:px-6 sm:py-3">
        <div className="mx-auto max-w-6xl">
          {!isBrowserOnline && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                <WifiOffIcon className="h-4 w-4" />
                Offline mode
              </div>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-col content-start items-start gap-0.5">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg leading-tight font-bold text-gray-900 sm:text-xl">
                    {mlHeader.name || "Material List"}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowMaterialListNameModal(true)}
                    className="h-8 w-8 shrink-0"
                    aria-label="Edit material list"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </Button>
                </div>
                <button
                  onClick={() => {
                    if (mlHeader.jobId) {
                      router.push(`/dashboard/jobs/${mlHeader.jobId}`);
                    } else {
                      handleJobInfoClick();
                    }
                  }}
                  className="text-muted-foreground h-auto text-sm leading-tight hover:text-gray-900"
                >
                  Job: {jobName || "Not set"}
                </button>
              </div>
            </div>
            <div className="flex min-w-[5.75rem] shrink-0 flex-col items-end gap-1">
              <MaterialListSyncBadge status={listSyncStatus} />
              <ViewToggle
                view={viewMode}
                onViewChange={setViewMode}
                showOnMobile
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Area - Parts List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          {verifyOrderId && (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
              <span className="font-semibold">Verify Order</span>
              {verifyOrder ? (
                <span>
                  {" "}
                  {verifyOrder.orderNumber || `#${verifyOrder.id.slice(0, 8)}`}
                  {verifyOrder.supplier?.name
                    ? ` - ${verifyOrder.supplier.name}`
                    : ""}
                </span>
              ) : isLoadingVerifyOrder ? (
                <span> Loading order...</span>
              ) : (
                <span> Order unavailable</span>
              )}
            </div>
          )}
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">
                {verifyOrderId && isLoadingVerifyOrder
                  ? "Loading order items..."
                  : verifyOrderId
                  ? "No parts from this order are in the material list."
                  : "No parts added"}
              </p>
              {!verifyOrderId && (
                <LargeButton onClick={openAddPartDialog}>
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add Part Now
                </LargeButton>
              )}
            </div>
          ) : (
            <>
              {/* Grid View */}
              {viewMode === "grid" && (
                <div className="grid items-stretch grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
                  {visibleItems.map((item) => {
                    const verifyOrderItem = verifyOrder?.items.find(
                      (orderItem) => {
                        if (
                          item.supplierPart?.id &&
                          orderItem.supplierPartId === item.supplierPart.id
                        ) {
                          return true;
                        }

                        const itemSupplierId =
                          item.supplierId ?? item.supplierPart?.supplierId ?? null;
                        return (
                          orderItem.partDefinitionId === item.partDefinition?.id &&
                          (!verifySupplierId || itemSupplierId === verifySupplierId)
                        );
                      },
                    );

                    return (
                      <MaterialListItem
                        key={item.id}
                        item={{
                          id: item.id,
                          quantity: item.quantity,
                          unitCost: item.unitCost,
                          extendedPrice: item.extendedPrice,
                          descriptionSnapshot: item.descriptionSnapshot,
                          createdAt: item.createdAt,
                          updatedAt: item.updatedAt,
                          pendingSync: item.pendingSync,
                          partDefinition: item.partDefinition ?? null,
                          selectedSupplierId: item.supplierId,
                          supplierPart: item.supplierPart ?? null,
                          addedBy: item.addedBy ?? null,
                        }}
                        materialListId={id}
                        suppliers={suppliers}
                        verifyMode={!!verifyOrderId}
                        verifyOrderedQuantity={verifyOrderItem?.quantity}
                        verifyInitialReceivedQuantity={
                          verifyOrderItem?.receivedQuantity
                        }
                        verifyInitialStatus={verifyOrderItem?.verificationStatus}
                        onVerifyStateChange={
                          verifyOrderItem
                            ? (state) => {
                                updateOrderItemVerification.mutate({
                                  orderItemId: verifyOrderItem.id,
                                  receivedQuantity: state.receivedQuantity,
                                  verificationStatus: state.verificationStatus,
                                });
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              )}
              {/* Table View */}
              {viewMode === "table" && (
                <MaterialListTableView
                  items={visibleItems}
                  materialListId={id}
                  suppliers={suppliers}
                  isReplicacheSyncing={isReplicacheSyncing}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer - Always Visible */}
      <div className="shrink-0 border-t bg-white px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-2">
        <div className="mx-auto max-w-6xl">
          <div className="space-y-1.5">
            {!verifyOrderId && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-base text-gray-600 sm:text-lg">
                  Material Total
                </span>
                <span className="text-base font-bold sm:text-lg">
                  ${footerMaterialTotal.toFixed(2)}
                </span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {verifyOrderId ? (
                <Button
                  variant="outline"
                  onClick={() => setShowVerifyNotesDialog(true)}
                  className="col-span-3 h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                >
                  <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                  <span className="text-center leading-tight">Notes</span>
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={handleGenerateQuote}
                    disabled={!canGenerateQuoteOrOrder}
                    title={generationBlockReason ?? "Generate quote"}
                    className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                  >
                    <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <span className="text-center leading-tight">Quote</span>
                  </Button>
                  <Button
                    onClick={handleGenerateOrder}
                    disabled={!canGenerateQuoteOrOrder}
                    title={generationBlockReason ?? "Order"}
                    className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                  >
                    <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <span className="text-center leading-tight">Order</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={openAddPartDialog}
                    className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
                  >
                    <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <span className="text-center leading-tight">Add Part</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals and Sheets */}
      <Dialog
        open={showVerifyNotesDialog}
        onOpenChange={setShowVerifyNotesDialog}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Order Notes</DialogTitle>
            <DialogDescription>
              Notes saved on this order for verification.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            id="verify-order-notes"
            value={verifyOrderNotes}
            onChange={(event) => setVerifyOrderNotes(event.target.value)}
            placeholder="Type order verification notes..."
            className="min-h-[10rem]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setVerifyOrderNotes(verifyOrder?.notes ?? "");
                setShowVerifyNotesDialog(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!verifyOrderId) return;
                updateOrderNotes.mutate({
                  orderId: verifyOrderId,
                  notes: verifyOrderNotes,
                });
              }}
              disabled={
                !isBrowserOnline || !verifyOrderId || updateOrderNotes.isPending
              }
              title={
                !isBrowserOnline
                  ? "Reconnect before saving order notes."
                  : undefined
              }
            >
              {updateOrderNotes.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <JobInfoModal
        open={showJobInfoModal}
        onOpenChange={setShowJobInfoModal}
        materialListId={id}
        initialName={jobName ?? null}
        initialLocationId={jobDetail?.job.locationId ?? undefined}
      />

      {showQuoteSheet && (
        <QuotePreviewSheet
          open={showQuoteSheet}
          onOpenChange={(open) => {
            setShowQuoteSheet(open);
            if (!open) setSelectedQuoteId(undefined);
          }}
          materialListId={id}
          jobName={jobName ?? ""}
          quoteId={selectedQuoteId}
        />
      )}

      {showOrdersSheet && (
        <OrdersPreviewSheet
          open={showOrdersSheet}
          onOpenChange={(open) => {
            setShowOrdersSheet(open);
            if (!open) setSelectedOrderId(undefined);
          }}
          materialListId={mlHeader.id}
          orderId={selectedOrderId}
        />
      )}

      {showAddPartDialog && (
        <AddPartDialog
          open={showAddPartDialog}
          onOpenChange={(open) => {
            if (open) {
              openAddPartDialog();
            } else {
              setShowAddPartDialog(false);
            }
          }}
          materialListId={id}
        />
      )}

      <MaterialListNameModal
        open={showMaterialListNameModal}
        onOpenChange={setShowMaterialListNameModal}
        materialListId={id}
        initialName={mlHeader.name ?? null}
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
        materialListId={mlHeader.id}
        type="order"
        onGenerateNew={handleGenerateNewOrder}
        onOpenExisting={handleOpenExistingOrder}
      />
    </div>
  );
}

// Material List Table View Component
const MATERIAL_LIST_TABLE_COLUMNS =
  "grid-cols-[2rem_7rem_minmax(14rem,1.6fr)_minmax(9rem,1fr)_5rem_6rem_1.75rem_2rem]";

type TableItem = {
  id: string;
  quantity: string;
  unitCost: string | null;
  extendedPrice: string | null;
  descriptionSnapshot: string | null;
  pendingSync?: boolean;
  supplierId?: string | null;
  partDefinition?: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
  } | null;
  supplierPart?: {
    id: string;
    supplierId: string;
    supplierSku: string | null;
    lastKnownUnitCost: string | null;
    supplier: { id: string; name: string } | null;
  } | null;
};

function MaterialListTableView({
  items,
  materialListId,
  suppliers,
  isReplicacheSyncing,
}: {
  items: TableItem[];
  materialListId: string;
  suppliers: ReturnType<typeof useReplicacheSuppliers>;
  isReplicacheSyncing: boolean;
}) {
  const handleRemove = (itemId: string) => {
    void mutateMaterialListAndSync(getMaterialListReplicache().mutate.removeItem({
      materialListId,
      itemId,
    }));
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="w-full min-w-[52rem] space-y-2">
        <div
          className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 px-1.5 text-xs font-medium tracking-wide text-gray-500 uppercase`}
        >
          <span aria-hidden="true" />
          <span className="text-center">Qty</span>
          <span>Part</span>
          <span>Supplier</span>
          <span className="text-right">Each</span>
          <span className="text-right">Total</span>
          <span className="text-center">Sync</span>
          <span aria-label="Actions" />
        </div>
        {items.map((item) => {
          const quantity = parseFloat(item.quantity);
          const unitCost = item.unitCost ? parseFloat(item.unitCost) : 0;
          const lineTotal = item.extendedPrice
            ? parseFloat(item.extendedPrice)
            : quantity * unitCost;

          return (
            <div
              key={item.id}
              className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 rounded-lg border p-1.5`}
            >
              <div className="relative h-8 w-8 overflow-hidden rounded-md bg-gray-100">
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
              <div className="flex h-8 min-w-0 items-center justify-center self-center">
                <QuantityControls
                  itemId={item.id}
                  quantity={parseFloat(item.quantity)}
                  materialListId={materialListId}
                  pendingSync={item.pendingSync}
                  compact
                />
              </div>
              <div className="min-w-0 py-0.5">
                <div className="line-clamp-2 text-sm leading-tight font-medium break-words whitespace-normal sm:text-base">
                  {item.partDefinition?.displayName ||
                    item.descriptionSnapshot ||
                    "Unknown Part"}
                </div>
              </div>
              <div className="flex h-8 min-w-0 items-center self-center">
                <SupplierSelector
                  itemId={item.id}
                  partDefinitionId={item.partDefinition?.id ?? ""}
                  currentSupplierPartId={item.supplierPart?.id}
                  currentSupplierId={item.supplierId ?? item.supplierPart?.supplierId ?? null}
                  materialListId={materialListId}
                  suppliers={suppliers}
                  compact
                />
              </div>
              <div className="flex h-8 min-w-0 items-center justify-end self-center overflow-hidden text-sm whitespace-nowrap text-gray-700">
                <span className="shrink-0">{unitCost > 0 ? `$${unitCost.toFixed(2)}` : "—"}</span>
              </div>
              <div className="flex h-8 min-w-0 items-center justify-end self-center overflow-hidden text-sm font-semibold whitespace-nowrap text-gray-900">
                <span className="shrink-0">${lineTotal.toFixed(2)}</span>
              </div>
              <div className="flex h-8 items-center justify-center self-center">
                <MaterialListSyncIndicator
                  status={resolveReplicacheSyncStatus(
                    item.pendingSync,
                    isReplicacheSyncing,
                  )}
                />
              </div>
              <div className="flex h-8 items-center justify-center self-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemove(item.id)}
                  className="h-8 w-8 p-0"
                  aria-label="Remove item"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
