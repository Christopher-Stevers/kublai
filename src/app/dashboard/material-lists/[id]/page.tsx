"use client";

import { use, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  CheckCircle2Icon,
  Clock3Icon,
  FileTextIcon,
  Loader2Icon,
  PlusIcon,
  ShoppingCartIcon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import { QuantityControls } from "~/components/materialLists/QuantityControls";
import { SupplierSelector } from "~/components/materialLists/SupplierSelector";
import { TrashIcon } from "lucide-react";
import {
  useOfflineMaterialList,
  type MaterialListSyncStatus,
} from "~/hooks/use-offline-material-list";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useDexieCloudSyncState } from "~/hooks/use-dexie-cloud-sync-state";
import { useMaterialListSyncInspector } from "~/hooks/use-material-list-sync-inspector";
import {
  OFFLINE_ID_MAP_CHANGED_EVENT,
  resolveOfflineId,
} from "~/lib/offline-id-map";
import Image from "next/image";
import {
  applyOfflineRemoveItem,
  enqueueOfflineMutation,
} from "~/lib/offline-material-list-mutations";
import { markUserAction } from "~/lib/performance-marks";

function MaterialListSyncBadge({
  status,
  syncInspector,
}: {
  status: MaterialListSyncStatus;
  syncInspector?: ReturnType<typeof useMaterialListSyncInspector>;
}) {
  const hasDetails =
    !!syncInspector &&
    (syncInspector.queuedForListCount > 0 || syncInspector.activeItemCount > 0);
  const style =
    status === "syncing"
      ? {
          className: "bg-blue-100 text-blue-900",
          icon: <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" />,
          label: "Syncing material list",
        }
      : status === "pending"
        ? {
            className: "bg-orange-100 text-orange-900",
            icon: <Clock3Icon className="h-3.5 w-3.5 shrink-0" />,
            label: "Pending sync",
          }
        : {
            className: "bg-emerald-100 text-emerald-900",
            icon: <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />,
            label: "Synced",
          };

  const badgeClass = `inline-flex h-6 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-full px-2.5 py-0 text-xs leading-none font-medium whitespace-nowrap ${style.className}`;

  if (!hasDetails) {
    return (
      <div className="h-6 min-w-[5.75rem] shrink-0 overflow-visible leading-none">
        <div className={badgeClass}>
          {style.icon}
          <span className="leading-none">{style.label}</span>
        </div>
      </div>
    );
  }

  return (
    <details className="relative h-6 min-w-[5.75rem] shrink-0 overflow-visible leading-none">
      <summary className={`${badgeClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {style.icon}
        <span className="leading-none">{style.label}</span>
      </summary>
      <div className="absolute top-full right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg">
        <div className="font-medium">
          Sync details: {syncInspector.queuedForListCount} queued
          {syncInspector.syncing ? " · syncing" : ""}
        </div>
        <div className="mt-1 space-y-0.5">
          <div>Total queue: {syncInspector.queuedCount}</div>
          <div>Active item badges: {syncInspector.activeItemCount}</div>
          {syncInspector.oldestQueuedAt && (
            <div>Oldest queued: {new Date(syncInspector.oldestQueuedAt).toLocaleString()}</div>
          )}
          {Object.keys(syncInspector.queuedTypes).length > 0 && (
            <div>
              Types: {Object.entries(syncInspector.queuedTypes)
                .map(([type, count]) => `${type}×${count}`)
                .join(", ")}
            </div>
          )}
          {syncInspector.lastPullCursor && (
            <div>Last pull: {new Date(syncInspector.lastPullCursor).toLocaleString()}</div>
          )}
        </div>
      </div>
    </details>
  );
}

function ItemSyncBadge({ status }: { status: MaterialListSyncStatus }) {
  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-900">
        <Loader2Icon className="h-3 w-3 animate-spin" />
        Syncing
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900">
        <Clock3Icon className="h-3 w-3" />
        Pending
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
      <CheckCircle2Icon className="h-3 w-3" />
      Synced
    </span>
  );
}

function normalizeSignatureValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return value.toString();
  return String(value);
}

function normalizeQuantity(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric)
    ? numeric.toFixed(6)
    : normalizeSignatureValue(value);
}

function nestedId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return normalizeSignatureValue(record.id);
}

function buildMaterialListOrderSignature(
  materialList: { items?: unknown[] } | null | undefined,
) {
  if (!materialList?.items) return null;

  return JSON.stringify(
    materialList.items
      .map((item) => {
        const record = item as Record<string, unknown>;
        const partDefinition = record.partDefinition as Record<
          string,
          unknown
        > | null;
        const supplierPart = record.supplierPart as Record<
          string,
          unknown
        > | null;
        const uom = record.uom as Record<string, unknown> | null;

        return {
          id: normalizeSignatureValue(record.id),
          quantity: normalizeQuantity(record.quantity),
          unitCost: normalizeSignatureValue(record.unitCost),
          extendedPrice: normalizeSignatureValue(record.extendedPrice),
          partDefinitionId: nestedId(partDefinition),
          supplierPartId: nestedId(supplierPart),
          supplierId: normalizeSignatureValue(supplierPart?.supplierId),
          uomId: nestedId(uom),
        };
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

export default function MaterialListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: paramId } = use(params);
  const pathname = usePathname();
  const id =
    pathname.match(/^\/dashboard\/material-lists\/([^/?#]+)/)?.[1] ?? paramId;
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
  const isBrowserOnline = useOnlineStatus();
  const dexieCloudSync = useDexieCloudSyncState();
  const syncInspector = useMaterialListSyncInspector(id);

  const openAddPartDialog = () => {
    markUserAction("add-part-open", { materialListId: id });
    setShowAddPartDialog(true);
  };

  const closeAddPartDialog = () => {
    setShowAddPartDialog(false);
  };

  useEffect(() => {
    if (!id.startsWith("offline-list-") || typeof window === "undefined")
      return;

    const redirectIfMapped = () => {
      const mappedId = resolveOfflineId(id);
      if (mappedId !== id)
        router.replace(`/dashboard/material-lists/${mappedId}`);
    };

    redirectIfMapped();
    window.addEventListener(OFFLINE_ID_MAP_CHANGED_EVENT, redirectIfMapped);
    return () =>
      window.removeEventListener(
        OFFLINE_ID_MAP_CHANGED_EVENT,
        redirectIfMapped,
      );
  }, [id, router]);

  const serverMaterialList = undefined;
  const isLoading = false;

  const {
    data: materialList,
    cached,
    cacheLoaded,
    isOfflineFallback,
    isOnline,
    syncStatus,
    itemSyncStatuses,
  } = useOfflineMaterialList(id, serverMaterialList);

  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });

  const canGenerateDocuments =
    userData?.permissions.canGenerateDocuments ?? true;

  if ((isLoading || !cacheLoaded) && !materialList) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col">
        <div className="border-b bg-white px-4 py-2 sm:px-6 sm:py-3">
          <div className="mx-auto max-w-6xl animate-pulse">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="h-5 w-44 rounded bg-gray-200" />
                <div className="h-4 w-28 rounded bg-gray-100" />
                <div className="h-3 w-36 rounded bg-gray-100" />
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

  const canonicalMaterialListId = materialList.materialList.id;
  const contributorNames = Array.from(
    new Set(
      [
        (
          materialList.materialList as unknown as {
            createdBy?: { name?: string | null; email?: string | null } | null;
          }
        )?.createdBy,
        ...materialList.items.map(
          (item) =>
            (item as unknown as {
              addedBy?: { name?: string | null; email?: string | null } | null;
            }).addedBy,
        ),
      ]
        .map((user) => user?.name?.trim() || user?.email?.trim() || null)
        .filter((name): name is string => !!name),
    ),
  );
  const hasUnsyncedItems = Array.from(itemSyncStatuses.values()).some(
    (status) => status !== "synced",
  );
  const inspectorHasPendingWork =
    syncInspector.queuedForListCount > 0 || syncInspector.activeItemCount > 0 || !!cached?.pendingSync;
  const inspectorLooksSettled =
    !syncInspector.syncing &&
    syncInspector.queuedForListCount === 0 &&
    syncInspector.activeItemCount === 0 &&
    !cached?.pendingSync;
  const visibleSyncStatus: MaterialListSyncStatus = syncInspector.syncing
    ? "syncing"
    : inspectorHasPendingWork
      ? "pending"
      : inspectorLooksSettled
        ? "synced"
        : syncStatus;
  const displayedAndServerMaterialListMatch =
    !!materialList &&
    !!serverMaterialList &&
    buildMaterialListOrderSignature(materialList) ===
      buildMaterialListOrderSignature(serverMaterialList);
  const generationBlockReason = !isOnline
    ? "Reconnect before generating quotes or orders."
    : !canGenerateDocuments
      ? "Workers and beta testers cannot generate quotes or orders."
      : isLoading || !serverMaterialList
        ? "Checking the online database before quote/order generation."
        : visibleSyncStatus !== "synced" ||
            hasUnsyncedItems ||
            cached?.pendingSync
          ? "Finish syncing this material list before generating a quote or order."
          : !displayedAndServerMaterialListMatch
            ? "Waiting for the displayed material list to match the online database."
            : null;
  const canGenerateQuoteOrOrder = !generationBlockReason;

  const handleJobInfoClick = () => {
    setShowJobInfoModal(true);
  };

  const handleGenerateQuote = () => {
    if (!canGenerateQuoteOrOrder) return;

    const jobName = (materialList?.job as { name?: string } | undefined)?.name;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowExistingQuotesDialog(true);
  };

  const handleGenerateOrder = () => {
    if (!canGenerateQuoteOrOrder) return;

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
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* Top Bar */}
      <div className="border-b bg-white px-4 py-2 sm:px-6 sm:py-3">
        <div className="mx-auto max-w-6xl">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {!isOnline && (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                <WifiOffIcon className="h-4 w-4" />
                Offline mode
              </div>
            )}
            {isOfflineFallback && (
              <div className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-900">
                Showing cached material list data
              </div>
            )}
            {dexieCloudSync.configured && (
              <div className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                Dexie Cloud: {dexieCloudSync.status}
              </div>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-col content-start items-start gap-0.5">
                <button
                  onClick={() => setShowMaterialListNameModal(true)}
                  className="text-left"
                >
                  <h1 className="cursor-pointer text-lg leading-tight font-bold text-gray-900 transition-colors hover:text-gray-700 sm:text-xl">
                    {(
                      materialList.materialList as { name?: string } | undefined
                    )?.name || "Material List"}
                  </h1>
                </button>
                <button
                  onClick={() => {
                    const jobId = (
                      materialList.job as { id?: string } | undefined
                    )?.id;
                    if (jobId) {
                      router.push(`/dashboard/jobs/${jobId}`);
                    } else {
                      handleJobInfoClick();
                    }
                  }}
                  className="text-muted-foreground h-auto text-sm leading-tight hover:text-gray-900"
                >
                  Job:{" "}
                  {(materialList.job as { name?: string } | undefined)?.name ||
                    "Not set"}
                </button>
                {contributorNames.length > 0 && (
                  <div className="text-muted-foreground flex items-start gap-1.5 text-xs leading-tight">
                    <UsersIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{contributorNames.join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-[5.75rem] shrink-0 flex-col items-end gap-1">
              <MaterialListSyncBadge
                status={visibleSyncStatus}
                syncInspector={syncInspector}
              />
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
          {materialList.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">No parts added</p>
              <LargeButton
                onClick={() => {
                  openAddPartDialog();
                }}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Add Part Now
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
                          createdAt?: string | Date | null;
                          updatedAt?: string | Date | null;
                          syncVersion?: string | null;
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
                      syncStatus={
                        itemSyncStatuses.get(String(item.id)) ?? "synced"
                      }
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
                      createdAt?: string | Date | null;
                      updatedAt?: string | Date | null;
                      syncVersion?: string | null;
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
                  itemSyncStatuses={itemSyncStatuses}
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
            <div className="flex items-baseline gap-1.5">
              <span className="text-base text-gray-600 sm:text-lg">
                Material Total
              </span>
              <span className="text-base font-bold sm:text-lg">
                ${materialList.materialTotal.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="outline"
                onClick={handleGenerateQuote}
                disabled={!canGenerateQuoteOrOrder}
                title={generationBlockReason ?? "Generate quote"}
                className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
              >
                <FileTextIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="text-center leading-tight">
                  Quote
                </span>
              </Button>
              <Button
                onClick={handleGenerateOrder}
                disabled={!canGenerateQuoteOrOrder}
                title={generationBlockReason ?? "Order"}
                className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
              >
                <ShoppingCartIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="text-center leading-tight">
                  Order
                </span>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  openAddPartDialog();
                }}
                className="h-9 min-h-9 w-full px-1.5 py-1 text-[11px] leading-tight whitespace-normal sm:h-9 sm:text-xs"
              >
                <PlusIcon className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="text-center leading-tight">Add Part</span>
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
        initialName={
          (materialList?.job as { name?: string } | undefined)?.name ??
          undefined
        }
        initialLocationId={
          (materialList?.job as { locationId?: string } | undefined)
            ?.locationId ?? undefined
        }
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
          jobName={
            (materialList?.job as { name?: string } | undefined)?.name ?? ""
          }
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
          materialListId={canonicalMaterialListId}
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
              closeAddPartDialog();
            }
          }}
          materialListId={id}
        />
      )}

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
        materialListId={canonicalMaterialListId}
        type="order"
        onGenerateNew={handleGenerateNewOrder}
        onOpenExisting={handleOpenExistingOrder}
      />
    </div>
  );
}

// Material List Table View Component
const MATERIAL_LIST_TABLE_COLUMNS =
  "grid-cols-[2rem_8rem_24rem_12rem_8.5rem_2.25rem] sm:grid-cols-[2rem_8.5rem_30rem_14rem_9rem_2.25rem]";

function MaterialListTableView({
  items,
  materialListId,
  itemSyncStatuses,
}: {
  items: Array<{
    id: string;
    quantity: string;
    unitCost: string | null;
    extendedPrice: string | null;
    descriptionSnapshot: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    syncVersion?: string | null;
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
  itemSyncStatuses: Map<string, MaterialListSyncStatus>;
}) {
  const handleRemove = async (itemId: string) => {
    await applyOfflineRemoveItem(materialListId, itemId);
    await enqueueOfflineMutation({
      type: "removeItem",
      materialListId,
      itemId,
      queuedAt: new Date().toISOString(),
    });
    return;
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="w-max space-y-2">
        <div
          className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 px-2 text-xs font-medium tracking-wide text-gray-500 uppercase sm:gap-3`}
        >
          <span aria-hidden="true" />
          <span className="text-center">Qty</span>
          <span>Part</span>
          <span>Supplier</span>
          <span className="text-right">Total</span>
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
              className={`grid ${MATERIAL_LIST_TABLE_COLUMNS} items-center gap-2 rounded-lg border p-1.5 sm:gap-3`}
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
                  currentSupplierId={(item as { selectedSupplierId?: string | null }).selectedSupplierId}
                  materialListId={materialListId}
                  compact
                />
              </div>
              <div className="flex h-8 min-w-0 items-center justify-end gap-1.5 self-center overflow-hidden text-sm font-semibold whitespace-nowrap text-gray-900">
                <span className="shrink-0">${lineTotal.toFixed(2)}</span>
                <ItemSyncBadge
                  status={itemSyncStatuses.get(String(item.id)) ?? "synced"}
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
