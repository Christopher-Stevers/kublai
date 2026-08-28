"use client";

import { useEffect, useMemo, useState } from "react";
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
import { buildEmailComposeUrl, getPreferredEmailClient } from "~/lib/mailto";

interface OrdersPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
}

type EmailDraft = {
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
};

type PreviewOrder = {
  id: string;
  supplierId?: string | null;
  orderNumber?: string | null;
  notes?: string | null;
  sentAt?: Date | string | null;
  supplier: {
    id: string;
    name: string;
    contactEmail: string | null;
    contacts?: unknown;
  } | null;
  items: Array<{
    id: string;
    quantity: string;
    descriptionSnapshot: string | null;
    supplierSkuSnapshot: string | null;
  }>;
  email?: EmailDraft;
};

export function OrdersPreviewSheet({
  open,
  onOpenChange,
  materialListId,
}: OrdersPreviewSheetProps) {
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [orderNotes, setOrderNotes] = useState<Map<string, string>>(new Map());
  const [emailRecipients, setEmailRecipients] = useState<Map<string, string>>(
    new Map(),
  );
  const [emailCcRecipients, setEmailCcRecipients] = useState<
    Map<string, string>
  >(new Map());
  const [emailDrafts, setEmailDrafts] = useState<Map<string, EmailDraft>>(
    new Map(),
  );
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    possible: PreviewOrder[];
    sent: PreviewOrder[];
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const canGenerateDocuments =
    userData?.permissions.canGenerateDocuments ?? true;

  const sendGeneratedOrder = api.materialList.sendGeneratedOrder.useMutation();

  const applyPreviewData = (data: {
    possible: PreviewOrder[];
    sent: PreviewOrder[];
  }) => {
    setPreviewData(data);
    const orders = [...data.possible, ...data.sent];
    setOrderNotes(
      new Map(orders.map((order) => [order.id, order.notes ?? ""])),
    );
    setEmailRecipients(
      new Map(
        orders.map((order) => [order.id, order.email?.to?.join(", ") ?? ""]),
      ),
    );
    setEmailCcRecipients(
      new Map(
        orders.map((order) => [order.id, order.email?.cc?.join(", ") ?? ""]),
      ),
    );
    setEmailDrafts(
      new Map(
        orders.flatMap((order) =>
          order.email ? [[order.id, order.email] as const] : [],
        ),
      ),
    );
  };

  const loadPreview = async () => {
    const data = await utils.materialList.previewOrders.fetch(
      { materialListId },
      { staleTime: 0 },
    );
    applyPreviewData(data);
    return data;
  };

  useEffect(() => {
    if (!open) {
      setExpandedOrders(new Set());
      setOrderNotes(new Map());
      setEmailRecipients(new Map());
      setEmailCcRecipients(new Map());
      setEmailDrafts(new Map());
      setSendingOrderId(null);
      setSyncError(null);
      setPreviewData(null);
      setLoadError(null);
      setIsGenerating(false);
      void utils.materialList.previewOrders.invalidate({ materialListId });
      return;
    }

    if (!isOnline || !canGenerateDocuments || !materialListId) {
      return;
    }

    let cancelled = false;
    setIsGenerating(true);
    setPreviewData(null);
    setLoadError(null);
    void loadPreview()
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Order preview failed. Try again in a moment.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsGenerating(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, materialListId, isOnline, canGenerateDocuments]);

  const possibleOrders = previewData?.possible ?? [];
  const sentOrders = previewData?.sent ?? [];
  const allOrders = useMemo(
    () => [
      ...possibleOrders.map((order) => ({ ...order, kind: "possible" as const })),
      ...sentOrders.map((order) => ({ ...order, kind: "sent" as const })),
    ],
    [possibleOrders, sentOrders],
  );

  const toggleOrder = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleEmailOrder = async (order: PreviewOrder) => {
    if (!canGenerateDocuments) {
      setSyncError("Standard accounts cannot generate orders.");
      return;
    }
    if (!order.supplierId) {
      setSyncError("This order is missing a supplier.");
      return;
    }

    const draft = emailDrafts.get(order.id);
    if (!draft) {
      setSyncError("Could not load the order email.");
      return;
    }

    const recipient =
      emailRecipients.get(order.id)?.trim() || draft.to?.join(", ") || "";
    const toRecipients = recipient
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    if (
      toRecipients.length === 0 ||
      toRecipients.some((email) => !email.includes("@"))
    ) {
      setSyncError(
        "Enter at least one valid To email before sending this order.",
      );
      return;
    }
    const ccRecipients = (
      emailCcRecipients.get(order.id)?.trim() ||
      draft.cc?.join(", ") ||
      ""
    )
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    const notes = orderNotes.get(order.id) || "";
    setSendingOrderId(order.id);
    try {
      await sendGeneratedOrder.mutateAsync({
        materialListId,
        supplierId: order.supplierId,
        sentTo: toRecipients.join(", "),
        notes: notes.trim() || undefined,
      });

      window.open(
        buildEmailComposeUrl({
          to: toRecipients,
          cc: ccRecipients,
          subject: draft.subject,
          body: draft.body,
          client: getPreferredEmailClient(),
        }),
        "_blank",
      );

      setSyncError(null);
      await Promise.all([
        utils.materialList.previewOrders.invalidate({ materialListId }),
        utils.materialList.getOrdersForMaterialList.invalidate({
          materialListId,
        }),
        utils.materialList.listOrders.invalidate(),
      ]);
      await loadPreview();
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Could not send this order. Try again in a moment.",
      );
    } finally {
      setSendingOrderId(null);
    }
  };

  if (isGenerating || (open && !previewData && !loadError && isOnline && canGenerateDocuments)) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preparing Orders</DialogTitle>
            <DialogDescription>
              Building possible orders from the current material list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!canGenerateDocuments || !isOnline || loadError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {!canGenerateDocuments
                ? "Not Allowed"
                : !isOnline
                  ? "Sync Required"
                  : "Could Not Load Orders"}
            </DialogTitle>
            <DialogDescription>
              {!canGenerateDocuments
                ? "Standard accounts cannot generate orders."
                : !isOnline
                  ? "Reconnect before generating orders. Orders are generated from the online database."
                  : (loadError ??
                    "Order preview failed. Try again in a moment.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (allOrders.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Orders to Send</DialogTitle>
            <DialogDescription>
              No items have suppliers assigned. Assign suppliers to items
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

  const renderOrderCard = (
    order: PreviewOrder & { kind: "possible" | "sent" },
  ) => {
    const isExpanded = expandedOrders.has(order.id);
    const isSent = order.kind === "sent";
    const draft = emailDrafts.get(order.id);
    const recipient = emailRecipients.get(order.id) ?? "";
    const ccRecipient = emailCcRecipients.get(order.id) ?? "";
    const isSending = sendingOrderId === order.id;

    return (
      <div key={order.id} className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => toggleOrder(order.id)}
            className="flex min-w-0 items-center gap-2 font-semibold"
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">
              {order.supplier?.name || "Supplier Order"}
            </span>
          </button>
          <div className="flex h-8 w-20 shrink-0 items-center justify-center">
            {isSent ? (
              <span className="text-sm font-medium text-green-700">Sent</span>
            ) : (
              <Button
                size="sm"
                className="h-8 w-full"
                onClick={() => handleEmailOrder(order)}
                disabled={!canGenerateDocuments || isSending}
              >
                {isSending ? "Opening..." : "Send"}
              </Button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 space-y-4 pl-6">
            {!draft ? (
              <p className="text-muted-foreground text-sm">
                Loading email...
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
                    type="text"
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
                    htmlFor={`order-cc-${order.id}`}
                    className="text-sm font-medium"
                  >
                    CC
                  </label>
                  <Input
                    id={`order-cc-${order.id}`}
                    type="text"
                    value={ccRecipient}
                    onChange={(event) => {
                      const next = new Map(emailCcRecipients);
                      next.set(order.id, event.target.value);
                      setEmailCcRecipients(next);
                    }}
                    placeholder="cc@example.com"
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
                    Email
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
                    onChange={(event) => {
                      const next = new Map(orderNotes);
                      next.set(order.id, event.target.value);
                      setOrderNotes(next);
                    }}
                    placeholder="Notes saved on the sent order"
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Orders</DialogTitle>
          <DialogDescription>
            Possible orders from this list, plus any already sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {syncError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {syncError}
            </div>
          )}

          {possibleOrders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Possible Orders ({possibleOrders.length})
              </h3>
              {possibleOrders.map((order) =>
                renderOrderCard({ ...order, kind: "possible" }),
              )}
            </div>
          )}

          {sentOrders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Already Sent ({sentOrders.length})
              </h3>
              {sentOrders.map((order) =>
                renderOrderCard({ ...order, kind: "sent" }),
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
