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
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

interface OrdersPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
}

export function OrdersPreviewSheet({
  open,
  onOpenChange,
  materialListId,
}: OrdersPreviewSheetProps) {
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(
    new Set(),
  );
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());

  const utils = api.useUtils();
  const [orders, setOrders] = useState<
    Array<{
      id: string;
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
  const [isGenerating, setIsGenerating] = useState(false);

  const generateOrders = api.materialList.generateOrders.useMutation({
    onSuccess: (data) => {
      // Filter out any orders without an id (shouldn't happen, but TypeScript safety)
      setOrders(
        data.filter(
          (order): order is typeof order & { id: string } => !!order.id,
        ),
      );
      setIsGenerating(false);
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
    onError: () => {
      setIsGenerating(false);
    },
  });

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

  // Generate orders when sheet opens
  useEffect(() => {
    if (open && materialListId && orders.length === 0 && !isGenerating) {
      setIsGenerating(true);
      generateOrders.mutate({ materialListId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, materialListId]);

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
    // Get email content
    const emailContent = await utils.materialList.getOrderEmailContent.fetch({
      orderId,
    });

    if (!emailContent) return;

    const supplierEmail =
      (order as { supplier?: { contactEmail: string | null } | null })?.supplier
        ?.contactEmail || undefined;

    const subject = encodeURIComponent(emailContent.subject);
    const body = encodeURIComponent(emailContent.body);
    const mailtoLink = supplierEmail
      ? `mailto:${supplierEmail}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;
    window.open(mailtoLink, "_blank");

    // Mark as sent
    markOrderSent.mutate({
      orderId,
      sentTo: supplierEmail || "unknown@example.com",
    });
  };

  if (isGenerating) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <p className="text-muted-foreground">Generating orders...</p>
        </DialogContent>
      </Dialog>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Orders to Send</DialogTitle>
            <DialogDescription>
              No items have suppliers assigned. Please assign suppliers to items
              before generating orders.
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
          <DialogTitle>Orders to Send ({orders.length})</DialogTitle>
          <DialogDescription>
            Review and email orders to suppliers
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
                    disabled={isSent}
                  >
                    Email Order
                  </Button>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-2 pl-6">
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
