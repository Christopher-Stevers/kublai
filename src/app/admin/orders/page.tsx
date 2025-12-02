"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { OrderRow } from "~/app/dashboard/_components/OrderRow";

function formatCurrency(amount: number, currency: string = "cad"): string {
  const formatter = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return formatter.format(amount / 100); // Convert cents to dollars
}

type SortBy = "date" | "user" | "status";
type SortOrder = "asc" | "desc";

export default function AdminDashboard() {
  const utils = api.useUtils();
  const { data: pendingOrders, isLoading } = api.admin.getPendingOrders.useQuery();

  // Approved orders state
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedSortBy, setApprovedSortBy] = useState<SortBy>("date");
  const [approvedSortOrder, setApprovedSortOrder] = useState<SortOrder>("desc");

  const { data: approvedOrdersData, isLoading: isLoadingApproved } =
    api.admin.getApprovedOrders.useQuery({
      page: approvedPage,
      pageSize: 10,
      sortBy: approvedSortBy,
      sortOrder: approvedSortOrder,
    });

  const approveCreativeMutation = api.admin.approveCreative.useMutation({
    onSuccess: () => {
      void utils.admin.getPendingOrders.invalidate();
      void utils.admin.getApprovedOrders.invalidate();
    },
  });

  const approveOrderMutation = api.admin.approveOrder.useMutation({
    onSuccess: () => {
      void utils.admin.getPendingOrders.invalidate();
      void utils.admin.getApprovedOrders.invalidate();
    },
  });

  const [approvingCreative, setApprovingCreative] = useState<string | null>(null);
  const [approvingOrder, setApprovingOrder] = useState<string | null>(null);

  const handleSort = (field: SortBy) => {
    if (approvedSortBy === field) {
      // Toggle sort order
      setApprovedSortOrder(approvedSortOrder === "asc" ? "desc" : "asc");
    } else {
      // Set new sort field
      setApprovedSortBy(field);
      setApprovedSortOrder("desc");
    }
    setApprovedPage(1); // Reset to first page when sorting changes
  };

  const handleApproveCreative = async (creativeId: string) => {
    setApprovingCreative(creativeId);
    try {
      await approveCreativeMutation.mutateAsync({ creativeId });
    } catch (error) {
      console.error("Failed to approve creative:", error);
    } finally {
      setApprovingCreative(null);
    }
  };

  const handleApproveOrder = async (orderId: string) => {
    setApprovingOrder(orderId);
    try {
      await approveOrderMutation.mutateAsync({ orderId });
    } catch (error) {
      console.error("Failed to approve order:", error);
    } finally {
      setApprovingOrder(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-600">Loading pending orders...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Order Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review and approve orders and creatives
        </p>
      </div>

      {/* Pending Orders Section */}
      {(!pendingOrders || pendingOrders.length === 0) ? (
        <Card className="mb-8">
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                No Pending Orders
              </h2>
              <p className="text-gray-600">
                All orders have been approved or there are no orders waiting for approval.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Pending Orders</h2>
          <div className="space-y-6">
        {pendingOrders.map(({ order, user, creatives }) => {
          const allCreativesApproved =
            creatives.length === 0 ||
            creatives.every((c) => c.approved === true);

          return (
            <Card key={order.id} className="border-gray-200">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      Order #{order.id.slice(0, 8)}
                    </CardTitle>
                    <div className="mt-2 space-y-1 text-sm text-gray-600">
                      <p>
                        <span className="font-medium">User:</span> {user.name ?? user.email}
                      </p>
                      <p>
                        <span className="font-medium">Created:</span>{" "}
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="h-5 w-5 text-gray-400" />
                      <span className="text-2xl font-bold text-gray-900">
                        {formatCurrency(order.totalPrice, order.currency ?? "cad")}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {order.status ?? "pending"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Charge Amount Display */}
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-blue-900">
                          Charge Amount
                        </p>
                        <p className="text-xs text-blue-700 mt-1">
                          This amount will be charged when the order is approved
                        </p>
                      </div>
                      <div className="text-2xl font-bold text-blue-900">
                        {formatCurrency(order.totalPrice, order.currency ?? "cad")}
                      </div>
                    </div>
                  </div>

                  {/* Creatives Section */}
                  {creatives.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Creatives ({creatives.length})
                      </h3>
                      <div className="space-y-2">
                        {creatives.map((creative) => (
                          <div
                            key={creative.id}
                            className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                          >
                            <div className="flex items-center gap-3">
                              {creative.approved ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                              ) : (
                                <Clock className="h-5 w-5 text-yellow-500" />
                              )}
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {creative.fileName}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {creative.fileType} •{" "}
                                  {new Date(creative.uploadDate).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            {creative.approved ? (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                Approved
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleApproveCreative(creative.id)}
                                disabled={approvingCreative === creative.id}
                              >
                                {approvingCreative === creative.id
                                  ? "Approving..."
                                  : "Approve Creative"}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                      <p className="text-sm text-gray-600">
                        No creatives associated with this order
                      </p>
                    </div>
                  )}

                  {/* Order Approval Section */}
                  <div className="pt-4 border-t border-gray-200">
                    {allCreativesApproved ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            All creatives approved
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            You can now approve this order and charge the customer
                          </p>
                        </div>
                        <Button
                          onClick={() => handleApproveOrder(order.id)}
                          disabled={approvingOrder === order.id}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {approvingOrder === order.id
                            ? "Processing..."
                            : "Approve Order & Charge"}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <Clock className="h-4 w-4" />
                        <p>
                          Please approve all creatives before approving this order
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Error Display */}
                  {approveOrderMutation.error && approvingOrder === order.id && (
                    <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-sm text-red-700">
                        {approveOrderMutation.error.message}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
          </div>
        </div>
      )}

      {/* Approved Orders Section */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Approved Orders</h2>
        {isLoadingApproved ? (
          <Card>
            <CardContent className="p-8">
              <p className="text-center text-gray-600">Loading approved orders...</p>
            </CardContent>
          </Card>
        ) : !approvedOrdersData || approvedOrdersData.orders.length === 0 ? (
          <Card>
            <CardContent className="p-8">
              <div className="flex flex-col items-center justify-center">
                <p className="text-gray-600">No approved orders yet.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Sort Controls */}
            <div className="mb-4 flex items-center gap-4">
              <span className="text-sm text-gray-600">Sort by:</span>
              <button
                onClick={() => handleSort("user")}
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                User
                {approvedSortBy === "user" ? (
                  approvedSortOrder === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )
                ) : (
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                )}
              </button>
              <button
                onClick={() => handleSort("date")}
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Date
                {approvedSortBy === "date" ? (
                  approvedSortOrder === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )
                ) : (
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                )}
              </button>
              <button
                onClick={() => handleSort("status")}
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Status
                {approvedSortBy === "status" ? (
                  approvedSortOrder === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )
                ) : (
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                )}
              </button>
            </div>

            {/* Orders List */}
            <div className="space-y-3">
              {approvedOrdersData.orders.map((item) => (
                <OrderRow
                  key={item.order.id}
                  order={item.order}
                  slots={item.slots}
                  backfills={item.backfills}
                  preview={item.preview}
                  startDate={item.startDate}
                  endDate={item.endDate}
                  showUser={true}
                  userName={item.user.name ?? undefined}
                  userEmail={item.user.email}
                />
              ))}
            </div>

            {/* Pagination */}
            {approvedOrdersData.pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing{" "}
                  {Math.min(
                    (approvedOrdersData.pagination.page - 1) *
                      approvedOrdersData.pagination.pageSize +
                      1,
                    approvedOrdersData.pagination.totalCount,
                  )}{" "}
                  to{" "}
                  {Math.min(
                    approvedOrdersData.pagination.page *
                      approvedOrdersData.pagination.pageSize,
                    approvedOrdersData.pagination.totalCount,
                  )}{" "}
                  of {approvedOrdersData.pagination.totalCount} orders
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setApprovedPage((p) => Math.max(1, p - 1))}
                    disabled={approvedPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from(
                      { length: approvedOrdersData.pagination.totalPages },
                      (_, i) => i + 1,
                    )
                      .filter(
                        (page) =>
                          page === 1 ||
                          page === approvedOrdersData.pagination.totalPages ||
                          Math.abs(page - approvedPage) <= 1,
                      )
                      .map((page, idx, arr) => (
                        <div key={page} className="flex items-center gap-1">
                          {idx > 0 && arr[idx - 1] !== page - 1 && (
                            <span className="px-2 text-gray-500">...</span>
                          )}
                          <Button
                            variant={approvedPage === page ? "default" : "outline"}
                            size="sm"
                            onClick={() => setApprovedPage(page)}
                            className="min-w-[2.5rem]"
                          >
                            {page}
                          </Button>
                        </div>
                      ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setApprovedPage((p) =>
                        Math.min(approvedOrdersData.pagination.totalPages, p + 1),
                      )
                    }
                    disabled={
                      approvedPage === approvedOrdersData.pagination.totalPages
                    }
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

