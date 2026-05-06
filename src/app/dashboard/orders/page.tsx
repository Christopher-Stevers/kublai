"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  PackageIcon,
  CalendarIcon,
  MailIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SendIcon,
  WifiOffIcon,
} from "lucide-react";
import { format } from "date-fns";
import { Badge } from "~/components/ui/badge";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineOrders } from "~/hooks/use-offline-documents";

export default function OrdersPage() {
  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: serverOrders, isLoading } = api.materialList.listOrders.useQuery(undefined, {
    enabled: isOnline,
  });
  const {
    data: orders,
    cacheLoaded,
    isOfflineFallback,
  } = useOfflineOrders(serverOrders);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<{
    id: string;
    supplierEmail: string | null;
  } | null>(null);
  const [emailInput, setEmailInput] = useState("");

  const markOrderSent = api.materialList.markOrderSent.useMutation({
    onSuccess: () => {
      void utils.materialList.listOrders.invalidate();
      setEmailDialogOpen(false);
      setSelectedOrder(null);
      setEmailInput("");
    },
  });

  const handleSendOrder = async (
    orderId: string,
    supplierEmail: string | null,
  ) => {
    // If no email, open dialog to enter one
    if (!supplierEmail) {
      setSelectedOrder({ id: orderId, supplierEmail: null });
      setEmailInput("");
      setEmailDialogOpen(true);
      return;
    }

    await sendOrderWithEmail(orderId, supplierEmail);
  };

  const sendOrderWithEmail = async (orderId: string, email: string) => {
    try {
      // Get email content
      const emailContent = await utils.materialList.getOrderEmailContent.fetch({
        orderId,
      });

      if (!emailContent) return;

      // Mark as sent
      await markOrderSent.mutateAsync({
        orderId,
        sentTo: email,
      });

      // Open email client
      const subject = encodeURIComponent(emailContent.subject);
      const body = encodeURIComponent(emailContent.body);
      const mailtoLink = `mailto:${email}?subject=${subject}&body=${body}`;
      window.open(mailtoLink, "_blank");
    } catch (error) {
      console.error("Error sending order:", error);
      alert("Failed to send order. Please try again.");
    }
  };

  const handleDialogSend = () => {
    if (!selectedOrder) return;
    const email = emailInput.trim();
    if (!email || !email.includes("@")) {
      alert("Please enter a valid email address");
      return;
    }
    void sendOrderWithEmail(selectedOrder.id, email);
  };

  if ((isLoading || !cacheLoaded) && !orders) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading orders...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Past Orders
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            View and manage your material orders
          </p>
          {isOfflineFallback && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
              <WifiOffIcon className="h-3 w-3" /> Offline cached orders
            </p>
          )}
        </div>

        {!orders || orders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="mb-2 text-lg font-semibold">No orders yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Orders will appear here after you generate and send them from a
                material list
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <Card key={order.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="mb-2">
                        {order.orderNumber || `Order ${order.id.slice(0, 8)}`}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            order.status === "sent"
                              ? "default"
                              : order.status === "draft"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {order.status}
                        </Badge>
                        {order.sentAt && (
                          <span className="text-muted-foreground text-sm">
                            Sent {format(new Date(order.sentAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {order.job && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-700">Job:</span>
                        <span className="text-gray-600">{order.job.name}</span>
                      </div>
                    )}

                    {order.supplier && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-700">
                          Supplier:
                        </span>
                        <Link
                          href={`/dashboard/suppliers`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {order.supplier.name}
                          <ExternalLinkIcon className="ml-1 inline h-3 w-3" />
                        </Link>
                      </div>
                    )}

                    {order.materialList && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-700">
                          Material List:
                        </span>
                        <Link
                          href={`/dashboard/material-lists/${order.materialList.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {order.materialList.name}
                          <ExternalLinkIcon className="ml-1 inline h-3 w-3" />
                        </Link>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-600">
                        Created {format(new Date(order.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>

                    {order.sentTo && (
                      <div className="flex items-center gap-2 text-sm">
                        <MailIcon className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-600">
                          Sent to: {order.sentTo}
                        </span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant={order.status === "draft" ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          handleSendOrder(
                            order.id,
                            order.supplier?.contactEmail ?? null,
                          )
                        }
                        disabled={!isOnline || markOrderSent.isPending}
                      >
                        {order.status === "draft" ? (
                          <>
                            <SendIcon className="mr-2 h-4 w-4" />
                            Send
                          </>
                        ) : (
                          <>
                            <RefreshCwIcon className="mr-2 h-4 w-4" />
                            Resend
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Email Input Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Supplier Email</DialogTitle>
            <DialogDescription>
              Please enter the email address to send this order to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="supplier@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleDialogSend();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEmailDialogOpen(false);
                setSelectedOrder(null);
                setEmailInput("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleDialogSend} disabled={!isOnline || markOrderSent.isPending}>
              {markOrderSent.isPending ? "Sending..." : "Send Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
