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
import { Input } from "~/components/ui/input";
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

type OrderPreview = {
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
};

type EmailDraft = {
  subject: string;
  body: string;
};

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
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [orderNotes, setOrderNotes] = useState<Map<string, string>>(new Map());
  const [emailRecipients, setEmailRecipients] = useState<Map<string, string>>(
    new Map(),
  );
  const [emailDrafts, setEmailDrafts] = useState<Map<string, EmailDraft>>(
    new Map(),
  );
  const [loadingDrafts, setLoadingDrafts] = useState<Set<string>>(new Set());
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
      setEmailRecipients(
        new Map([
          [
            existingOrder.id,
            existingOrder.supplier?.contactEmail?.trim() ?? "",
          ],
        ]),
      );
      if (existingOrder.sentAt) {
        setEmailSent(new Set([existingOrder.id]));
      }
    }
  }, [existingOrder, providedOrderId]);

  const generateOrders = api.materialList.generateOrders.useMutation();
  const markOrderSent = api.materialList.markOrderSent.useMutation({
    onMutate: async (variables) => {
      setEmailSent((prev) => new Set(prev).add(variables.orderId));
    },
    onError: (err, variables) => {
      setEmailSent((prev) => {
        const next = new Set(prev);
        next.delete(variables.orderId);
        return next;
      });
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
          setEmailRecipients(
            new Map(
              validOrders.map((order) => [
                order.id,
                order.supplier?.contactEmail?.trim() ?? "",
              ]),
            ),
          );
          setSyncError(null);
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

  const loadEmailDraft = async (orderId: string) => {
    if (emailDrafts.has(orderId) || loadingDrafts.has(orderId)) return;

    setLoadingDrafts((prev) => new Set(prev).add(orderId));
    try {
      const draft = await utils.materialList.getOrderEmailContent.fetch({
        orderId,
      });
      setEmailDrafts((prev) => {
        const next = new Map(prev);
        next.set(orderId, draft);
        return next;
      });
      setSyncError(null);
    } catch (error) {
      setSyncError("Could not load the order email draft.");
    } finally {
      setLoadingDrafts((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const toggleSupplier = (supplierId: string) => {
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
        void loadEmailDraft(supplierId);
      }
      return next;
    });
  };

  const handleEmailOrder = async (
    orderId: string,
    order: OrderPreview,
  ) => {
    if (!canGenerateDocuments) {
      setSyncError("Standard accounts cannot generate orders.");
      return;
    }

    const draft = emailDrafts.get(orderId);
    if (!draft) {
      await loadEmailDraft(orderId);
      return;
    }

    const recipient =
      emailRecipients.get(orderId)?.trim() ||
      order.supplier?.contactEmail?.trim() ||
      "";
    if (!recipient || !recipient.includes("@")) {
      setSyncError("Enter a supplier email before sending this order.");
      return;
    }

    const notes = orderNotes.get(orderId) || "";
    await markOrderSent.mutateAsync({
      orderId,
      sentTo: recipient,
      notes: notes.trim() || undefined,
    });

    const subject = encodeURIComponent(draft.subject);
    const body = encodeURIComponent(draft.body);
    window.open(`mailto:${recipient}?subject=${subject}&body=${body}`, "_blank");
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
                ? "Standard accounts cannot generate orders."
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
              Standard accounts cannot generate orders.
            </div>
          )}
          {orders.map((order) => {
            const isExpanded = expandedSuppliers.has(order.id);
            const isSent = emailSent.has(order.id);
            const draft = emailDrafts.get(order.id);
            const isDraftLoading = loadingDrafts.has(order.id);
            const recipient = emailRecipients.get(order.id) ?? "";

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
                    disabled={
                      !canGenerateDocuments ||
                      isSent ||
                      isDraftLoading ||
                      markOrderSent.isPending
                    }
                  >
                    {markOrderSent.isPending ? "Opening..." : "Email Order"}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-4 pl-6">
                    {isDraftLoading || !draft ? (
                      <p className="text-muted-foreground text-sm">
                        Loading email draft...
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label
                            htmlFor={`order-recipient-${order.id}`}
                            className="text-sm font-medium"
                          >
                            To
                          </label>
                          <Input
                            id={`order-recipient-${order.id}`}
                            type="email"
                            value={recipient}
                            onChange={(event) => {
                              const next = new Map(emailRecipients);
                              next.set(order.id, event.target.value);
                              setEmailRecipients(next);
                            }}
                            placeholder="supplier@example.com"
                            disabled={isSent}
                          />
                        </div>

                        <div className="space-y-2">
                          <label
                            htmlFor={`order-subject-${order.id}`}
                            className="text-sm font-medium"
                          >
                            Subject
                          </label>
                          <Input
                            id={`order-subject-${order.id}`}
                            value={draft.subject}
                            onChange={(event) => {
                              const next = new Map(emailDrafts);
                              next.set(order.id, {
                                ...draft,
                                subject: event.target.value,
                              });
                              setEmailDrafts(next);
                            }}
                            disabled={isSent}
                          />
                        </div>

                        <div className="space-y-2">
                          <label
                            htmlFor={`order-body-${order.id}`}
                            className="text-sm font-medium"
                          >
                            Email Draft
                          </label>
                          <Textarea
                            id={`order-body-${order.id}`}
                            value={draft.body}
                            onChange={(event) => {
                              const next = new Map(emailDrafts);
                              next.set(order.id, {
                                ...draft,
                                body: event.target.value,
                              });
                              setEmailDrafts(next);
                            }}
                            className="min-h-[20rem] font-mono text-sm"
                            disabled={isSent}
                          />
                        </div>

                        <div className="space-y-2 border-t pt-4">
                          <label
                            htmlFor={`order-notes-${order.id}`}
                            className="text-sm font-medium"
                          >
                            Internal Notes
                          </label>
                          <Textarea
                            id={`order-notes-${order.id}`}
                            value={orderNotes.get(order.id) || ""}
                            onChange={(e) => {
                              const newNotes = new Map(orderNotes);
                              newNotes.set(order.id, e.target.value);
                              setOrderNotes(newNotes);
                            }}
                            placeholder="Notes saved on the order record"
                            className="min-h-[80px]"
                            disabled={isSent}
                          />
                        </div>
                      </>
                    )}
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
