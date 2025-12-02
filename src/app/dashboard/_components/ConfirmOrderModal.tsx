"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Image as ImageIcon, Video } from "lucide-react";
import { getCreativeImageUrl, isImageCreative } from "~/lib/creative-utils";
import { formatDateRange } from "~/lib/date-utils";

interface Creative {
  id: string;
  fileName: string;
  fileType: string;
  filePath: string;
  userId: string;
}

interface ConfirmOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  orderDetails: {
    boardTypeName?: string;
    numberOfBoards: number;
    startDate: Date | null;
    endDate: Date | null;
    creatives: Creative[];
    totalPrice?: number; // in cents
    backfillCount?: number;
    targetUrl?: string;
    utmTag?: string;
  };
}

export function ConfirmOrderModal({
  isOpen,
  onClose,
  onConfirm,
  orderDetails,
}: ConfirmOrderModalProps) {
  const formatDate = (date: Date | null) => {
    if (!date) return "Not selected";
    return new Date(date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Order</DialogTitle>
          <DialogDescription>
            Please review your order details before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <span className="text-muted-foreground text-sm font-medium">
              Board Type:
            </span>
            <p className="text-foreground">
              {orderDetails.boardTypeName || "Not selected"}
            </p>
          </div>

          <div>
            <span className="text-muted-foreground text-sm font-medium">
              Number of Boards:
            </span>
            <p className="text-foreground">{orderDetails.numberOfBoards}</p>
          </div>

          <div>
            <span className="text-muted-foreground text-sm font-medium">
              Date Range:
            </span>
            <p className="text-foreground">
              {formatDateRange(orderDetails.startDate, orderDetails.endDate)}
            </p>
          </div>

          <div>
            <span className="text-muted-foreground text-sm font-medium">
              Creatives:
            </span>
            {orderDetails.creatives.length === 0 ? (
              <p className="text-foreground">Not selected</p>
            ) : (
              <div className="mt-2 space-y-2">
                {/* Show first creative image + count */}
                <div className="flex items-center gap-3">
                  {(() => {
                    const firstCreative = orderDetails.creatives[0];
                    const imageUrl = getCreativeImageUrl(firstCreative);
                    return isImageCreative(firstCreative) && imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={firstCreative.fileName}
                        className="h-16 w-16 rounded border border-gray-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded border border-gray-200 bg-gray-100">
                        <Video className="h-8 w-8 text-gray-400" />
                      </div>
                    );
                  })()}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {orderDetails.creatives[0]?.fileName}
                    </p>
                    {orderDetails.creatives.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        and {orderDetails.creatives.length - 1} more
                      </p>
                    )}
                  </div>
                </div>
                {/* List all creative filenames in compact format */}
                {orderDetails.creatives.length > 1 && (
                  <div className="ml-20 space-y-1">
                    {orderDetails.creatives.slice(1).map((creative) => (
                      <p key={creative.id} className="text-xs text-muted-foreground">
                        • {creative.fileName}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {orderDetails.backfillCount !== undefined &&
            orderDetails.backfillCount > 0 && (
              <div>
                <span className="text-muted-foreground text-sm font-medium">
                  Backfill Periods:
                </span>
                <p className="text-foreground">{orderDetails.backfillCount}</p>
              </div>
            )}

          {orderDetails.targetUrl && (
            <div>
              <span className="text-muted-foreground text-sm font-medium">
                Target URL:
              </span>
              <p className="text-foreground break-all">{orderDetails.targetUrl}</p>
            </div>
          )}

          {orderDetails.utmTag && (
            <div>
              <span className="text-muted-foreground text-sm font-medium">
                UTM Tag:
              </span>
              <p className="text-foreground break-all">{orderDetails.utmTag}</p>
            </div>
          )}

          {orderDetails.totalPrice !== undefined && (
            <div className="border-t pt-4">
              <div className="flex justify-between">
                <span className="text-foreground text-lg font-semibold">
                  Total Price:
                </span>
                <span className="text-foreground text-lg font-bold">
                  ${(orderDetails.totalPrice / 100).toFixed(2)} CAD
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="text-muted-foreground text-sm">
          Your order includes new creative, create your order now and an admin
          will review them within 24 hours. If approved, your payment method on
          file will be charged, if not we will reach out to you.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm Order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
