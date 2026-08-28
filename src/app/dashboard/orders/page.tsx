"use client";

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FilterBadge } from "~/components/catalogue/FilterBadge";
import {
  PackageIcon,
  WifiOffIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineOrders } from "~/hooks/use-offline-documents";
import {
  getSupplierEmailRecipients,
  normalizeSupplierContacts,
} from "~/lib/supplier-contacts";
import { buildEmailComposeUrl, getPreferredEmailClient } from "~/lib/mailto";
import type { RouterOutputs } from "~/trpc/react";

type EmailDraft = {
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
};

type ListedOrder = RouterOutputs["materialList"]["listOrders"][number];
type DateFilter = "all" | "today" | "last7" | "last30" | "thisMonth";

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: "All dates",
  today: "Today",
  last7: "Last 7 days",
  last30: "Last 30 days",
  thisMonth: "This month",
};

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function orderDate(order: ListedOrder) {
  return new Date(order.sentAt ?? order.createdAt);
}

function matchesDateFilter(order: ListedOrder, dateFilter: DateFilter) {
  if (dateFilter === "all") return true;
  const value = orderDate(order);
  if (Number.isNaN(value.getTime())) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dateFilter === "today") return value >= startOfToday;
  if (dateFilter === "last7") {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - 6);
    return value >= start;
  }
  if (dateFilter === "last30") {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - 29);
    return value >= start;
  }
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth()
  );
}

