"use client";

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
import { format } from "date-fns";

interface ExistingQuotesOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  type: "quote" | "order";
  onGenerateNew: () => void;
  onOpenExisting?: (id: string) => void;
}

export function ExistingQuotesOrdersDialog({
  open,
  onOpenChange,
  materialListId,
  type,
  onGenerateNew,
  onOpenExisting,
}: ExistingQuotesOrdersDialogProps) {
  const { data: quotes, isLoading: quotesLoading } =
    api.materialList.getQuotesForMaterialList.useQuery(
      { materialListId },
      { enabled: open && type === "quote" && !!materialListId },
    );

  const { data: orders, isLoading: ordersLoading } =
    api.materialList.getOrdersForMaterialList.useQuery(
      { materialListId },
      { enabled: open && type === "order" && !!materialListId },
    );

  const isLoading = type === "quote" ? quotesLoading : ordersLoading;
  const items = type === "quote" ? quotes : orders;

  const handleGenerateNew = () => {
    onOpenChange(false);
    onGenerateNew();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {type === "quote" ? "Existing Quotes" : "Existing Orders"}
          </DialogTitle>
          <DialogDescription>
            {type === "quote"
              ? "Review existing quotes for this material list or generate a new one."
              : "Review existing orders for this material list or generate new ones."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !items || items.length === 0 ? (
            <p className="text-muted-foreground">
              No existing {type === "quote" ? "quotes" : "orders"} found.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    onOpenExisting
                      ? "cursor-pointer transition-colors hover:bg-gray-50"
                      : ""
                  }`}
                  onClick={() => {
                    if (onOpenExisting) {
                      onOpenChange(false);
                      onOpenExisting(item.id);
                    }
                  }}
                >
                  <div className="flex flex-col flex-1">
                    <div className="font-medium">
                      {type === "quote" ? (
                        <>
                          Quote{" "}
                          {(item as { quoteNumber?: string | null })
                            ?.quoteNumber || `#${item.id.slice(0, 8)}`}
                          {(item as { total?: string | null })?.total && (
                            <span className="ml-2 text-muted-foreground">
                              - ${parseFloat(
                                (item as { total: string }).total,
                              ).toFixed(2)}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          Order{" "}
                          {(item as { orderNumber?: string | null })
                            ?.orderNumber || `#${item.id.slice(0, 8)}`}
                          {(item as { supplier?: { name: string } | null })
                            ?.supplier?.name && (
                            <span className="ml-2 text-muted-foreground">
                              -{" "}
                              {
                                (item as { supplier: { name: string } })
                                  .supplier.name
                              }
                            </span>
                          )}
                          {(item as { status?: string })?.status && (
                            <span
                              className={`ml-2 text-xs ${
                                (item as { status: string }).status === "sent"
                                  ? "text-green-600"
                                  : "text-gray-600"
                              }`}
                            >
                              ({(item as { status: string }).status})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Created:{" "}
                      {format(
                        new Date(item.createdAt),
                        "MMM d, yyyy 'at' h:mm a",
                      )}
                    </div>
                  </div>
                  {onOpenExisting && (
                    <div className="ml-4 text-sm text-blue-600">
                      Open →
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerateNew}>
            Generate New {type === "quote" ? "Quote" : "Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
