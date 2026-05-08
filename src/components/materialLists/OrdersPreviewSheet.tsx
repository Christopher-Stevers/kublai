"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";

const GENERATE_ORDER_TIMEOUT_MS = 20_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

interface OrdersPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  orderId?: string;
}

export function OrdersPreviewSheet({
  open,
  onOpenChange,
  materialListId,
  orderId: providedOrderId,
}: OrdersPreviewSheetProps) {
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(
    new Set(),
  );
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const canGenerateDocuments =
    userData?.permissions.canGenerateDocuments ?? true;
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      notes?: string | null;
      supplier: {
        id: string;
        name: string;
        contactEmail: string | null;
      } | null;
      items: Array<{
        id: string;
        quantity: string;
        descriptionSnapshot: string | null;
        supplierSkuSnapshot: string | null;
      }>;
      sentAt?: Date | null;
    }>
  >([]);
  const [orderNotes, setOrderNotes] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Load existing order if orderId is provided
  const { data: existingOrder } = api.materialList.getOrderById.useQuery(
    { orderId: providedOrderId ?? "" },
    { enabled: isOnline && open && !!providedOrderId },
  );

  // Load existing order data when available
  useEffect(() => {
    if (providedOrderId && existingOrder) {
      setOrders([
        {
          id: existingOrder.id,
          notes: existingOrder.notes ?? null,
          supplier: existingOrder.supplier,
          items: existingOrder.items,
          sentAt: existingOrder.sentAt,
        },
      ]);
      if (existingOrder.notes) {
        const notesMap = new Map<string, string>();
        notesMap.set(existingOrder.id, existingOrder.notes);
        setOrderNotes(notesMap);
      }
      if (existingOrder.sentAt) {
        setEmailSent(new Set([existingOrder.id]));
      }
    }
  }, [existingOrder, providedOrderId]);

  const generateOrders = api.materialList.generateOrders.useMutation();

  const markOrderSent = api.materialList.markOrderSent.useMutation({
    onMutate: async (variables) => {
      // Optimistically mark order as sent in local state
      setEmailSent((prev) => new Set(prev).add(variables.orderId));
    },
    onError: (err, variables) => {
      // Rollback on error
      setEmailSent((prev) => {
        const next = new Set(prev);
        next.delete(variables.orderId);
        return next;
      });
    },
    onSettled: () => {
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
  });

  // Generate orders when sheet opens (only if not viewing existing order)
  useEffect(() => {
    if (
      open &&
      materialListId &&
      !providedOrderId &&
      canGenerateDocuments &&
      orders.length === 0 &&
      !isGenerating
    ) {
      void (async () => {
        if (!isOnline) {
          setSyncError(
            "Reconnect before generating orders. Orders are generated from the online database.",
          );
          return;
        }

        setIsGenerating(true);

        try {
          await utils.materialList.getMaterialList.invalidate({
            materialListId,
          });
          const data = await withTimeout(
            generateOrders.mutateAsync({ materialListId }),
            GENERATE_ORDER_TIMEOUT_MS,
            "Order generation timed out.",
          );
          const validOrders = data.filter(
            (order): order is typeof order & { id: string } => !!order.id,
          );
          setOrders(validOrders);

          const notesMap = new Map<string, string>();
          validOrders.forEach((order) => {
            if (order.notes) {
              notesMap.set(order.id, order.notes);
            }
          });
          setOrderNotes(notesMap);
          setSyncError(null);
          void utils.materialList.getMaterialList.invalidate({
            materialListId,
          });
        } catch (error) {
          generateOrders.reset();
          setSyncError(
            error instanceof Error && /timed out/i.test(error.message)
              ? "Order generation timed out. The online database did not respond in time. Close this and try again."
              : "Order generation failed. Try again in a moment.",
          );
        } finally {
          setIsGenerating(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    materialListId,
    orders.length,
    providedOrderId,
    isGenerating,
    isOnline,
    canGenerateDocuments,
  ]);

  const toggleSupplier = (supplierId: string) => {
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  };

  const handleEmailOrder = async (
    orderId: string,
    order: (typeof orders)[0],
  ) => {
    if (!canGenerateDocuments) {
      setSyncError("Workers and beta testers cannot generate orders.");
      return;
    }

    const supplierEmail =
      (order as { supplier?: { contactEmail: string | null } | null })?.supplier
        ?.contactEmail || undefined;

    // Save notes before emailing
    const notes = orderNotes.get(orderId) || "";
    await markOrderSent.mutateAsync({
      orderId,
      sentTo: supplierEmail || "unknown@example.com",
      notes: notes.trim() || undefined,
    });

    // Refetch email content to get updated notes
    const emailContent = await utils.materialList.getOrderEmailContent.fetch({
      orderId,
    });

    if (!emailContent) return;

    const subject = encodeURIComponent(emailContent.subject);
    const body = encodeURIComponent(emailContent.body);
    const mailtoLink = supplierEmail
      ? `mailto:${supplierEmail}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;
    window.open(mailtoLink, "_blank");
  };

  if (isGenerating) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generating Orders</DialogTitle>
            <DialogDescription>
              Preparing purchase orders from the online database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                generateOrders.reset();
                setIsGenerating(false);
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {!canGenerateDocuments
                ? "Not Allowed"
                : syncError
                  ? "Sync Required"
                  : "No Orders to Send"}
            </DialogTitle>
            <DialogDescription>
              {!canGenerateDocuments
                ? "Workers and beta testers cannot generate orders."
                : syncError
                  ? syncError
                  : "No items have suppliers assigned. Please assign suppliers to items before generating orders."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {providedOrderId
              ? "View/Edit Order"
              : `Orders to Send (${orders.length})`}
          </DialogTitle>
          <DialogDescription>
            {providedOrderId
              ? "Review, update, and email the order"
              : "Review and email orders to suppliers"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!canGenerateDocuments && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Workers and beta testers cannot generate orders.
            </div>
          )}
          {orders.map((order) => {
            const isExpanded = expandedSuppliers.has(order.id);
            const isSent = emailSent.has(order.id);

            return (
              <div key={order.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleSupplier(order.id)}
                    className="flex items-center gap-2 font-semibold"
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className="h-4 w-4" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4" />
                    )}
                    <span>
                      {(order as { supplier?: { name: string } | null })
                        ?.supplier?.name || "Supplier Order"}
                    </span>
                    {isSent && (
                      <span className="text-xs text-green-600">(Sent)</span>
                    )}
                  </button>
                  <Button
                    size="sm"
                    onClick={() => handleEmailOrder(order.id, order)}
                    disabled={!canGenerateDocuments || isSent}
                  >
                    Email Order
                  </Button>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-4 pl-6">
                    <div className="space-y-2">
                      {order.items.map((item) => {
                        const qty = parseFloat(item.quantity);
                        return (
                          <div
                            key={item.id}
                            className="flex justify-between text-sm"
                          >
                            <span>
                              {item.descriptionSnapshot || "Item"} × {qty}
                              {item.supplierSkuSnapshot &&
                                ` (SKU: ${item.supplierSkuSnapshot})`}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Notes */}
                    <div className="space-y-2 border-t pt-4">
                      <label
                        htmlFor={`order-notes-${order.id}`}
                        className="text-sm font-medium"
                      >
                        Notes (optional)
                      </label>
                      <Textarea
                        id={`order-notes-${order.id}`}
                        value={orderNotes.get(order.id) || ""}
                        onChange={(e) => {
                          const newNotes = new Map(orderNotes);
                          newNotes.set(order.id, e.target.value);
                          setOrderNotes(newNotes);
                        }}
                        placeholder="Add any additional notes for this order..."
                        className="min-h-[80px]"
                        disabled={isSent}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
