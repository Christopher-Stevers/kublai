"use client";
import { OrderEmailSkuOption } from "~/components/materialLists/OrderEmailSkuOption";
import type { SupplierSkuLine } from "~/lib/order-email-lines";
import { UndoOrderButton } from "./UndoOrderButton";
import { requestMaterialListReplicacheSync } from "~/lib/replicache-material-list";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { openEmailCompose } from "~/lib/mailto";

interface OrdersPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  /** Tool request list: one order to the tool room, sent in-app (no email). */
  isToolRequest?: boolean;
  hasToolItems?: boolean;
}

type EmailDraft = {
  supplierSkuLines?: SupplierSkuLine[];
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
};

type PreviewOrder = {
  isToolRequest?: boolean;
  id: string;
  jobId?: string;
  approval?: {required:boolean;allowed:boolean;fingerprint:string;unlistedCount:number;approvalId:string|null;status:string;reviewNote:string|null}|null;
  supplierId?: string | null;
  orderNumber?: string | null;
  notes?: string | null;
  sentAt?: Date | string | null;
  fulfillmentStatus?: string | null;
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

const TOOL_REQUEST_STATUS: Record<string, string> = {
  open: "Waiting on tool room",
  partial: "Partly filled",
  fulfilled: "Filled",
  cancelled: "Closed",
};

export function OrdersPreviewSheet({
  open,
  onOpenChange,
  materialListId,
  isToolRequest = false,
  hasToolItems = false,
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
  const sendInFlight = useRef(false);
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
  const { data: userData, isLoading: loadingPermissions } =
    api.user.getMyRole.useQuery(undefined, {
      enabled: isOnline && open,
    });
  // Anyone can send a tool request; supplier orders need document rights.
  const canGenerateDocuments =
    isToolRequest || hasToolItems || (userData?.permissions.can["orders.send"] ?? false);

  const sendGeneratedOrder = api.materialList.sendGeneratedOrder.useMutation();
  const requestApproval=api.jobPricing.requestApproval.useMutation({onSuccess:async()=>{setSyncError(null);await loadPreview();},onError:e=>setSyncError(e.message)});

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
      ...possibleOrders.map((order) => ({
        ...order,
        kind: "possible" as const,
      })),
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

  const refreshAfterSend = async () => {
    setSyncError(null);
    await Promise.all([
      utils.materialList.previewOrders.invalidate({ materialListId }),
      utils.materialList.getOrdersForMaterialList.invalidate({
        materialListId,
      }),
      utils.materialList.listOrders.invalidate(),
      utils.assets.listRequests.invalidate(),
    ]);
    await loadPreview();
  };

  const handleSendToToolRoom = async (order: PreviewOrder) => {
    if (!order.supplierId) return;
    const notes = orderNotes.get(order.id) ?? "";
    setSendingOrderId(order.id);
    try {
      await sendGeneratedOrder.mutateAsync({
        materialListId,
        supplierId: order.supplierId,
        sentTo: "Tool room",
        notes: notes.trim() || undefined,
      });
      await refreshAfterSend();
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Could not send this request. Try again in a moment.",
      );
    } finally {
      setSendingOrderId(null);
    }
  };

  const handleEmailOrder = async (order: PreviewOrder) => {
    if (sendInFlight.current) return;
    if (!(userData?.permissions.can["orders.send"] ?? false)) {
      setSyncError("You don't have permission to send orders.");
      return;
    }
    if (order.approval && !order.approval.allowed) { setSyncError("Approval is required before opening this order email."); return; }
    if (!order.supplierId) {
      setSyncError("This order is missing a supplier.");
      return;
    }

    const draft = emailDrafts.get(order.id);
    if (!draft) {
      setSyncError("Could not load the order email.");
      return;
    }

    const recipient = (
      emailRecipients.get(order.id) ??
      draft.to?.join(", ") ??
      ""
    ).trim();
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
      emailCcRecipients.get(order.id) ??
      draft.cc?.join(", ") ??
      ""
    )
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    const notes = orderNotes.get(order.id) ?? "";
    sendInFlight.current = true;
    setSendingOrderId(order.id);
    try {
      // Launch from this tap; waiting for persistence first lets Safari block it.
      openEmailCompose({
        to: toRecipients,
        cc: ccRecipients,
        subject: draft.subject,
        body: draft.body,
      });
      await sendGeneratedOrder.mutateAsync({
        materialListId,
        supplierId: order.supplierId,
        approvalFingerprint:order.approval?.fingerprint,
        sentTo: toRecipients.join(", "),
        notes: notes.trim() || undefined,
      });

      requestMaterialListReplicacheSync(0, "pull");
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
      sendInFlight.current = false;
      setSendingOrderId(null);
    }
  };

  if (
    (loadingPermissions && !isToolRequest) ||
    isGenerating ||
    (open && !previewData && !loadError && isOnline && canGenerateDocuments)
  ) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isToolRequest ? "Preparing Request" : "Preparing Orders"}
            </DialogTitle>
            <DialogDescription>
              {isToolRequest
                ? "Building the tool room request from this list."
                : "Building possible orders from the current material list."}
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
                ? "You don't have permission to send orders."
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
            <DialogTitle>
              {isToolRequest ? "Nothing to Request" : "No Orders to Send"}
            </DialogTitle>
            <DialogDescription>
              {isToolRequest
                ? "Add tools to this list, then send it to the tool room."
                : "No items have suppliers assigned. Assign suppliers to items before generating orders."}
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

    if (isToolRequest || order.isToolRequest) {
      return (
        <div key={order.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {isSent ? (order.orderNumber ?? "Tool request") : "Tool Room"}
              </div>
              <div className="text-muted-foreground text-xs">
                {order.items.length} tool line
                {order.items.length === 1 ? "" : "s"}
                {isSent && order.sentAt
                  ? ` · sent ${new Date(order.sentAt).toLocaleDateString()}`
                  : ""}
              </div>
            </div>
            {isSent ? (
              <a
                href={`/dashboard/assets/requests/${order.id}`}
                className="text-primary text-sm font-medium hover:underline"
              >
                {TOOL_REQUEST_STATUS[order.fulfillmentStatus ?? "open"] ??
                  "Sent"}
              </a>
            ) : (
              <Button
                size="sm"
                className="h-8 shrink-0"
                onClick={() => handleSendToToolRoom(order)}
                disabled={isSending}
              >
                {isSending ? "Sending..." : "Send"}
              </Button>
            )}
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {item.descriptionSnapshot ?? "Tool"}
                </span>
                <span className="shrink-0 tabular-nums">
                  × {Number(item.quantity)}
                </span>
              </li>
            ))}
          </ul>
          {!isSent && (
            <Textarea
              value={orderNotes.get(order.id) ?? ""}
              onChange={(event) => {
                const next = new Map(orderNotes);
                next.set(order.id, event.target.value);
                setOrderNotes(next);
              }}
              placeholder="Note for the tool room (needed by, drop-off, etc.)"
              className="mt-3 min-h-[70px]"
            />
          )}
          {isSent && order.notes && (
            <p className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
              {order.notes}
            </p>
          )}
        </div>
      );
    }

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
          <div className="flex min-h-8 shrink-0 items-center justify-center">
            {isSent ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-green-700">Sent</span>
                {canGenerateDocuments && <UndoOrderButton orderId={order.id} disabled={!isOnline || isSending} onUndone={loadPreview} />}
                {draft && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      openEmailCompose({
                        to: (
                          emailRecipients.get(order.id) ??
                          draft.to?.join(", ") ??
                          ""
                        )
                          .split(",")
                          .map((email) => email.trim())
                          .filter(Boolean),
                        cc: (
                          emailCcRecipients.get(order.id) ??
                          draft.cc?.join(", ") ??
                          ""
                        )
                          .split(",")
                          .map((email) => email.trim())
                          .filter(Boolean),
                        subject: draft.subject,
                        body: draft.body,
                      })
                    }
                  >
                    Open email
                  </Button>
                )}
              </div>
            ) : (
              <Button
                size="sm"
                className="h-8 w-full"
                onClick={() => handleEmailOrder(order)}
                disabled={!canGenerateDocuments || isSending || !draft || (order.approval?.required && !order.approval.allowed)}
              >
                {isSending ? "Opening..." : "Send"}
              </Button>
            )}
          </div>
        </div>

        {!isSent && order.approval?.required && <div className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p>{order.approval.allowed ? "Approved for this order." : `${order.approval.unlistedCount} unlisted ${order.approval.unlistedCount===1?"part requires":"parts require"} approval.`} {order.approval.status==="pending"&&"Waiting for an authorized reviewer."}</p>
          {order.approval.reviewNote&&<p>Review: {order.approval.reviewNote}</p>}
          {!order.approval.allowed && order.approval.status!=="pending" && <><Textarea aria-label="Reason for unlisted parts" placeholder="Why are these unlisted parts needed?" value={orderNotes.get(order.id)??""} onChange={event=>setOrderNotes(new Map(orderNotes).set(order.id,event.target.value))}/><Button size="sm" variant="outline" disabled={requestApproval.isPending||(orderNotes.get(order.id)??"").trim().length<3||!isOnline} onClick={()=>order.supplierId&&requestApproval.mutate({materialListId,supplierId:order.supplierId,note:orderNotes.get(order.id)??""})}>Request approval</Button></>}
          {!order.approval.allowed&&<Button size="sm" variant="outline" className="ml-2" onClick={()=>void loadPreview().catch(e=>setSyncError(String(e)))}>Check approval</Button>}
          {order.jobId&&<a className="ml-2 underline" href={`/dashboard/jobs/${order.jobId}/pricing`}>Job pricing & reviews</a>}
        </div>}
        {isExpanded && (
          <div className="mt-4 space-y-4 pl-6">
            {!draft ? (
              <p className="text-muted-foreground text-sm">{order.approval?.required&&!order.approval.allowed?"The email becomes available after approval.":"Loading email..."}</p>
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
                  <OrderEmailSkuOption supplierId={order.supplier?.id} body={draft.body} lines={draft.supplierSkuLines} onChange={body => setEmailDrafts(previous => new Map(previous).set(order.id, { ...draft, body }))} />
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
                    value={orderNotes.get(order.id) ?? ""}
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
          <DialogTitle>
            {isToolRequest ? "Send to Tool Room" : "Orders"}
          </DialogTitle>
          <DialogDescription>
            {isToolRequest
              ? "The tool room fills this from the yard and checks the tools out to the job."
              : "Possible orders from this list, plus any already sent."}
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
              <h3 className="text-foreground/80 text-sm font-semibold">
                {isToolRequest
                  ? "Ready to Send"
                  : `Possible Orders (${possibleOrders.length})`}
              </h3>
              {possibleOrders.map((order) =>
                renderOrderCard({ ...order, kind: "possible" }),
              )}
            </div>
          )}

          {sentOrders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-foreground/80 text-sm font-semibold">
                {isToolRequest ? "Requests Sent" : "Already Sent"} (
                {sentOrders.length})
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
