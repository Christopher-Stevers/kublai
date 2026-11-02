"use client";
import { MaterialFocusSection } from "./MaterialFocusSection";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { supplierLabel } from "~/lib/supplier-label";
import { PackingSlips } from "~/components/materialLists/PackingSlips";
import { SlipBadge, SlipPartSheet, SlipVerifyBar } from "~/components/materialLists/SlipOnList";
import { useSlipDrafts } from "~/components/materialLists/use-slip-draft";
import { ScanSlipButton } from "~/components/materialLists/ScanSlipButton";
import { notify } from "~/components/ui/app-dialogs";
import { useJobPricing, jobPriceStatus } from "~/hooks/use-job-pricing";
import { listedPartsFirst } from "~/lib/job-pricing";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { usePageViewState } from "~/hooks/use-page-view-state";
import { matchesMaterialOrderLine } from "~/lib/material-order-line";
import { MaterialListSheet as MaterialListTableView } from "~/components/materialLists/MaterialListSheet";
import { MaterialListActions, MATERIAL_LIST_ACTION_CLASS, OrderReceiveActions, MaterialTotalLabel } from "~/components/materialLists/MaterialListActions";
import { useOrderInView } from "~/components/materialLists/use-order-in-view";
import { MaterialSectionHeading, materialSections, materialSectionTotal } from "~/components/materialLists/MaterialSectionHeading";
import { AddPartDialog, QuotePreviewSheet, OrdersPreviewSheet, ExistingQuotesOrdersDialog } from "~/components/app/DeferredFeatures";

import { useMaterialListSort } from "~/hooks/use-material-list-sort";


import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";
import { Button, LargeButton } from "~/components/ui/button";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { JobInfoModal } from "~/components/materialLists/JobInfoModal";
import { MaterialListNameModal } from "~/components/materialLists/MaterialListNameModal";
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
  PencilIcon,
  PlusIcon,
  WifiOffIcon,
} from "lucide-react";
import { ViewToggle } from "~/components/ui/view-toggle";
import {
  useReplicacheMaterialList,
  type ReplicacheMaterialListItem,
} from "~/hooks/use-replicache-material-list";
import { useReplicacheJob } from "~/hooks/use-replicache-jobs";
import { useReplicacheSuppliers } from "~/hooks/use-replicache-suppliers";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { markUserAction } from "~/lib/performance-marks";

// A card gets the same object for as long as its part is unchanged, so only
// changed parts redraw.
const cardItems = new WeakMap<ReplicacheMaterialListItem, ComponentProps<typeof MaterialListItem>["item"]>();
function cardItem(item: ReplicacheMaterialListItem) {
  let card = cardItems.get(item);
  if (!card) {
    card = {
      jobPriceStatus: item.jobPriceStatus,
      id: item.id,
      sentOrderItemId: item.sentOrderItemId,
      sentOrder: item.sentOrder,
      quantity: item.quantity,
      unitCost: item.unitCost,
      extendedPrice: item.extendedPrice,
      descriptionSnapshot: item.descriptionSnapshot,
      roomId: item.roomId,
      roomName: item.roomName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      pendingSync: item.pendingSync,
      partDefinition: item.partDefinition ?? null,
      selectedSupplierId: item.supplierId,
      supplierPart: item.supplierPart ?? null,
      addedBy: item.addedBy ?? null,
    };
    cardItems.set(item, card);
  }
  return card;
}

type VerifyStateHandler = NonNullable<ComponentProps<typeof MaterialListItem>["onVerifyStateChange"]>;

/** A material list: its parts, ordering, and receiving what was ordered.
 * The Jobs shows it in place, where its own back button leads out. */