function orderSearchHaystack(order: ListedOrder, email?: EmailDraft) {
  return normalizeSearchText(
    [
      order.orderNumber,
      order.job?.name,
      order.materialList?.name,
      order.supplier?.name,
      order.notes,
      order.sentTo,
      email?.subject,
      email?.body,
      email?.to?.join(" "),
      email?.cc?.join(" "),
      ...(order.items ?? []).flatMap((item) => [
        item.quantity,
        item.description,
        item.supplierSku,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function scoreOrderSearch(
  order: ListedOrder,
  query: string,
  email?: EmailDraft,
) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const haystack = orderSearchHaystack(order, email);
  const words = haystack.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += haystack.split(token).length > 2 ? 3 : 2;
      continue;
    }
    const prefixMatch = words.some(
      (word) =>
        word.startsWith(token) ||
        (token.length > 2 && token.startsWith(word)),
    );
    if (!prefixMatch) return 0;
    score += 1;
  }
  return score;
}

export default function OrdersPage() {
  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: serverOrders, isLoading } =
    api.materialList.listOrders.useQuery(undefined, {
      enabled: isOnline,
    });
  const {
    data: orders,
    cacheLoaded,
    isOfflineFallback,
  } = useOfflineOrders(serverOrders);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [emailDrafts, setEmailDrafts] = useState<Map<string, EmailDraft>>(
    new Map(),
  );
  const [emailRecipients, setEmailRecipients] = useState<Map<string, string>>(
    new Map(),
  );
  const [emailCcRecipients, setEmailCcRecipients] = useState<
    Map<string, string>
  >(new Map());
  const [loadingEmails, setLoadingEmails] = useState<Set<string>>(new Set());
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const markOrderSent = api.materialList.markOrderSent.useMutation({
    onSuccess: () => {
      void utils.materialList.listOrders.invalidate();
    },
  });

  const loadEmail = async (orderId: string) => {
    if (emailDrafts.has(orderId) || loadingEmails.has(orderId)) return;

    setLoadingEmails((prev) => new Set(prev).add(orderId));
    try {
      const draft = await utils.materialList.getOrderEmailContent.fetch({
        orderId,
      });
      const order = orders?.find((item) => item.id === orderId);
      setEmailDrafts((prev) => {
        const next = new Map(prev);
        next.set(orderId, draft);
        return next;
      });
      setEmailRecipients((prev) => {
        const next = new Map(prev);
        if (!next.has(orderId)) {
          next.set(
            orderId,
            order?.sentTo?.trim() || draft.to?.join(", ") || "",
          );
        }
        return next;
      });
      setEmailCcRecipients((prev) => {
        const next = new Map(prev);
        if (!next.has(orderId)) {
          next.set(orderId, draft.cc?.join(", ") || "");
        }
        return next;
      });
      setSyncError(null);
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Could not load the order email.",
      );
    } finally {
      setLoadingEmails((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const toggleOrder = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
        void loadEmail(orderId);
      }
      return next;
    });
  };

  const handleResendOrder = async (orderId: string) => {
    const order = orders?.find((item) => item.id === orderId);
    if (!order) return;

    let draft = emailDrafts.get(orderId);
    if (!draft) {
      await loadEmail(orderId);
      draft = emailDrafts.get(orderId);
    }
    if (!draft) {
      const fetched = await utils.materialList.getOrderEmailContent.fetch({
        orderId,
      });
      draft = fetched;
      setEmailDrafts((prev) => new Map(prev).set(orderId, fetched));
    }

    const recipient =
      emailRecipients.get(orderId)?.trim() ||
      order.sentTo?.trim() ||
      draft.to?.join(", ") ||
      (order.supplier
        ? getSupplierEmailRecipients(
            normalizeSupplierContacts(order.supplier.contacts, order.supplier),
          ).to.join(", ")
        : "");
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
      toggleOrder(orderId);
      return;
    }
    const ccRecipients = (
      emailCcRecipients.get(orderId)?.trim() ||
      draft.cc?.join(", ") ||
      ""
    )
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    setSendingOrderId(orderId);
    try {
      await markOrderSent.mutateAsync({
        orderId,
        sentTo: toRecipients.join(", "),
        notes: order.notes ?? undefined,
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

  const jobOptions = useMemo(() => {
    const jobs = new Map<string, string>();
    for (const order of orders ?? []) {
      if (order.job?.id && order.job.name) {
        jobs.set(order.job.id, order.job.name);
      }
    }
    return Array.from(jobs.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const supplierOptions = useMemo(() => {
    const suppliers = new Map<string, string>();
    for (const order of orders ?? []) {
      if (order.supplier?.id && order.supplier.name) {
        suppliers.set(order.supplier.id, order.supplier.name);
      }
    }
    return Array.from(suppliers.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim();
    return (orders ?? [])
      .filter((order) => {
        if (jobFilter && order.job?.id !== jobFilter) return false;
        if (supplierFilter && order.supplier?.id !== supplierFilter) return false;
        if (!matchesDateFilter(order, dateFilter)) return false;
        return scoreOrderSearch(order, query, emailDrafts.get(order.id)) > 0;
      })
      .sort((a, b) => {
        if (!query) return 0;
        return (
          scoreOrderSearch(b, query, emailDrafts.get(b.id)) -
          scoreOrderSearch(a, query, emailDrafts.get(a.id))
        );
      });
  }, [orders, jobFilter, supplierFilter, dateFilter, searchQuery, emailDrafts]);

  const selectedJobName =
    jobOptions.find((job) => job.id === jobFilter)?.name ?? null;
  const selectedSupplierName =
    supplierOptions.find((supplier) => supplier.id === supplierFilter)?.name ??
    null;
  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(jobFilter) ||
    Boolean(supplierFilter) ||
    dateFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setJobFilter(null);
    setSupplierFilter(null);
    setDateFilter("all");
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
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Orders
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Open an order to review the email that was sent.
          </p>
          {isOfflineFallback && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
              <WifiOffIcon className="h-3 w-3" /> Offline cached orders
            </p>
          )}
        </div>

        {syncError && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {syncError}
          </div>
        )}

        {orders && orders.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search items, jobs, suppliers..."
                  className="h-11 pl-10"
                />
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  onClick={clearFilters}
                  className="h-11 shrink-0"
                >
                  <XIcon className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              )}
            </div>

            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2">
                {searchQuery.trim() && (
                  <FilterBadge
                    label="Search"
                    value={searchQuery.trim()}
                    onRemove={() => setSearchQuery("")}
                  />
                )}
                {selectedJobName && (
                  <FilterBadge
                    label="Job"
                    value={selectedJobName}
                    onRemove={() => setJobFilter(null)}
                  />
                )}
                {selectedSupplierName && (
                  <FilterBadge
                    label="Supplier"
                    value={selectedSupplierName}
                    onRemove={() => setSupplierFilter(null)}
                  />
                )}
                {dateFilter !== "all" && (
                  <FilterBadge
                    label="Date"
                    value={DATE_FILTER_LABELS[dateFilter]}
                    onRemove={() => setDateFilter("all")}
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between">
                    <span className="truncate">{selectedJobName ?? "All jobs"}</span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onClick={() => setJobFilter(null)}>
                    All jobs
                  </DropdownMenuItem>
                  {jobOptions.map((job) => (
                    <DropdownMenuItem
                      key={job.id}
                      onClick={() => setJobFilter(job.id)}
                    >
                      {job.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between">
                    <span className="truncate">
                      {selectedSupplierName ?? "All suppliers"}
                    </span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onClick={() => setSupplierFilter(null)}>
                    All suppliers
                  </DropdownMenuItem>
                  {supplierOptions.map((supplier) => (
                    <DropdownMenuItem
                      key={supplier.id}
                      onClick={() => setSupplierFilter(supplier.id)}
                    >
                      {supplier.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between">
                    <span className="truncate">
                      {DATE_FILTER_LABELS[dateFilter]}
                    </span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map(
                    (value) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => setDateFilter(value)}
                      >
                        {DATE_FILTER_LABELS[value]}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}

        {!orders || orders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
              <h3 className="mb-2 text-lg font-semibold">No orders yet</h3>
              <p className="text-muted-foreground mb-4 text-center">
                Orders will appear here after you send them from a material
                list
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredOrders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <PackageIcon className="mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold">No matching orders</h3>
                <p className="text-muted-foreground mb-4 text-center">
                  Nothing matches these filters.
                </p>
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </CardContent>
            </Card>
          ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => {
              const isExpanded = expandedOrders.has(order.id);
              const draft = emailDrafts.get(order.id);
              const isDraftLoading = loadingEmails.has(order.id);
              const recipient = emailRecipients.get(order.id) ?? "";
              const ccRecipient = emailCcRecipients.get(order.id) ?? "";
              const isSending = sendingOrderId === order.id;
              const contextLine = [
                order.orderNumber,
                order.job?.name,
                order.materialList?.name,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div key={order.id} className="rounded-lg border bg-white p-4">
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
                      <span className="min-w-0 text-left">
                        <span className="block truncate">
                          {order.supplier?.name || "Supplier Order"}
                        </span>
                        {contextLine && (
                          <span className="block truncate text-xs font-normal text-gray-500">
                            {contextLine}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex h-8 w-24 shrink-0 items-center justify-center">
                      <Button
                        size="sm"
                        className="h-8 w-full"
                        onClick={() => handleResendOrder(order.id)}
                        disabled={!isOnline || isSending}
                      >
                        {isSending ? "Opening..." : "Resend"}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-4 pl-6">
                      {isDraftLoading || !draft ? (
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
                              disabled
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
                              disabled
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
                              disabled
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
                              disabled
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
                              value={order.notes ?? ""}
                              placeholder="Notes saved on the sent order"
                              className="min-h-[80px]"
                              disabled
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
          )
        )}
      </div>
    </div>
  );
}
