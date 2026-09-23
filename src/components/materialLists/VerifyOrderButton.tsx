"use client";

import { format } from "date-fns";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

export function MaterialListOrderPickerDialog({
  materialList,
  open,
  onOpenChange,
  onVerifyOrder,
}: {
  materialList: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerifyOrder: (orderId: string) => void;
}) {
  const isBrowserOnline = useOnlineStatus();
  const {
    data: orders,
    isLoading,
    isError,
    refetch,
  } = api.materialList.getOrdersForMaterialList.useQuery(
    { materialListId: materialList?.id ?? "" },
    { enabled: open && isBrowserOnline && !!materialList?.id },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Verify Order</DialogTitle>
          <DialogDescription>Choose a sent order to verify</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {!isBrowserOnline ? (
            <p className="text-muted-foreground text-sm">
              Connect to the internet to load orders for verification.
            </p>
          ) : isError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>
                Could not load orders. If this list is new, wait for it to
                finish syncing.
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : isLoading ? (
            <p className="text-muted-foreground text-sm">Loading orders...</p>
          ) : !orders || orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No sent orders found for this material list. Use Order to generate
              and send an order first.
            </p>
          ) : (
            orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onVerifyOrder(order.id);
                }}
                className="flex w-full items-center rounded-lg border p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">
                    {order.orderNumber || `Order #${order.id.slice(0, 8)}`}
                    {order.supplier?.name && (
                      <span className="text-muted-foreground ml-2">
                        - {order.supplier.name}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    Created{" "}
                    {format(
                      new Date(order.createdAt),
                      "MMM d, yyyy 'at' h:mm a",
                    )}
                    {order.status && (
                      <span className="ml-2">({order.status})</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