export function MaterialListScreen({
  id,
  embedded = false,
}: {
  id: string;
  embedded?: boolean;
}) {
  const sandbox = useTutorialSandbox();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const verifyOrderId = embedded ? null : searchParams.get("orderId");
  const router = useRouter();
  const [showJobInfoModal, setShowJobInfoModal] = usePageViewState(`list:${id}:showJobInfoModal`, false);
  const [showQuoteSheet, setShowQuoteSheet] = usePageViewState(`list:${id}:showQuoteSheet`, false);
  const [showOrdersSheet, setShowOrdersSheet] = usePageViewState(`list:${id}:showOrdersSheet`, false);
  const [showAddPartDialog, setShowAddPartDialog] = usePageViewState("list:addParts", false);
  const [showMaterialListNameModal, setShowMaterialListNameModal] =
    useState(false);
  const [showExistingQuotesDialog, setShowExistingQuotesDialog] =
    useState(false);
  const [showVerifyNotesDialog, setShowVerifyNotesDialog] = useState(false);
  const [verifyOrderNotes, setVerifyOrderNotes] = useState("");
  // Notes opened from the material list are for the order on screen.
  const [listNotesOrderId, setListNotesOrderId] = useState<string | null>(null);
  const notesOrderId = verifyOrderId ?? listNotesOrderId;
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | undefined>();
  const [viewMode, setViewMode] = usePageViewState<"grid" | "table">(`list:${id}:viewMode`, "grid");
  const isBrowserOnline = useOnlineStatus();
  // Each card keeps one receiving handler that calls the latest one, so
  // cards don't redraw just because the screen did.
  const verifyHandlers = useRef(new Map<string, { latest: VerifyStateHandler; stable: VerifyStateHandler }>());
  const verifyHandler = (itemId: string, latest: VerifyStateHandler) => {
    const known = verifyHandlers.current.get(itemId);
    if (known) {
      known.latest = latest;
      return known.stable;
    }
    const entry: { latest: VerifyStateHandler; stable: VerifyStateHandler } = {
      latest,
      stable: (state) => entry.latest(state),
    };
    verifyHandlers.current.set(itemId, entry);
    return entry.stable;
  };

  const { materialList: mlHeader, items: unsortedItems, isLoading } =
    useReplicacheMaterialList(id);
  const { data: verifyOrder, isLoading: isLoadingVerifyOrder } =
    api.materialList.getOrderById.useQuery(
      { orderId: verifyOrderId ?? "" },
      { enabled: isBrowserOnline && !!verifyOrderId },
    );
  const { data: notesOrder, isLoading: isLoadingNotesOrder } =
    api.materialList.getOrderById.useQuery(
      { orderId: notesOrderId ?? "" },
      { enabled: isBrowserOnline && !!notesOrderId },
    );
  useHeaderBackOverride(!embedded && mlHeader?.jobId ? () => {
    router.replace(`/jobs/${encodeURIComponent(mlHeader.jobId)}/material-lists`);
  } : null, { priority: -50 });
  const suppliers = useReplicacheSuppliers();
  const { sortedItems: ordinaryItems } = useMaterialListSort(unsortedItems, suppliers);
  const {data:jobPriceBook}=useJobPricing(mlHeader?.kind === "tools" ? null : mlHeader?.jobId);
  // Parts keep their objects while the price book stays the same, so the
  // cards of unchanged parts don't redraw.
  const pricedParts=useMemo(()=>new WeakMap<(typeof ordinaryItems)[number],(typeof ordinaryItems)[number]>(),[jobPriceBook]);
  const items=useMemo(()=>{
    const annotated=jobPriceBook ? ordinaryItems.map(item=>{
      let priced=pricedParts.get(item);
      if(!priced){
        priced={...item,jobPriceStatus:jobPriceStatus(jobPriceBook,item.partDefinition?.id,item.supplierId??item.supplierPart?.supplierId,item.supplierPart?.id)};
        pricedParts.set(item,priced);
      }
      return priced;
    }) : ordinaryItems;
    return jobPriceBook?.policy?.active ? listedPartsFirst(annotated,item=>item.jobPriceStatus!=="unlisted") : annotated;
  },[ordinaryItems,jobPriceBook]);
  const jobDetail = useReplicacheJob(mlHeader?.jobId ?? "");
  const jobName = jobDetail?.name;
  // Tool request lists reuse this screen; they send to the tool room.
  const isToolRequest = mlHeader?.kind === "tools";
  const hasToolItems = items.some(item => !!item.partDefinition?.assetTracking);

  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isBrowserOnline,
  });
  const utils = api.useUtils();
  const updateOrderNotes = api.materialList.updateOrderNotes.useMutation({
    onSuccess: (updatedOrder, { orderId }) => {
      setVerifyOrderNotes(updatedOrder.notes ?? "");
      void utils.materialList.getOrderById.invalidate({ orderId });
      setShowVerifyNotesDialog(false);
    },
  });
  const updateOrderItemVerification =
    api.materialList.updateOrderItemVerification.useMutation({
      onError: (error) => notify(error.message, "error"),
    });
  const markAllReceived = api.materialList.markAllOrderItemsReceived.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.materialList.getOrderById.invalidate(),
        utils.materialList.listOrders.invalidate(),
        utils.materialList.getOrdersForMaterialList.invalidate(),
      ]);
    },
  });
  const canReceive = !sandbox && !!userData?.permissions.can["orders.receive"];
  // Read packing slips fill in the parts here; each is confirmed in one go.
  const slipDrafts = useSlipDrafts({
    jobId: mlHeader?.jobId,
    materialListId: id,
    orderId: verifyOrderId,
    enabled: isBrowserOnline && canReceive && (!verifyOrderId || verifyOrder?.materialListId === id),
    onConfirmed: async (problems) => {
      await Promise.all(Object.entries(problems).map(([orderItemId, total]) =>
        updateOrderItemVerification.mutateAsync({ orderItemId, receivedQuantity: total, verificationStatus: "problem" })));
      await utils.materialList.invalidate();
    },
  });
  const [slipPart, setSlipPart] = useState<{ orderId: string; id: string; name: string } | null>(null);
  const slipPartDraft = slipDrafts.drafts.find((draft) => draft.orderId === slipPart?.orderId);
  const canQuote = userData?.permissions.can["quotes.create"] ?? false;
  const canOrder =
    isToolRequest || hasToolItems || (userData?.permissions.can["orders.send"] ?? false);
  const hasPendingSync =
    (mlHeader?.pendingSync ?? false) || items.some((i) => i.pendingSync);
  const verifySupplierId = verifyOrder?.supplier?.id ?? null;
  const visibleItems = useMemo(() => verifyOrderId
    ? items.filter((item) => verifyOrder?.items.some((orderItem) =>
        matchesMaterialOrderLine(item, orderItem, verifySupplierId)))
    : items, [items, verifyOrderId, verifyOrder, verifySupplierId]);
  // Ordered parts are received right on the list, as on an order's verify view.
  const receivableOrder = (item: Pick<(typeof items)[number], "sentOrderItemId" | "sentOrder">) =>
    !verifyOrderId && item.sentOrderItemId && item.sentOrder && item.sentOrder.status !== "cancelled" ? item.sentOrder : null;
  const hasReceivableOrder = items.some((item) => receivableOrder(item));

  useEffect(() => {
    if (!notesOrderId) {
      setVerifyOrderNotes("");
      return;
    }

    if (notesOrder) {
      setVerifyOrderNotes(notesOrder.notes ?? "");
    }
  }, [notesOrderId, notesOrder]);

  // Each order's parts sit under their own heading; once one scrolls up its
  // receiving bar takes the place of the list's own actions.
  const sections = useMemo(() => verifyOrderId
    ? [{ key: "all", label: null, ordered: false, orderId: undefined, detail: undefined, href: undefined, hasReceivedItems: verifyOrder?.items.some((item) => Number(item.receivedQuantity) > 0) ?? false, items: visibleItems }]
    : materialSections(visibleItems, id), [verifyOrderId, verifyOrder, visibleItems, id]);
  const listRef = useRef<HTMLDivElement>(null);
  const focusedSectionKey = useOrderInView(
    listRef,
    [isLoading, !!mlHeader, viewMode, ...sections.map((section) => section.key)].join("|"),
    !verifyOrderId,
    "data-material-section",
  );
  const focusedSection = sections.find(section => section.key === focusedSectionKey) ?? sections[0];
  const orderInView = canReceive ? focusedSection?.orderId ?? null : null;
  const footerMaterialTotal = materialSectionTotal(focusedSection?.items ?? []);
  // The last order shown stays in the bar while it slides away.
  const [lastOrderInView, setLastOrderInView] = useState<string | null>(null);
  if (orderInView && orderInView !== lastOrderInView) setLastOrderInView(orderInView);
  const barOrderId = orderInView ?? lastOrderInView;
  const orderBarSection = sections.find((section) => section.orderId && section.orderId === barOrderId)
    ?? sections.find((section) => section.orderId);
  const orderBarId = orderBarSection?.orderId;

  const openAddPartDialog = () => {
    markUserAction("add-part-open", { materialListId: id });
    setShowAddPartDialog(true);
  };

  const generationBlockReason = sandbox ? "Quotes and orders are not sent during the tutorial." : !isBrowserOnline
    ? "Reconnect before generating quotes or orders."
    : !canQuote && !canOrder
      ? "You don't have permission to request quotes or send orders."
      : isLoading
        ? "Loading material list data..."
        : hasPendingSync
          ? "Finish syncing this material list before generating a quote or order."
          : null;
  const canGenerateQuoteOrOrder = !generationBlockReason;

  const handleGenerateQuote = () => {
    if (!canGenerateQuoteOrOrder || !canQuote) return;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowExistingQuotesDialog(true);
  };

  const handleGenerateOrder = () => {
    if (!canGenerateQuoteOrOrder || !canOrder) return;
    if (!jobName) {
      setShowJobInfoModal(true);
      return;
    }
    setShowOrdersSheet(true);
  };

  const handleGenerateNewQuote = () => {
    setSelectedQuoteId(undefined);
    setShowQuoteSheet(true);
  };

  const handleOpenExistingQuote = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setShowQuoteSheet(true);
  };

  if (isLoading && !mlHeader) {
    return (
      <div className="flex h-[var(--app-content-height)] flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto mb-6 max-w-6xl">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="h-5 w-44 rounded skeleton-shimmer" />
                <div className="h-4 w-28 rounded skeleton-shimmer" />
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="h-6 w-24 rounded-full skeleton-shimmer" />
                <div className="h-8 w-20 rounded-lg skeleton-shimmer" />
              </div>
            </div>
          </div>
          <div className="mx-auto max-w-6xl space-y-2">
            <div className="h-32 rounded-2xl skeleton-shimmer" />
            <div className="h-32 rounded-2xl skeleton-shimmer" />
            <div className="h-32 rounded-2xl skeleton-shimmer" />
          </div>
        </div>
        <div className="shrink-0 border-t bg-card px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-6xl space-y-2">
            <div className="h-5 w-36 rounded skeleton-shimmer" />
            <div className="grid grid-cols-3 gap-1.5">
              <div className="h-9 rounded skeleton-shimmer" />
              <div className="h-9 rounded skeleton-shimmer" />
              <div className="h-9 rounded skeleton-shimmer" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!mlHeader) {
    return (
      <div className="flex h-[var(--app-content-height)] items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Material list not found</p>
          <Button onClick={() => router.push("/jobs")}>
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-landscape-scope className="flex h-[var(--app-content-height)] flex-col">
      {/* Title and view controls scroll with the parts, like the lists page. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6" data-material-list-heading>
            {!isBrowserOnline && (
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                  <WifiOffIcon className="h-4 w-4" />
                  Offline mode
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-h-10 min-w-0 items-center gap-2">
                  <h1 data-tutorial="material-list" className="min-w-0 text-lg leading-tight font-bold break-words text-foreground sm:text-xl">
                    {mlHeader.name || (isToolRequest ? "Tool Request" : "Material List")}
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
                {!verifyOrderId && (
                  <ViewToggle view={viewMode} onViewChange={setViewMode} showOnMobile />
                )}
              </div>
            </div>
          </div>
          {verifyOrderId && (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
              <span className="font-semibold">Verify Order</span>
              {verifyOrder ? (
                <span>
                  {" "}
                  {verifyOrder.orderNumber || `#${verifyOrder.id.slice(0, 8)}`}
                  {verifyOrder.supplier?.name
                    ? ` - ${supplierLabel(verifyOrder.supplier.name, verifyOrder.supplier.priceBookName)}`
                    : ""}
                </span>
              ) : isLoadingVerifyOrder ? (
                <span> Loading order...</span>
              ) : (
                <span> Order unavailable</span>
              )}
            </div>
          )}
          {mlHeader?.jobId && slipDrafts.drafts.length > 0 && (
            // One pinned stack for every order's slip, capped so the parts
            // underneath always stay reachable.
            <div className="sticky top-0 z-30 mb-3 max-h-[45dvh] space-y-2 overflow-y-auto overscroll-contain rounded-xl">
              {slipDrafts.drafts.map((draft) => (
                <SlipVerifyBar key={draft.orderId} draft={draft} jobId={mlHeader.jobId!} showOrder={!verifyOrderId} />
              ))}
            </div>
          )}
          {visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">
                {verifyOrderId && isLoadingVerifyOrder
                  ? "Loading order items..."
                  : verifyOrderId
                  ? "No parts from this order are in the material list."
                  : isToolRequest
                  ? "No tools requested yet"
                  : "No parts added"}
              </p>
              {!verifyOrderId && (
                <LargeButton onClick={openAddPartDialog}>
                  <PlusIcon className="mr-2 h-4 w-4" />
                  {isToolRequest ? "Add Tools" : "Add Part Now"}
                </LargeButton>
              )}
            </div>
          ) : (
            <>
              {/* Grid View */}
              {(verifyOrderId || viewMode === "grid") && (
                <div data-tutorial="material-items" className="space-y-4">
                  {sections.map((section) => (
                  <MaterialFocusSection focused={!verifyOrderId && section.key === focusedSection?.key} key={section.key} aria-label={section.label ? `${section.label} parts` : undefined} data-order-id={section.orderId} className="space-y-3">
                    {section.label && <MaterialSectionHeading label={section.label} detail={section.detail} href={section.href} count={section.items.length} orderId={section.orderId} sectionKey={section.key} />}
                    <div className="grid items-stretch grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
                      {section.items.map((item) => {
                        const verifyOrderItem = verifyOrder?.items.find((orderItem) =>
                          matchesMaterialOrderLine(item, orderItem, verifySupplierId));
                        const listOrder = receivableOrder(item);
                        const orderLine = verifyOrderItem
                          ? { id: verifyOrderItem.id, quantity: verifyOrderItem.quantity, received: verifyOrderItem.receivedQuantity, status: verifyOrderItem.verificationStatus }
                          : listOrder
                            ? { id: item.sentOrderItemId!, quantity: listOrder.quantity, received: listOrder.receivedQuantity, status: listOrder.verificationStatus }
                            : null;
                        // While a read slip is being checked, changes stay on the slip until it is confirmed.
                        const slipFound = slipDrafts.find(orderLine?.id);
                        const slipEntry = slipFound?.entry ?? null;
                        const partName = [item.partDefinition?.displayName, item.descriptionSnapshot].find(Boolean) ?? "Part";
    
                        return (
                          <MaterialListItem
                            key={item.id}
                            item={cardItem(item)}
                            materialListId={id}
                            suppliers={suppliers}
                            verifyMode={!!verifyOrderId || !!listOrder}
                            orderHasReceipts={section.hasReceivedItems}
                            verifyReadOnly={!!listOrder && (!canReceive || !isBrowserOnline)}
                            isToolRequest={isToolRequest || !!item.partDefinition?.assetTracking}
                            verifyOrderedQuantity={orderLine?.quantity}
                            verifyInitialReceivedQuantity={
                              slipEntry ? slipEntry.total : orderLine?.received
                            }
                            verifyInitialStatus={
                              slipEntry
                                ? slipEntry.problem || slipEntry.item.verificationStatus === "problem" ? "problem" : undefined
                                : orderLine?.status
                            }
                            verifyBadge={slipFound && slipEntry ? (
                              <SlipBadge entry={slipEntry} onOpen={() => setSlipPart({ orderId: slipFound.draft.orderId, id: slipEntry.item.id, name: partName })} />
                            ) : undefined}
                            onVerifyStateChange={
                              orderLine
                                ? verifyHandler(item.id, (state) => {
                                    if (slipFound && slipEntry) {
                                      // The card reports from inside its own state update.
                                      queueMicrotask(() => slipFound.draft.setTotal(slipEntry.item.id, state.receivedQuantity, state.verificationStatus === "problem"));
                                      return;
                                    }
                                    updateOrderItemVerification.mutate({
                                      orderItemId: orderLine.id,
                                      receivedQuantity: state.receivedQuantity,
                                      verificationStatus: state.verificationStatus,
                                    });
                                  })
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  </MaterialFocusSection>
                  ))}
                </div>
              )}
              {/* Table View */}
              {!verifyOrderId && viewMode === "table" && (
                <MaterialListTableView
                  focusedSectionKey={focusedSection?.key}
                  items={visibleItems}
                  materialListId={id}
                  suppliers={suppliers}
                  isToolRequest={isToolRequest}
                  receiveFor={(item) => {
                    const listOrder = receivableOrder(item);
                    if (!listOrder || !item.sentOrderItemId) return null;
                    const orderItemId = item.sentOrderItemId;
                    const slipFound = slipDrafts.find(orderItemId);
                    const slipEntry = slipFound?.entry ?? null;
                    const partName = [item.partDefinition?.displayName, item.descriptionSnapshot].find(Boolean) ?? "Part";
                    return {
                      ordered: listOrder.quantity,
                      received: slipEntry ? slipEntry.total : listOrder.receivedQuantity,
                      status: slipEntry
                        ? slipEntry.problem || slipEntry.item.verificationStatus === "problem" ? "problem" : undefined
                        : listOrder.verificationStatus,
                      unit: item.partDefinition?.bulkUnit ?? item.uom?.code,
                      readOnly: !canReceive || !isBrowserOnline,
                      badge: slipFound && slipEntry ? (
                        <SlipBadge entry={slipEntry} onOpen={() => setSlipPart({ orderId: slipFound.draft.orderId, id: slipEntry.item.id, name: partName })} />
                      ) : undefined,
                      onChange: (state) => {
                        // While a read slip is being checked, changes stay on the slip until it is confirmed.
                        if (slipFound && slipEntry) {
                          slipFound.draft.setTotal(slipEntry.item.id, state.receivedQuantity, state.verificationStatus === "problem");
                          return;
                        }
                        updateOrderItemVerification.mutate({
                          orderItemId,
                          receivedQuantity: state.receivedQuantity,
                          verificationStatus: state.verificationStatus,
                        });
                      },
                    };
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer - Always Visible */}
      <div className="shrink-0 border-t bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <MaterialListActions total={footerMaterialTotal}
          totalOrderLabel={verifyOrderId ? `Receiving ${verifyOrder?.orderNumber ?? "Order"}` : focusedSection?.ordered ? focusedSection.label : undefined} canGenerate={canGenerateQuoteOrOrder} blockedReason={generationBlockReason} canQuote={canQuote} canOrder={canOrder}
          canAdd={!!sandbox || !!userData?.permissions.can["lists.edit"]}
          orderLabel={isToolRequest || (!userData?.permissions.can["orders.send"] && hasToolItems) ? "Request tools" : "Order"}
          onQuote={handleGenerateQuote} onOrder={handleGenerateOrder} onAdd={openAddPartDialog}
          onNotes={verifyOrderId ? () => setShowVerifyNotesDialog(true) : undefined}
          packingSlips={canReceive && mlHeader.jobId && (verifyOrderId ? verifyOrder?.materialListId === id : hasReceivableOrder) ? (
            <ScanSlipButton jobId={mlHeader.jobId} compact className={MATERIAL_LIST_ACTION_CLASS} />
          ) : undefined}
          onMarkAllReceived={verifyOrderId && userData?.permissions.can["orders.receive"] ? () => markAllReceived.mutate({ orderId: verifyOrderId }) : undefined}
          onMarkNoneReceived={verifyOrderId && userData?.permissions.can["orders.receive"] ? () => markAllReceived.mutate({ orderId: verifyOrderId, allReceived: false }) : undefined}
          receivingAll={markAllReceived.isPending}
          receiveDisabled={!verifyOrder?.items.length || updateOrderItemVerification.isPending}
          orderActive={!!orderInView && orderInView === orderBarId}
          orderActions={!verifyOrderId && canReceive && orderBarSection && orderBarId && mlHeader.jobId ? (
            <OrderReceiveActions
              label={<MaterialTotalLabel orderLabel={`Receiving ${orderBarSection.label}`} total={materialSectionTotal(orderBarSection.items)} />}
              onNotes={() => {
                setListNotesOrderId(orderBarId);
                setShowVerifyNotesDialog(true);
              }}
              onAdd={userData?.permissions.can["lists.edit"] ? openAddPartDialog : undefined}
              packingSlips={
                <ScanSlipButton key={orderBarId} jobId={mlHeader.jobId} compact className={MATERIAL_LIST_ACTION_CLASS} />
              }
              onMarkAllReceived={() => markAllReceived.mutate({ orderId: orderBarId })}
              onMarkNoneReceived={() => markAllReceived.mutate({ orderId: orderBarId, allReceived: false })}
              receivingAll={markAllReceived.isPending}
              receiveDisabled={updateOrderItemVerification.isPending}
            />
          ) : undefined}
          isToolRequest={isToolRequest} materialListId={id} />
      </div>

      {markAllReceived.error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{markAllReceived.error.message}</p>}

      {/* Preserve existing links that open an order's saved packing slips. */}
      {verifyOrderId && verifyOrder?.materialListId === id && mlHeader.jobId && (
        <PackingSlips jobId={mlHeader.jobId} materialListId={id} orderId={verifyOrderId}
          buttonClassName="hidden" openOnMount={searchParams.get("slips") === "1"}
          onOpened={() => router.replace(`${pathname}?orderId=${encodeURIComponent(verifyOrderId)}`, { scroll: false })}
          onVerified={() => { void utils.materialList.invalidate(); }}
          onChanged={() => { void slipDrafts.reload(); }}
          onReviewOnList={slipDrafts.choose} />
      )}

      {/* Modals and Sheets */}
      {mlHeader?.jobId && slipPartDraft && (
        <SlipPartSheet draft={slipPartDraft} orderItemId={slipPart?.id ?? null} name={slipPart?.name ?? ""}
          jobId={mlHeader.jobId} onClose={() => setSlipPart(null)} />
      )}
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
            disabled={isLoadingNotesOrder && isBrowserOnline}
            onChange={(event) => setVerifyOrderNotes(event.target.value)}
            placeholder="Type order verification notes..."
            className="min-h-[10rem]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setVerifyOrderNotes(notesOrder?.notes ?? "");
                setShowVerifyNotesDialog(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!notesOrderId) return;
                updateOrderNotes.mutate({
                  orderId: notesOrderId,
                  notes: verifyOrderNotes,
                });
              }}
              disabled={
                !isBrowserOnline || !notesOrderId || updateOrderNotes.isPending
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
        initialLocationId={jobDetail?.locationId ?? undefined}
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
          onOpenChange={setShowOrdersSheet}
          materialListId={mlHeader.id}
          orderedItemIds={items.map(item => item.id)}
          isToolRequest={isToolRequest} hasToolItems={hasToolItems}
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
    </div>
  );
}
